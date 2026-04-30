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

export function evaluateInvitePolicy(profile) {
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

  return {
    invite: true,
    blockReason: '',
  };
}
