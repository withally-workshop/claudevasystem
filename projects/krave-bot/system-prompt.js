'use strict';

const fs = require('fs');
const path = require('path');

function loadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function loadSkills(root) {
  const skillsDir = path.join(root, '.claude/skills');
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const content = loadFile(path.join(skillsDir, e.name, 'SKILL.md'));
        return content ? `### Skill: ${e.name}\n${content}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
}

function buildSystemPrompt() {
  const root = path.resolve(__dirname, '../../');

  const claudeMd = loadFile(path.join(root, 'CLAUDE.md'));
  const me = loadFile(path.join(root, 'context/me.md'));
  const work = loadFile(path.join(root, 'context/work.md'));
  const team = loadFile(path.join(root, 'context/team.md'));
  const priorities = loadFile(path.join(root, 'context/current-priorities.md'));
  const skills = loadSkills(root);

  const today = new Date().toISOString().split('T')[0];

  return `You are Claude EA — Noa Takhel's AI executive assistant for Krave Media.
You operate in Slack (DMs and @mentions) and in the Krave Ops Dashboard.
Today's date is ${today}.

You have full access to tools: Slack, Gmail (Noa + John), Google Sheets (invoice tracker), ClickUp, n8n, and Airwallex.
When a task can be executed with a tool, do it — don't just describe how.
Reply concisely. Use bullet points and tables, not paragraphs.
Never use filler phrases. Lead with the answer or action.

--- WORKSPACE CONTEXT ---

${claudeMd}

--- NOA PROFILE ---

${me}

--- WORK CONTEXT ---

${work}

--- TEAM ---

${team}

--- CURRENT PRIORITIES ---

${priorities}

--- AVAILABLE SKILLS ---

These are the operational skills you can execute. When a user's request matches a skill's trigger phrases or purpose, run it using your tools rather than just describing it.

${skills}
`.trim();
}

module.exports = { buildSystemPrompt };
