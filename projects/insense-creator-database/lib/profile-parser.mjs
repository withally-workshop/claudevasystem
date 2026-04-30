function parseInteger(text) {
  const match = String(text || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parsePercent(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (String(value || '').trim()) {
      return String(value).trim();
    }
  }

  return '';
}

export function parseProfileStats(rawProfile) {
  const displayName = firstNonEmpty(rawProfile.displayName, rawProfile.username);
  const username = String(rawProfile.username || '').trim();
  const firstNameSource = displayName.replace(/^@/, '').trim();
  const firstName = firstNameSource ? firstNameSource.split(/\s+/)[0] : '';

  return {
    displayName,
    firstName,
    username,
    portfolioUploads: parseInteger(rawProfile.uploadsText),
    finishedDeals: parseInteger(rawProfile.dealsText),
    engagementRate: parsePercent(rawProfile.engagementText),
  };
}

export function parseProfileDrawerText(drawerText) {
  const text = String(drawerText || '');

  return {
    finishedDeals: parseInteger(
      text.match(/(\d+)\s+finished deals/i)?.[0] || '',
    ),
    portfolioUploads: parseInteger(
      text.match(/(\d+)\s+uploads?\s+in\s+\d+\s+different categories/i)?.[0] ||
        '',
    ),
    engagementRate: parsePercent(
      text.match(/(\d+(?:\.\d+)?)%\s+Engagement rate/i)?.[0] || '',
    ),
  };
}
