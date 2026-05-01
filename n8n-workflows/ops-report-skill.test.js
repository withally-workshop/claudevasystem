const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const codexSkillPath = '.agents/skills/ops-report/SKILL.md';
const claudeSkillPath = '.claude/skills/ops-report/SKILL.md';

assert.ok(fs.existsSync(path.join(root, codexSkillPath)), 'Expected Codex ops-report skill');
assert.ok(fs.existsSync(path.join(root, claudeSkillPath)), 'Expected Claude ops-report skill');

for (const skillPath of [codexSkillPath, claudeSkillPath]) {
  const skill = read(skillPath);
  assert.match(skill, /ops-report/, `${skillPath} should name ops-report`);
  assert.match(skill, /hey report|ops report|daily report|weekly report/i, `${skillPath} should define report triggers`);
  assert.match(skill, /N8N_API_KEY/, `${skillPath} should document n8n API access`);
  assert.match(skill, /1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50/, `${skillPath} should include tracker spreadsheet ID`);
  assert.match(skill, /C09HN2EBPR7/, `${skillPath} should include payments channel`);
  assert.match(skill, /C0AQZGJDR38/, `${skillPath} should include airwallexdrafts channel`);
  assert.match(skill, /reports\/ops-report/, `${skillPath} should define dashboard output path`);
  assert.match(skill, /live-read only/i, `${skillPath} should preserve live-read-only boundary`);
  assert.match(skill, /Ignore unrelated n8n workspace workflows/i, `${skillPath} should exclude non-project n8n workflows by default`);
  assert.match(skill, /Invoices!A:Z/, `${skillPath} should read tracker attribution columns`);
  assert.match(skill, /Value Summary/, `${skillPath} should lead with visibility scorecards`);
  assert.match(skill, /Invoice Creation/, `${skillPath} should include invoice creation section`);
  assert.match(skill, /Last Follow-Up Sent/, `${skillPath} should document follow-up sent column`);
  assert.match(skill, /Client Reply Status/, `${skillPath} should document reply status column`);
  assert.match(skill, /Follow-Up Attribution/, `${skillPath} should document attribution column`);
  assert.match(skill, /Reply Confidence/, `${skillPath} should document reply confidence column`);
  assert.match(skill, /do not display as a dashboard field/i, `${skillPath} should hide raw follow-up thread ids`);
  assert.match(skill, /paid after follow-up/i, `${skillPath} should report paid-after-follow-up`);
  assert.match(skill, /john@kravemedia\.co/i, `${skillPath} should document John-only reply tracking`);
  assert.match(skill, /source caveats at the bottom/i, `${skillPath} should move caveats to the bottom`);
  assert.doesNotMatch(skill, /write to column N/i, `${skillPath} must not suggest writing formula column N`);
}

const dispatcher = read('.agents/skills/claude-ea-workflows/SKILL.md');
assert.match(dispatcher, /hey report|ops report|daily report|weekly report/i, 'Dispatcher should route report phrases');
assert.match(dispatcher, /\.agents\/skills\/ops-report\/SKILL\.md/, 'Dispatcher should reference Codex skill path');
assert.match(dispatcher, /\.claude\/skills\/ops-report\/SKILL\.md/, 'Dispatcher should reference Claude skill path');

const gitignore = read('.gitignore');
assert.match(gitignore, /^\.superpowers\/$/m, 'Expected .superpowers/ ignored');
assert.match(gitignore, /^reports\/ops-report\/$/m, 'Expected reports/ops-report/ ignored');

console.log('Ops report skill coverage check passed.');
