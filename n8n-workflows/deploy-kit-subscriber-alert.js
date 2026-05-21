const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'dtrTee7qEgLdR9hQ';

// Kit webhook setup (manual — one time):
//   Kit → Settings → Webhooks → New Webhook
//   Event: subscriber.tag_add
//   Target URL: https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber
//   No additional filtering needed — workflow filters for resource-claimed tag internally

function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Activating Kit Subscriber Alert workflow:', WORKFLOW_ID);

  const payload = JSON.stringify({ active: true });

  const options = {
    hostname: 'noatakhel.app.n8n.cloud',
    path: `/api/v1/workflows/${WORKFLOW_ID}/activate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': API_KEY,
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Workflow activated.');
        console.log('Webhook URL: https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber');
        console.log('');
        console.log('⚠️  IMPORTANT: Configure the Kit webhook if not done already:');
        console.log('   Kit → Settings → Webhooks → New Webhook');
        console.log('   Event: subscriber.tag_add');
        console.log('   URL: https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber');
      } else {
        console.error('Failed to activate:', res.statusCode, data);
      }
    });
  });

  req.on('error', (e) => { console.error('Request error:', e); });
  req.write(payload);
  req.end();
}

deploy();
