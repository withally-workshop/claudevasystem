export function buildStatusCounts(records) {
  return records.reduce((acc, record) => {
    const key = String(record.status || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function buildRunSummary(campaign, mode, records) {
  const counts = buildStatusCounts(records);

  return [
    `Insense Outreach - ${campaign} - ${mode}`,
    `Qualified: ${counts.qualified || 0}`,
    `Skipped: ${counts.skipped || 0}`,
    `Messaged: ${counts.messaged || 0}`,
    `Already Messaged: ${counts.already_messaged || 0}`,
  ].join('\n');
}

export function buildSlackSummary(campaign, mode, records) {
  const counts = buildStatusCounts(records);
  const autoInviteReady = records.filter(
    (record) => record.status === 'qualified' && record.invite === true,
  ).length;
  const blocklisted = records.filter(
    (record) =>
      record.invite === false &&
      Boolean(record.blockReason) &&
      /previous collaborator/i.test(record.blockReason),
  ).length;

  const lines = [
    '*Insense Outreach Report*',
    `Campaign: ${campaign}`,
    `Mode: ${mode}`,
    `Qualified: ${counts.qualified || 0}`,
    `Skipped: ${counts.skipped || 0}`,
  ];

  if (mode === 'review') {
    lines.push(`Auto-invite ready: ${autoInviteReady}`);
    lines.push(`Blocklisted: ${blocklisted}`);
  }

  if (mode === 'send') {
    lines.push(`Messaged: ${counts.messaged || 0}`);
    lines.push(`Already Messaged: ${counts.already_messaged || 0}`);
  }

  return lines.join('\n');
}

export function buildDailySummary(date, runArtifacts) {
  const campaigns = new Map();
  const totals = {
    reviewed: 0,
    qualified: 0,
    skipped: 0,
    messaged: 0,
    alreadyMessaged: 0,
  };

  for (const artifact of runArtifacts) {
    const campaignName = String(artifact.campaign || 'Unknown Campaign');
    const campaignSummary = campaigns.get(campaignName) || {
      campaign: campaignName,
      reviewed: 0,
      qualified: 0,
      skipped: 0,
      messaged: 0,
      alreadyMessaged: 0,
    };

    const counts = buildStatusCounts(artifact.records || []);
    if (artifact.mode === 'review') {
      campaignSummary.reviewed += (artifact.records || []).length;
      campaignSummary.qualified += counts.qualified || 0;
      campaignSummary.skipped += counts.skipped || 0;
      totals.reviewed += (artifact.records || []).length;
      totals.qualified += counts.qualified || 0;
      totals.skipped += counts.skipped || 0;
    }

    if (artifact.mode === 'send') {
      campaignSummary.messaged += counts.messaged || 0;
      campaignSummary.alreadyMessaged += counts.already_messaged || 0;
      totals.messaged += counts.messaged || 0;
      totals.alreadyMessaged += counts.already_messaged || 0;
    }

    campaigns.set(campaignName, campaignSummary);
  }

  return {
    date,
    campaigns: Array.from(campaigns.values()),
    totals,
  };
}

export function buildDailySlackSummary(summary) {
  const lines = [
    '*Daily Insense Outreach Summary*',
    `Date: ${summary.date}`,
    `Campaigns touched: ${summary.campaigns.length}`,
    `Reviewed: ${summary.totals.reviewed}`,
    `Qualified: ${summary.totals.qualified}`,
    `Skipped: ${summary.totals.skipped}`,
    `Messaged: ${summary.totals.messaged}`,
    `Already Messaged: ${summary.totals.alreadyMessaged}`,
  ];

  for (const campaign of summary.campaigns) {
    lines.push(
      `${campaign.campaign}: Reviewed ${campaign.reviewed}, Qualified ${campaign.qualified}, Skipped ${campaign.skipped}, Messaged ${campaign.messaged}, Already Messaged ${campaign.alreadyMessaged}`,
    );
  }

  return lines.join('\n');
}
