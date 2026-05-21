const https = require('https');

const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'G39y9GgsrhnvC91C';

// Requires: "Kit API" Header Auth credential in n8n
//   Header Value: Bearer {kit_api_secret}
//   Kit API secret: app.kit.com → Settings → Developer → API Secret
// Schedule: every Monday 9AM PHT
// Posts to #noa-linkedin-posts with last 7 days resource sign-up breakdown

function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Activating Weekly Resource Conversion Report workflow:', WORKFLOW_ID);

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
        console.log('Fires: every Monday 9AM PHT');
        console.log('Posts: weekly resource subscriber breakdown to #noa-linkedin-posts');
        console.log('');
        console.log('⚠️  Requires "Kit API" Header Auth credential in n8n:');
        console.log('   Go to: https://noatakhel.app.n8n.cloud/credentials');
        console.log('   Create: Header Auth credential named "Kit API"');
        console.log('   Value: Bearer {your Kit API secret from app.kit.com → Settings → Developer}');
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
