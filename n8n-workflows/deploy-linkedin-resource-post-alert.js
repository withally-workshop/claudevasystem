const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'Rw2VZ6sAzAhJteyJ';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';

// ClickUp credential must be created manually in n8n:
//   Credentials → New → Header Auth
//   Name: "ClickUp Header Auth"
//   Header Name: Authorization
//   Header Value: <your ClickUp API token>
// Then update CLICKUP_CRED_ID below with the credential ID.
const CLICKUP_CRED_ID = process.env.CLICKUP_CRED_ID;

// ClickUp LinkedIn Post list — sourced from the LinkedIn Post space
const CLICKUP_LIST_ID = '901818102123';

// Custom field IDs (from ClickUp task #86exkj821)
// Stage field: value 3 = "posted"
// Post Type field: option UUID aa47b15d = "resource-promo"
// Resource field: orderindex 1-7 maps to trigger words
// Hook field: short text, post's opening line

function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Activating LinkedIn Resource Post Alert workflow:', WORKFLOW_ID);

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
        console.log('⚠️  IMPORTANT: You must configure the ClickUp Header Auth credential in n8n before the workflow will run correctly.');
        console.log('   Go to: https://noatakhel.app.n8n.cloud/credentials');
        console.log('   Create: Header Auth credential named "ClickUp Header Auth"');
        console.log('   Header Name: Authorization');
        console.log('   Header Value: <your ClickUp API token from app.clickup.com/settings/account>');
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
