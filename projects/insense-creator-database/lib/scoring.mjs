const ENGAGEMENT_WEIGHT = 40;
const DEALS_WEIGHT = 30;
const FOLLOWERS_WEIGHT = 15;
const UPLOADS_WEIGHT = 15;

const ENGAGEMENT_CAP = 10;
const DEALS_CAP = 20;
const FOLLOWERS_CAP = 500_000;
const UPLOADS_CAP = 10;

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function logNormalize(value, cap) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clamp01(Math.log10(value + 1) / Math.log10(cap + 1));
}

function parseFollowers(profile) {
  if (Number.isFinite(profile.followers)) return Number(profile.followers);
  const text = String(profile.followersText || '').replace(/[,\s]/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)([kKmM]?)/);
  if (!match) return 0;
  const raw = Number(match[1]);
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') return Math.round(raw * 1_000);
  if (suffix === 'm') return Math.round(raw * 1_000_000);
  return Math.round(raw);
}

export function scoreProfile(profile) {
  const engagement = clamp01(Number(profile.engagementRate || 0) / ENGAGEMENT_CAP) * ENGAGEMENT_WEIGHT;
  const deals = logNormalize(Number(profile.finishedDeals || 0), DEALS_CAP) * DEALS_WEIGHT;
  const followers = logNormalize(parseFollowers(profile), FOLLOWERS_CAP) * FOLLOWERS_WEIGHT;
  const uploads = clamp01(Number(profile.portfolioUploads || 0) / UPLOADS_CAP) * UPLOADS_WEIGHT;

  return Math.round(engagement + deals + followers + uploads);
}
