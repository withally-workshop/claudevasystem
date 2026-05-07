import fs from 'node:fs';
import path from 'node:path';

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return filePath;
}

export function writeReviewArtifact(root, campaignSlug, records) {
  return writeJson(path.join(root, 'runs', `${campaignSlug}-review.json`), {
    records,
  });
}

export function writeDecisionSeed(root, campaignSlug, records, extras = {}) {
  const payload = { records, ...extras };
  return writeJson(path.join(root, 'decisions', `${campaignSlug}.json`), payload);
}

export function writeSendArtifact(root, campaignSlug, records) {
  return writeJson(path.join(root, 'runs', `${campaignSlug}-send.json`), {
    records,
  });
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function writeDailySummaryArtifact(root, dateKey, summary) {
  return writeJson(path.join(root, 'runs', `daily-summary-${dateKey}.json`), summary);
}

export function listRunArtifactsForLocalDate(root, date = new Date()) {
  const runsDir = path.join(root, 'runs');
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const dateKey = formatLocalDate(date);

  return fs
    .readdirSync(runsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(runsDir, name);
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        name,
        modifiedAt: stat.mtime,
        dateKey: formatLocalDate(stat.mtime),
      };
    })
    .filter((entry) => entry.dateKey === dateKey);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readDecisionSeed(root, campaignSlug) {
  return readJson(path.join(root, 'decisions', `${campaignSlug}.json`));
}

export function readCreatorCache(root) {
  return readJson(path.join(root, 'creator-cache.json'));
}

export function writeCreatorCache(root, cache) {
  return writeJson(path.join(root, 'creator-cache.json'), cache);
}

export function readReviewHistory(root) {
  const filePath = path.join(root, 'review-history.json');
  if (!fs.existsSync(filePath)) {
    return { campaigns: {} };
  }

  return readJson(filePath);
}

export function writeReviewHistory(root, history) {
  return writeJson(path.join(root, 'review-history.json'), history);
}
