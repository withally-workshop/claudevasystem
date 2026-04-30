import { createSession } from '../lib/insense-session.mjs';

const session = await createSession({ headless: true });
await session.gotoCampaigns();
if (!session.page.url().includes('/campaigns')) {
  throw new Error(`Expected campaigns page, got ${session.page.url()}`);
}
console.log('ok');
await session.close();
