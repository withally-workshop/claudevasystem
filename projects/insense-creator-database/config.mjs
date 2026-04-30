import { fileURLToPath } from 'node:url';

export const REVIEW_FIXTURE_RECORDS = [
  {
    creatorKey: 'fixture:jane-doe',
    displayName: 'Jane Doe',
    firstName: 'Jane',
    username: '@janedoeugc',
    portfolioUploads: 2,
    finishedDeals: 1,
    engagementRate: 1.8,
  },
  {
    creatorKey: 'fixture:new-creator',
    displayName: 'New Creator',
    firstName: 'New',
    username: '@newcreator',
    portfolioUploads: 0,
    finishedDeals: 1,
    engagementRate: 2.4,
  },
];

export const INSENSE_BASE_URL = 'https://app.insense.pro';
export const INSENSE_SIGNIN_URL = `${INSENSE_BASE_URL}/signin`;
export const INSENSE_CAMPAIGNS_URL = `${INSENSE_BASE_URL}/campaigns`;
export const INSENSE_REPORT_SLACK_CHANNEL_ID =
  process.env.INSENSE_SLACK_CHANNEL_ID || 'C0AQZGJDR38';
export const STORAGE_STATE_PATH = fileURLToPath(
  new URL('./data/storage-state.json', import.meta.url),
);

export function getInsenseCredentials() {
  const email = process.env.INSENSE_EMAIL || 'noa@kravemedia.co';
  const password = process.env.INSENSE_PASSWORD;

  if (!password) {
    throw new Error('Missing required INSENSE_PASSWORD environment variable');
  }

  return { email, password };
}

export function getSlackReportingConfig() {
  return {
    token:
      process.env.INSENSE_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || '',
    channelId: INSENSE_REPORT_SLACK_CHANNEL_ID,
  };
}
