const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.KEEPALIVE_WORKFLOW_ID || '';

const workflow = {
  name: 'Krave — Bot Keep-Alive Ping',
  settings: { executionOrder: 'v1', saveManualExecutions: false, timezone: 'Asia/Manila' },
  nodes: [
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [200, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '*/10 * * * *' }] },
      },
    },
    {
      id: 'n2', name: 'Ping krave-bot',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [440, 200],
      continueOnFail: true,
      parameters: {
        method: 'GET',
        url: 'https://krave-ai.onrender.com/health',
        options: { timeout: 10000 },
      },
    },
  ],
  connections: {
    'Schedule Trigger': { main: [[{ node: 'Ping krave-bot', type: 'main', index: 0 }]] },
  },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  let result;
  if (WORKFLOW_ID) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  } else {
    result = await n8nRequest('POST', `/api/v1/workflows`, workflow);
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 1000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Pings https://krave-ai.onrender.com/health every 10 minutes');
  console.log('Next: set KEEPALIVE_WORKFLOW_ID=' + result.id + ' in .env');
}

deploy().catch(console.error);
