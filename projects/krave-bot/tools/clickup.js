'use strict';

const https = require('https');

function cuGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: process.env.CLICKUP_API_KEY } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
  });
}

function cuPost(path, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(payload));
    const req = https.request({
      hostname: 'api.clickup.com', path: `/api/v2${path}`, method,
      headers: { Authorization: process.env.CLICKUP_API_KEY, 'Content-Type': 'application/json', 'Content-Length': buf.length },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function getTasks({ list_id, include_closed = false }) {
  const listId = list_id || process.env.CLICKUP_LIST_ID;
  const res = await cuGet(`/list/${listId}/task?include_closed=${include_closed}&subtasks=false`);
  if (!res.ok) return { error: `ClickUp error: ${res.body && res.body.err}` };
  return {
    tasks: (res.body.tasks || []).map((t) => ({
      id: t.id, name: t.name,
      status: t.status && t.status.status,
      assignees: (t.assignees || []).map((a) => a.username),
      url: `https://app.clickup.com/t/${t.id}`,
      date_updated: t.date_updated,
    })),
  };
}

async function getTask({ task_id }) {
  const res = await cuGet(`/task/${task_id}`);
  if (!res.ok) return { error: 'Task not found' };
  const t = res.body;
  return { id: t.id, name: t.name, status: t.status && t.status.status, description: t.description, assignees: (t.assignees || []).map((a) => a.username), url: `https://app.clickup.com/t/${t.id}` };
}

async function createTask({ name, description, assignees, status, list_id }) {
  const listId = list_id || process.env.CLICKUP_LIST_ID;
  const payload = { name };
  if (description) payload.description = description;
  if (assignees) payload.assignees = assignees;
  if (status) payload.status = status;
  const res = await cuPost(`/list/${listId}/task`, payload);
  return res.ok ? { ok: true, id: res.body.id, url: `https://app.clickup.com/t/${res.body.id}` } : { error: 'Failed to create task' };
}

async function updateTask({ task_id, name, description, status }) {
  const payload = {};
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (status) payload.status = status;
  const res = await cuPost(`/task/${task_id}`, payload, 'PUT');
  return res.ok ? { ok: true } : { error: 'Failed to update task' };
}

module.exports = {
  definitions: [
    {
      name: 'clickup_get_tasks',
      description: 'Get active tasks from the Krave ClickUp list.',
      input_schema: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'ClickUp list ID (defaults to CLICKUP_LIST_ID env var)' },
          include_closed: { type: 'boolean', description: 'Include closed tasks (default false)' },
        },
      },
    },
    {
      name: 'clickup_get_task',
      description: 'Get details of a specific ClickUp task by ID.',
      input_schema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'ClickUp task ID' } },
        required: ['task_id'],
      },
    },
    {
      name: 'clickup_create_task',
      description: 'Create a new task in the Krave ClickUp list.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          list_id: { type: 'string', description: 'ClickUp list ID (optional, defaults to Krave UGC list)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'clickup_update_task',
      description: 'Update a ClickUp task — name, description, or status.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['task_id'],
      },
    },
  ],
  handlers: { clickup_get_tasks: getTasks, clickup_get_task: getTask, clickup_create_task: createTask, clickup_update_task: updateTask },
};
