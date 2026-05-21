const https = require('https');

const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '220OeHs02nwJleCT';

// Requires: ClickUp Header Auth credential in n8n (same one used by LinkedIn Resource Post Alert)
// Schedule: 10AM PHT Mon–Fri
// Alerts #noa-linkedin-posts if no post is marked `posted` in ClickUp by 10AM

function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Activating LinkedIn Post Consistency Check workflow:', WORKFLOW_ID);

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
        console.log('Fires: 10AM PHT Mon–Fri');
        console.log('Alerts to: #noa-linkedin-posts if no post marked posted today');
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
