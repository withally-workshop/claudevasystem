const https = require('https');

const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'wNXs7wqHz5d5naJN';

// Prerequisites before activating:
//   1. Verify APIFY_API_KEY is set in n8n Settings → Environment Variables
//   2. Test the Apify actor apify~linkedin-profile-scraper against
//      https://www.linkedin.com/in/noatakhel and confirm it returns posts.
//      If it returns profile data only (no posts), swap the actor to:
//      bebity~linkedin-profile-posts-scraper or similar.
//   3. Run the workflow manually once via n8n UI to seed the static data
//      (last known post ID). Otherwise the first real run will alert on
//      a post that is already live.

function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Activating LinkedIn Post Monitor workflow:', WORKFLOW_ID);

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
        console.log('Fires: every 30 minutes, all day, every day');
        console.log('Alerts to: #noa-linkedin-posts when a new post is detected on https://www.linkedin.com/in/noatakhel');
        console.log('n8n URL: https://noatakhel.app.n8n.cloud/workflow/wNXs7wqHz5d5naJN');
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
