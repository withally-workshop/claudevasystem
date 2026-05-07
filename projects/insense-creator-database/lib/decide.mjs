export const INVITE_PENDING = 'pending';

export function evaluateProfile(profile) {
  const portfolioUploads = Number(profile.portfolioUploads || 0);
  const finishedDeals = Number(profile.finishedDeals || 0);
  const engagementRate = Number(profile.engagementRate || 0);

  if (portfolioUploads < 1) {
    return {
      passesQuality: false,
      skipReason: 'No portfolio uploads',
      requiresOperatorDecision: false,
    };
  }

  if (finishedDeals < 1) {
    return {
      passesQuality: false,
      skipReason: 'No finished deals',
      requiresOperatorDecision: false,
    };
  }

  if (engagementRate < 1) {
    return {
      passesQuality: false,
      skipReason: 'Engagement rate below 1%',
      requiresOperatorDecision: false,
    };
  }

  return {
    passesQuality: true,
    skipReason: '',
    requiresOperatorDecision: true,
  };
}

export function lookupCachedInvite(cache, creatorKey) {
  const entry = cache?.creators?.[creatorKey];
  if (!entry) return null;
  const status = String(entry.status || '');
  if (status === 'messaged' || status === 'ready_to_send' || status === 'already_messaged') {
    return {
      status,
      campaign: entry.campaign || '',
    };
  }
  return null;
}

export function evaluateInvitePolicy(profile, options = {}) {
  if (!profile.passesQuality) {
    return {
      invite: false,
      blockReason: profile.skipReason || 'Did not meet quality thresholds',
    };
  }

  if (profile.previousCollaborator) {
    return {
      invite: false,
      blockReason: 'Previous collaborator',
    };
  }

  const { cache, creatorKey, campaign } = options;
  if (cache && creatorKey) {
    const cached = lookupCachedInvite(cache, creatorKey);
    if (cached) {
      const priorCampaign = cached.campaign && cached.campaign !== campaign ? cached.campaign : '';
      return {
        invite: false,
        blockReason: priorCampaign
          ? `Already invited from ${priorCampaign}`
          : 'Already invited from a prior campaign',
      };
    }
  }

  if (options.useApprovalGate) {
    return {
      invite: INVITE_PENDING,
      blockReason: '',
    };
  }

  return {
    invite: true,
    blockReason: '',
  };
}
