const assert = require('node:assert/strict');
const path = require('path');
const vm = require('node:vm');

const deployPath = path.join(__dirname, 'deploy-sod-report.js');
const { workflow } = require(deployPath);

assert.ok(workflow, 'workflow should be defined');
assert.strictEqual(workflow.name, 'Krave - Start Of Day Report');

const nodeNames = workflow.nodes.map((node) => node.name);

for (const requiredName of [
  'Manual Trigger',
  'Webhook Trigger',
  'Prepare Drafts Channel',
  'Fetch Airwallex Drafts History',
  'Extract SOD Inputs',
  'Validate Required Inputs',
  'Are Inputs Complete?',
  'Build SOD Prompt',
  'Generate SOD Report',
  'Post to Airwallex Drafts',
  'Send SOD to Noa',
  'Post Failure Alert',
]) {
  assert.ok(nodeNames.includes(requiredName), `missing node: ${requiredName}`);
}

const webhookNode = workflow.nodes.find((node) => node.name === 'Webhook Trigger');
assert.strictEqual(webhookNode.parameters.path, 'krave-sod-report');

const historyNode = workflow.nodes.find((node) => node.name === 'Fetch Airwallex Drafts History');
assert.strictEqual(historyNode.credentials.slackApi.id, 'Bn2U6Cwe1wdiCXzD');
assert.strictEqual(
  historyNode.parameters.channelId.value,
  'C0AQZGJDR38',
  'history node should read directly from #airwallexdrafts'
);
assert.strictEqual(historyNode.parameters.channelId.mode, 'list');
assert.ok(
  historyNode.parameters.returnAll === true || historyNode.parameters.limit >= 250,
  'history node should fetch enough channel history to reliably include yesterday EOD'
);

const extractNode = workflow.nodes.find((node) => node.name === 'Extract SOD Inputs');
assert.match(extractNode.parameters.jsCode, /wrap-up/i, 'extraction should look for prior-day EOD');
assert.match(extractNode.parameters.jsCode, /yesterday/, 'extraction should compute the previous local day explicitly');
assert.match(extractNode.parameters.jsCode, /botId|subtype|bot_message/, 'extraction should preserve bot-message metadata for archived EOD detection');
assert.match(extractNode.parameters.jsCode, /Today\['’\]s Wrap-up|wrap-up/i, 'extraction should match archived EOD headings robustly');
assert.match(extractNode.parameters.jsCode, /Morning Triage/, 'extraction should look for Morning Triage');
assert.match(extractNode.parameters.jsCode, /U0AM5EGRVTP/, 'extraction should look for John');
assert.match(extractNode.parameters.jsCode, /carryOverItems/, 'extraction should emit carry-over items');
assert.match(extractNode.parameters.jsCode, /reviewThese/, 'extraction should emit review-these items');
assert.match(
  extractNode.parameters.jsCode,
  /rawTexts/,
  'extraction should preserve John raw message text for prompt fallback'
);

const extractCode = `(function () {\n${extractNode.parameters.jsCode}\n})()`;
const fakeNow = new Date('2026-04-22T09:30:00+08:00');
const botEodTs = String(Math.floor(new Date('2026-04-21T18:05:00+08:00').getTime() / 1000));
const johnMorningTs = String(Math.floor(new Date('2026-04-22T08:10:00+08:00').getTime() / 1000));
const morningTriageTs = String(Math.floor(new Date('2026-04-22T07:45:00+08:00').getTime() / 1000));
const extractionResult = vm.runInNewContext(
  extractCode,
  {
    $input: {
      all: () => [
        {
          json: {
            messages: [
              {
                ts: botEodTs,
                subtype: 'bot_message',
                bot_id: 'B123',
                username: 'Krave Bot',
                text: "### \ud83c\udfc1 Today's Wrap-up\n\n**\ud83d\udea7 Not Completed / Needs More Work / Planned Next Steps**\n- Follow up with client\n\n**\ud83d\udd0e Blocker / Input Needed**\n- Waiting on approval",
              },
              {
                ts: johnMorningTs,
                user: 'U0AM5EGRVTP',
                text: '- Today follow up on invoices\n- Waiting on finance response',
              },
              {
                ts: morningTriageTs,
                subtype: 'bot_message',
                bot_id: 'B456',
                username: 'Krave Bot',
                text: '*Morning Triage - Wednesday, April 22 (ICT)*\n\n*[URGENT] - Action today (1)*\n- Legal team | Contract renewal - deadline today\n\n*Needs Your Reply (1)*\n- Supplier | Invoice question - Draft ready in Gmail\n\n*Review These (1)*\n- Unknown sender | Banking change - needs judgment\n\n*FYI (1)*\n- IM8 | Weekly report\n\n*Auto-Sorted (4)* - newsletters, receipts, notifications',
              },
            ],
          },
        },
      ],
    },
    Intl,
    Date: class extends Date {
      constructor(...args) {
        if (args.length) {
          super(...args);
          return;
        }

        super(fakeNow);
      }

      static now() {
        return fakeNow.getTime();
      }
    },
  },
  { timeout: 1000 }
);

const extractedPayload = extractionResult[0].json;
const normalize = (value) => JSON.parse(JSON.stringify(value));
assert.ok(extractedPayload.eod, 'bot-authored archived EOD should still be detected');
assert.deepStrictEqual(
  normalize(extractedPayload.eod.carryOverItems),
  ['Follow up with client'],
  'bot-authored archived EOD should preserve carry-over bullets under emoji headings'
);
assert.deepStrictEqual(
  normalize(extractedPayload.eod.blockers),
  ['Waiting on approval'],
  'bot-authored archived EOD should preserve blocker bullets under emoji headings'
);
assert.deepStrictEqual(
  normalize(extractedPayload.johnMorning.focusGoals),
  ['Today follow up on invoices'],
  'John morning dump should split bullet lines correctly'
);
assert.deepStrictEqual(
  normalize(extractedPayload.johnMorning.blockers),
  ['Waiting on finance response'],
  'John blocker bullets should be parsed line by line'
);
assert.deepStrictEqual(
  normalize(extractedPayload.morningTriage.urgent),
  ['Legal team | Contract renewal - deadline today'],
  'Morning Triage urgent bullets should parse Slack mrkdwn headings with counts'
);
assert.deepStrictEqual(
  normalize(extractedPayload.morningTriage.needsReply),
  ['Supplier | Invoice question - Draft ready in Gmail'],
  'Morning Triage needs-reply bullets should parse Slack mrkdwn headings with counts'
);
assert.deepStrictEqual(
  normalize(extractedPayload.morningTriage.reviewThese),
  ['Unknown sender | Banking change - needs judgment'],
  'Morning Triage review-these bullets should parse Slack mrkdwn headings with counts'
);
assert.deepStrictEqual(
  normalize(extractedPayload.morningTriage.bauFollowUps),
  ['IM8 | Weekly report'],
  'Morning Triage FYI bullets should parse Slack mrkdwn headings with counts'
);

const validateNode = workflow.nodes.find((node) => node.name === 'Validate Required Inputs');
assert.match(validateNode.parameters.jsCode, /John morning dump/, 'validation should check John morning dump');
assert.match(validateNode.parameters.jsCode, /Today's Wrap-up/, 'validation should check prior-day EOD');
assert.match(validateNode.parameters.jsCode, /validationPassed/, 'validation should emit a hard-stop flag');
assert.match(validateNode.parameters.jsCode, /missingSources/, 'validation should emit missing source detail');
assert.doesNotMatch(validateNode.parameters.jsCode, /missing\.push\('Morning Triage'\)/, 'validation should not block when Morning Triage is missing');

const promptNode = workflow.nodes.find((node) => node.name === 'Build SOD Prompt');
assert.match(promptNode.parameters.jsCode, /### Today's Goals/, 'prompt should enforce the house heading');
assert.match(promptNode.parameters.jsCode, /\*\*Focus Goals\*\*/, 'prompt should include focus goals section');
assert.match(promptNode.parameters.jsCode, /\*\*Carry-over from Yesterday\*\*/, 'prompt should include carry-over section');
assert.match(promptNode.parameters.jsCode, /\*\*Blocker \/ Input Needed\*\*/, 'prompt should include blockers section');
assert.match(promptNode.parameters.jsCode, /\*\*BAU \/ Follow-ups \(Business As Usual\)\*\*/, 'prompt should include BAU section');

const aiNode = workflow.nodes.find((node) => node.name === 'Generate SOD Report');
assert.strictEqual(aiNode.credentials.openAiApi.id, 'UIREXIYn59JOH1zU');
assert.match(aiNode.parameters.messages.values[0].content, /start-of-day report/i);

const postNode = workflow.nodes.find((node) => node.name === 'Post to Airwallex Drafts');
assert.strictEqual(postNode.parameters.channelId.value, 'C0AQZGJDR38');

const dmNode = workflow.nodes.find((node) => node.name === 'Send SOD to Noa');
assert.strictEqual(dmNode.parameters.channelId.value, 'U06TBGX9L93');

const failureNode = workflow.nodes.find((node) => node.name === 'Post Failure Alert');
assert.strictEqual(failureNode.parameters.channelId.value, 'C0AQZGJDR38');
assert.match(failureNode.parameters.text, /SOD report blocked/, 'failure alert should mention hard-stop validation');
assert.match(failureNode.parameters.text, /manual follow-up/, 'failure alert should cover delivery failures');

assert.ok(workflow.connections['Manual Trigger'], 'manual trigger should be connected');
assert.ok(workflow.connections['Webhook Trigger'], 'webhook trigger should be connected');
assert.ok(workflow.connections['Prepare Drafts Channel'], 'drafts channel prep should be connected');
assert.ok(workflow.connections['Are Inputs Complete?'], 'validation gate should be connected');
assert.ok(workflow.connections['Did Channel Send Fail?'], 'channel delivery gate should be connected');
assert.ok(workflow.connections['Did Noa DM Fail?'], 'DM delivery gate should be connected');
assert.ok(workflow.connections['Retry Noa DM'], 'retry DM node should be connected');
assert.ok(workflow.connections['Did Retry DM Fail?'], 'retry failure gate should be connected');

console.log('SOD report workflow contract check passed.');
