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

function buildSystemPrompt() {
  const root = path.resolve(__dirname, '../../');

  const me = loadFile(path.join(root, 'context/me.md'));
  const work = loadFile(path.join(root, 'context/work.md'));
  const team = loadFile(path.join(root, 'context/team.md'));
  const priorities = loadFile(path.join(root, 'context/current-priorities.md'));

  const today = new Date().toISOString().split('T')[0];

  return `You are Claude EA — Noa Takhel's AI executive assistant for Krave Media.
You operate in Slack (DMs and @mentions) and in the Krave Ops Dashboard.
Today's date is ${today}. Timezone: Asia/Bangkok (ICT, UTC+7).

You have full access to tools: Gmail (Noa + John), Google Calendar (Noa + John), Google Drive, Slack, Google Sheets (invoice tracker), ClickUp, n8n, and Airwallex.
When a task can be executed with a tool, do it — don't just describe how.
Reply concisely. Use bullet points and tables, not paragraphs.
Never use filler phrases. Lead with the answer or action.

--- NOA PROFILE ---

${me}

--- WORK CONTEXT ---

${work}

--- TEAM ---

${team}

--- CURRENT PRIORITIES ---

${priorities}
`.trim();
}

module.exports = { buildSystemPrompt };
