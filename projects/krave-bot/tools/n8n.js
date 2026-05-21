'use strict';

const https = require('https');

const N8N_BASE = 'noatakhel.app.n8n.cloud';

function n8nGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: N8N_BASE, path: `/api/v1${path}`, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
  });
}

function n8nPost(path, payload) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(payload));
    const req = https.request({
      hostname: N8N_BASE, path: `/api/v1${path}`, method: 'POST',
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json', 'Content-Length': buf.length },
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

async function listWorkflows() {
  const res = await n8nGet('/workflows?limit=50');
  if (!res.ok) return { error: 'n8n API error' };
  return { workflows: (res.body.data || []).map((w) => ({ id: w.id, name: w.name, active: w.active })) };
}

async function getExecutions({ workflowId, limit = 10 }) {
  const q = workflowId ? `?workflowId=${workflowId}&limit=${limit}` : `?limit=${limit}`;
  const res = await n8nGet(`/executions${q}`);
  if (!res.ok) return { error: 'n8n API error' };
  return {
    executions: (res.body.data || []).map((e) => ({
      id: e.id, workflowId: e.workflowId, status: e.status,
      startedAt: e.startedAt, stoppedAt: e.stoppedAt,
      name: e.workflowData && e.workflowData.name,
    })),
  };
}

async function triggerWorkflow({ workflowId }) {
  const res = await n8nPost(`/workflows/${workflowId}/run`, {});
  return res.ok ? { ok: true, executionId: res.body.data && res.body.data.executionId } : { error: 'Failed to trigger workflow' };
}

module.exports = {
  definitions: [
    {
      name: 'n8n_list_workflows',
      description: 'List all n8n workflows with their IDs, names, and active status.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'n8n_get_executions',
      description: 'Get recent n8n workflow executions. Optionally filter by workflowId.',
      input_schema: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'Filter to a specific workflow ID (optional)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
    {
      name: 'n8n_trigger_workflow',
      description: 'Manually trigger an n8n workflow by ID.',
      input_schema: {
        type: 'object',
        properties: { workflowId: { type: 'string', description: 'n8n workflow ID' } },
        required: ['workflowId'],
      },
    },
  ],
  handlers: { n8n_list_workflows: listWorkflows, n8n_get_executions: getExecutions, n8n_trigger_workflow: triggerWorkflow },
};
