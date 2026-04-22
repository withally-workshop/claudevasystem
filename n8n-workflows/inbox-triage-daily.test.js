const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-inbox-triage-daily.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-inbox-triage-daily.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Inbox Triage Daily'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'/, 'Expected shared Slack credential id');
assert.match(deploySource, /const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU'/, 'Expected shared OpenAI credential id');
assert.match(deploySource, /const GMAIL_CRED_ID = 'vxHex5lFrkakcsPi'/, 'Expected shared Gmail credential id');
assert.match(deploySource, /const AIRWALLEX_DRAFTS = 'C0AQZGJDR38'/, 'Expected #airwallexdrafts channel id');
assert.match(deploySource, /const NOA_USER_ID = 'U06TBGX9L93'/, 'Expected Noa DM user id');
assert.match(deploySource, /const TIMEZONE = 'Asia\/Manila'/, 'Expected Manila timezone constant');
assert.match(deploySource, /path:\s+'krave-inbox-triage-daily'/, 'Expected manual webhook path');
assert.match(deploySource, /'Schedule 9am ICT Weekdays'/, 'Expected schedule trigger node');
assert.match(deploySource, /'Webhook Trigger'/, 'Expected manual webhook node');
assert.match(deploySource, /'Search Inbox'/, 'Expected Gmail search node');
assert.match(deploySource, /'Get Gmail Labels'/, 'Expected Gmail label lookup node');
assert.match(deploySource, /'Fetch Message Details'/, 'Expected Gmail detail node');
assert.match(deploySource, /'Build Slack Summary'/, 'Expected summary node');
assert.match(deploySource, /'Post to Airwallex Drafts'/, 'Expected channel summary node');
assert.match(deploySource, /'DM Noa Summary'/, 'Expected Noa DM node');
assert.match(deploySource, /scheduleTrigger/, 'Expected schedule trigger node');
assert.match(deploySource, /gmail/i, 'Expected Gmail integration in deploy script');
assert.match(deploySource, /gmailOAuth2/, 'Expected Gmail OAuth credential wiring in deploy script');
assert.match(deploySource, /slack/i, 'Expected Slack integration in deploy script');
assert.match(deploySource, /openAi/i, 'Expected OpenAI integration in deploy script');
assert.match(deploySource, /in:inbox after:/, 'Expected inbox-after-date Gmail query');
assert.match(deploySource, /gmail-message-id|message_id/, 'Expected normalized message id field');
assert.match(deploySource, /thread_id/, 'Expected normalized thread id field');
assert.match(deploySource, /from_name/, 'Expected normalized sender name field');
assert.match(deploySource, /from_email/, 'Expected normalized sender email field');
assert.match(deploySource, /subject/, 'Expected normalized subject field');
assert.match(deploySource, /snippet/, 'Expected normalized snippet field');
assert.match(deploySource, /body_preview/, 'Expected normalized body preview field');
assert.match(deploySource, /received_at/, 'Expected normalized timestamp field');
assert.match(deploySource, /Intl\.DateTimeFormat/, 'Expected runtime date formatting for Manila timezone');
assert.match(deploySource, /runOnceForEachItem/, 'Expected per-message normalization');
assert.match(deploySource, /EA\/Urgent/, 'Expected urgent tier constant');
assert.match(deploySource, /EA\/Needs-Reply/, 'Expected needs-reply tier constant');
assert.match(deploySource, /EA\/FYI/, 'Expected FYI tier constant');
assert.match(deploySource, /EA\/Auto-Sorted/, 'Expected auto-sorted tier constant');
assert.match(deploySource, /EA\/Unsure/, 'Expected unsure tier constant');
assert.match(deploySource, /Amanda|Shin|Joshua|Amy|Shuo Shimpa|IM8/i, 'Expected known-contact protection list');
assert.match(deploySource, /legal|contract|overdue|deadline today|payment risk/i, 'Expected urgent keyword guardrails');
assert.match(deploySource, /newsletter|receipt|noreply@|no-reply@/i, 'Expected auto-sorted keyword guardrails');
assert.match(deploySource, /never auto-sort known contacts|known contacts/i, 'Expected explicit known-contact comment or code');
assert.match(deploySource, /'AI Classifier'/, 'Expected AI classifier node');
assert.match(deploySource, /'Draft Reply'/, 'Expected draft-generation node');
assert.match(deploySource, /Return JSON only/i, 'Expected structured AI response instructions');
assert.match(deploySource, /EA\/Urgent[\s\S]*EA\/Needs-Reply[\s\S]*EA\/FYI[\s\S]*EA\/Auto-Sorted[\s\S]*EA\/Unsure/, 'Expected allowed tier list in prompt');
assert.match(deploySource, /Krave|IM8|Halo-Home|Skyvane|Invoices|Contracts|Receipts|Suppliers/, 'Expected starter context labels');
assert.match(deploySource, /3-and-1 Framework/, 'Expected 3-and-1 drafting instruction');
assert.match(deploySource, /No filler|direct|outcome-oriented/i, 'Expected Noa voice guidance');
assert.match(deploySource, /Draft ready in Gmail/i, 'Expected summary wording for drafted messages');
assert.match(deploySource, /'Create Gmail Draft'/, 'Expected Gmail draft node');
assert.match(deploySource, /'Apply Tier Label'/, 'Expected Gmail tier label node');
assert.match(deploySource, /'Apply Context Label'/, 'Expected Gmail context label node');
assert.match(deploySource, /tier_label_id/, 'Expected resolved Gmail tier label ids');
assert.match(deploySource, /context_label_id/, 'Expected resolved Gmail context label ids');
assert.ok(
  !deploySource.includes("labelIds: '={{ [$json.tier_label_name] }}'"),
  'Expected Gmail tier label application to stop sending label names where Gmail requires label ids'
);
assert.ok(
  !deploySource.includes("labelIds: '={{ $json.context_label_name ? [$json.context_label_name] : [] }}'"),
  'Expected Gmail context label application to stop sending label names where Gmail requires label ids'
);
assert.ok(
  deploySource.includes("labelIds: '={{ $json.tier_label_id ? [$json.tier_label_id] : [] }}'"),
  'Expected Gmail tier label application to use resolved label ids'
);
assert.ok(
  deploySource.includes("labelIds: '={{ $json.context_label_id ? [$json.context_label_id] : [] }}'"),
  'Expected Gmail context label application to use resolved label ids'
);
assert.match(deploySource, /'Archive Non-Unsure'/, 'Expected Gmail archive node');
assert.match(deploySource, /EA\/Unsure/, 'Expected unsure branch handling');
assert.match(deploySource, /removeLabelIds/i, 'Expected archive step to remove INBOX');
assert.match(deploySource, /INBOX/, 'Expected explicit inbox removal target');
assert.match(deploySource, /draft_required/, 'Expected draft gating field');
assert.match(deploySource, /if\s*\(\$json\.tier === 'EA\/Unsure'\)|EA\/Unsure[\s\S]*remain/i, 'Expected unsure retention logic');
assert.match(deploySource, /Morning Triage/i, 'Expected morning-triage summary header');
assert.match(deploySource, /\[URGENT\]|Needs Your Reply|Review These|Auto-Sorted/i, 'Expected summary sections');
assert.match(deploySource, /Inbox: /, 'Expected final inbox count line');
assert.match(deploySource, /'Did Channel Send Fail\?'/, 'Expected channel send retry decision');
assert.match(deploySource, /'Did Noa DM Fail\?'/, 'Expected DM retry decision');
assert.match(deploySource, /'Post Failure Alert'/, 'Expected failure alert node');
assert.match(deploySource, /C0AQZGJDR38/, 'Expected failure alerts to route to #airwallexdrafts');
assert.match(deploySource, /U06TBGX9L93/, 'Expected Noa DM destination');
assert.match(deploySource, /select:\s+'channel'/, 'Expected Slack nodes to use channel selection mode');
assert.match(deploySource, /channelId:\s+\{ __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' \}/, 'Expected archive channel to use Slack channelId');
assert.match(deploySource, /channelId:\s+\{ __rl: true, value: NOA_USER_ID, mode: 'id' \}/, 'Expected Noa DM to use Slack channelId');
assert.match(readmeDoc, /Inbox Triage Daily/, 'Expected workflow listed in README');
assert.match(readmeDoc, /Gmail drafts/i, 'Expected README to document draft-only email behavior');
assert.match(readmeDoc, /EA\/Unsure/i, 'Expected README to document inbox retention for unsure emails');
assert.match(readmeDoc, /#airwallexdrafts/i, 'Expected README to document archive channel summary');
assert.match(readmeDoc, /Noa/i, 'Expected README to document Noa DM delivery');
assert.match(workflowsDoc, /Inbox Triage Daily/, 'Expected workflow listed in WORKFLOWS.md');
assert.match(workflowsDoc, /krave-inbox-triage-daily/, 'Expected manual webhook documented');
assert.match(workflowsDoc, /EA\/Urgent[\s\S]*EA\/Needs-Reply[\s\S]*EA\/FYI[\s\S]*EA\/Auto-Sorted[\s\S]*EA\/Unsure/, 'Expected tier model documented');
assert.match(workflowsDoc, /Krave|IM8|Halo-Home|Skyvane|Invoices|Contracts|Receipts|Suppliers/, 'Expected starter context labels documented');
assert.match(workflowsDoc, /draft only|never send/i, 'Expected non-sending behavior documented');

console.log('Inbox triage daily workflow contract check passed.');
