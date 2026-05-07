import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getSlackReportingConfig,
  REVIEW_FIXTURE_RECORDS,
} from './config.mjs';
import {
  buildPaginatedCreatorsListRequest,
  collectApplicantPool,
  closeTopDrawer,
  closeApplicantProfile,
  extractApplicantsFromCreatorsListPayload,
  extractApplicantDrawerStats,
  inspectWorkspaceContext,
  openApplicantChatComposer,
  openApplicantProfile,
  openApplicantProfileByUsername,
  openCampaignApplications,
} from './lib/applications.mjs';
import { parseArgs } from './lib/cli.mjs';
import { evaluateInvitePolicy, evaluateProfile } from './lib/decide.mjs';
import { createSession } from './lib/insense-session.mjs';
import { sendInviteIfEligible, validateDecisionRecord } from './lib/messaging.mjs';
import { parseProfileDrawerText, parseProfileStats } from './lib/profile-parser.mjs';
import { buildDailySlackSummary, buildDailySummary, buildRunSummary } from './lib/reporter.mjs';
import { postCandidateThread, sendSlackSummary, sendSlackText } from './lib/slack-report.mjs';
import { scoreProfile } from './lib/scoring.mjs';
import { collectApprovalsFromSlack } from './lib/approvals.mjs';
import {
  listRunArtifactsForLocalDate,
  readCreatorCache,
  readDecisionSeed,
  readJson,
  readReviewHistory,
  writeCreatorCache,
  writeDailySummaryArtifact,
  writeDecisionSeed,
  writeReviewHistory,
  writeReviewArtifact,
  writeSendArtifact,
} from './lib/state-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function slugifyCampaign(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function humanizeCampaignSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getCampaignReviewBucket(history, campaignSlug) {
  if (!history.campaigns) {
    history.campaigns = {};
  }

  if (!history.campaigns[campaignSlug]) {
    history.campaigns[campaignSlug] = { creators: {} };
  }

  if (!history.campaigns[campaignSlug].creators) {
    history.campaigns[campaignSlug].creators = {};
  }

  return history.campaigns[campaignSlug].creators;
}

function resetCampaignReviewBucket(history, campaignSlug) {
  if (!history.campaigns) {
    history.campaigns = {};
  }

  history.campaigns[campaignSlug] = { creators: {} };
}

function filterUnreviewedByCampaign(records, campaignSlug, history) {
  const creators = getCampaignReviewBucket(history, campaignSlug);
  return records.filter((record) => !creators[record.creatorKey]);
}

function markReviewedRecords(history, campaignSlug, records) {
  const creators = getCampaignReviewBucket(history, campaignSlug);
  const reviewedAt = new Date().toISOString();

  for (const record of records) {
    creators[record.creatorKey] = {
      reviewedAt,
      username: record.username,
      displayName: record.displayName,
      campaign: record.campaign,
      status: record.status,
    };
  }
}

function loadDailyRunArtifacts(dataRoot, date = new Date()) {
  return listRunArtifactsForLocalDate(dataRoot, date)
    .filter((artifact) => !artifact.name.startsWith('daily-summary-'))
    .map((artifact) => {
      const payload = readJson(artifact.path);
      const modeMatch = artifact.name.match(/^(.*?)-(review|send)\.json$/i);
      const campaignSlug = modeMatch?.[1] || artifact.name.replace(/\.json$/i, '');
      const mode = String(modeMatch?.[2] || 'unknown').toLowerCase();
      const records = Array.isArray(payload.records) ? payload.records : [];
      const campaign =
        records.find((record) => typeof record?.campaign === 'string' && record.campaign.trim())
          ?.campaign || humanizeCampaignSlug(campaignSlug);

      return {
        campaign,
        mode,
        records,
        path: artifact.path,
        name: artifact.name,
      };
    })
    .filter((artifact) => artifact.mode === 'review' || artifact.mode === 'send');
}

function buildFixtureReviewRecords(campaign, cache = { creators: {} }, useApprovalGate = false) {
  return REVIEW_FIXTURE_RECORDS.map((record) => {
    const qualityDecision = evaluateProfile(record);
    const profileForPolicy = {
      ...record,
      ...qualityDecision,
      previousCollaborator: Boolean(record.previousCollaborator),
    };
    const invitePolicy = evaluateInvitePolicy(profileForPolicy, {
      cache,
      creatorKey: record.creatorKey,
      campaign,
      useApprovalGate,
    });

    return {
      ...record,
      campaign,
      ...qualityDecision,
      previousCollaborator: Boolean(record.previousCollaborator),
      score: scoreProfile(profileForPolicy),
      niches: Array.isArray(record.niches) ? record.niches : [],
      invite: invitePolicy.invite,
      blockReason: invitePolicy.blockReason,
      notes: '',
      status: qualityDecision.passesQuality ? 'qualified' : 'skipped',
    };
  });
}

function buildReviewRecord({
  campaign,
  applicant,
  normalized,
  decision,
  invitePolicy,
  niches,
  score,
}) {
  return {
    creatorKey: applicant.creatorKey,
    campaign,
    displayName: normalized.displayName,
    firstName: normalized.firstName,
    username: normalized.username,
    country: applicant.country,
    rate: applicant.rate,
    rating: applicant.rating,
    followersText: applicant.followersText,
    engagementText: applicant.engagementText,
    socialHref: applicant.socialHref,
    previousCollaborator: Boolean(applicant.previousCollaborator),
    portfolioUploads: normalized.portfolioUploads,
    finishedDeals: normalized.finishedDeals,
    engagementRate: normalized.engagementRate,
    niches: niches || [],
    score: score || 0,
    passesQuality: decision.passesQuality,
    skipReason: decision.skipReason,
    requiresOperatorDecision: decision.requiresOperatorDecision,
    invite: invitePolicy.invite,
    blockReason: invitePolicy.blockReason,
    notes: '',
    status: decision.passesQuality ? 'qualified' : 'skipped',
  };
}

async function buildLiveReviewRecords({ campaign, page, limit, cache = { creators: {} } }) {
  await openCampaignApplications(page, campaign);
  const applicants = await collectVisibleApplicantSummaries(page, limit);
  const records = [];

  for (const applicant of applicants) {
    await openApplicantProfile(page, applicant);

    try {
      const drawerStats = await extractApplicantDrawerStats(page, applicant);
      const drawerParsed = parseProfileDrawerText(drawerStats.drawerText);
      const normalized = parseProfileStats({
        displayName: applicant.username,
        username: applicant.username,
        uploadsText:
          drawerStats.uploadsText ||
          `${drawerParsed.portfolioUploads} uploads in 0 different categories`,
        dealsText:
          drawerStats.finishedDealsText ||
          `${drawerParsed.finishedDeals} finished deals`,
        engagementText:
          drawerStats.engagementText || applicant.engagementText,
      });
      const decision = evaluateProfile(normalized);
      const profileForPolicy = {
        ...normalized,
        ...decision,
        previousCollaborator: Boolean(applicant.previousCollaborator),
        followersText: applicant.followersText,
      };
      const invitePolicy = evaluateInvitePolicy(profileForPolicy, {
        cache,
        creatorKey: applicant.creatorKey,
        campaign,
        useApprovalGate: true,
      });

      records.push(
        buildReviewRecord({
          campaign,
          applicant,
          normalized,
          decision,
          invitePolicy,
          niches: drawerParsed.niches || [],
          score: scoreProfile(profileForPolicy),
        }),
      );
    } finally {
      await closeApplicantProfile(page);
    }
  }

  return records;
}

function waitForCreatorsListPayload(page, timeout = 20000) {
  return page
    .waitForResponse(async (response) => {
      if (!response.url().includes('api.insense.pro/graphql')) {
        return false;
      }

      let requestData;
      try {
        requestData = response.request().postDataJSON?.() || {};
      } catch {
        return false;
      }

      return requestData.operationName === 'CreatorsListQuery';
    }, { timeout })
    .then(async (response) => {
      const request = response.request();
      const requestData = request.postDataJSON?.() || {};
      const payload = await response.json();
      return {
        query: requestData.query || '',
        variables: requestData.variables || {},
        data: payload?.data || null,
      };
    })
    .catch(() => null);
}

async function fetchGraphqlPage(page, requestPayload) {
  const response = await page.context().request.post(
    'https://api.insense.pro/graphql',
    {
      data: requestPayload,
      headers: {
        'content-type': 'application/json',
      },
    },
  );

  if (!response.ok()) {
    throw new Error(`GraphQL pagination request failed with ${response.status()}`);
  }

  return response.json();
}

async function collectGraphqlApplicantPool(page, initialCreatorsList, limit) {
  if (!initialCreatorsList?.data) {
    return [];
  }

  let applicants = extractApplicantsFromCreatorsListPayload(
    initialCreatorsList.data,
    limit,
  );
  let pageInfo = initialCreatorsList.data?.campaign?.projects?.pageInfo || null;
  let nextCursor = pageInfo?.endCursor || null;

  while (applicants.length < limit && pageInfo?.hasNextPage && nextCursor) {
    const requestPayload = buildPaginatedCreatorsListRequest({
      query: initialCreatorsList.query,
      variables: initialCreatorsList.variables,
      afterCursor: nextCursor,
    });
    const responsePayload = await fetchGraphqlPage(page, requestPayload);
    const data = responsePayload?.data || null;
    const nextApplicants = extractApplicantsFromCreatorsListPayload(
      data,
      limit,
    );
    applicants = nextApplicants.length
      ? Array.from(
          new Map(
            [...applicants, ...nextApplicants].map((applicant) => [
              applicant.creatorKey,
              applicant,
            ]),
          ).values(),
        ).slice(0, limit)
      : applicants;

    pageInfo = data?.campaign?.projects?.pageInfo || null;
    nextCursor = pageInfo?.endCursor || null;
  }

  return applicants.slice(0, limit);
}

function buildDecisionSeedRecords(records) {
  return records
    .filter((record) => record.passesQuality)
    .map((record) => ({
      creatorKey: record.creatorKey,
      campaign: record.campaign,
      displayName: record.displayName,
      firstName: record.firstName,
      username: record.username,
      country: record.country,
      rate: record.rate,
      rating: record.rating,
      followersText: record.followersText,
      engagementText: record.engagementText,
      socialHref: record.socialHref,
      previousCollaborator: Boolean(record.previousCollaborator),
      portfolioUploads: record.portfolioUploads,
      finishedDeals: record.finishedDeals,
      engagementRate: record.engagementRate,
      niches: Array.isArray(record.niches) ? record.niches : [],
      score: Number(record.score || 0),
      invite: record.invite === true || record.invite === 'pending' ? record.invite : false,
      blockReason: record.blockReason || '',
      notes: '',
    }));
}

async function reportRunToSlack({ campaign, mode, records }) {
  const result = await sendSlackSummary({
    campaign,
    mode,
    records,
    slackConfig: getSlackReportingConfig(),
  });

  if (result.delivered) {
    console.log(`Slack report sent to #airwallexdrafts for ${campaign} (${mode})`);
    return;
  }

  if (result.skipped) {
    console.log(`Slack report skipped for ${campaign} (${mode}): ${result.reason}`);
  }
}

async function runReviewMode(campaign, limit, options = {}) {
  const campaignSlug = slugifyCampaign(campaign);
  const dataRoot = path.join(__dirname, 'data');
  const shouldUseLiveSession = Boolean(process.env.INSENSE_PASSWORD);
  const reviewHistory = readReviewHistory(dataRoot);
  if (options.resetReviewHistory) {
    resetCampaignReviewBucket(reviewHistory, campaignSlug);
  }
  let cache;
  try {
    cache = readCreatorCache(dataRoot);
  } catch {
    cache = { creators: {} };
  }
  const slackConfig = getSlackReportingConfig();
  const useApprovalGate = Boolean(slackConfig.token && slackConfig.channelId);
  let records;

  if (shouldUseLiveSession) {
    const session = await createSession({ headless: true });

    try {
      await session.gotoCampaigns();
      const workspace = await inspectWorkspaceContext(session.page);

      if (workspace.kind === 'creator') {
        throw new Error(
          `Live review is blocked: ${workspace.reason} ` +
            'This workflow needs a brand-side Insense workspace with campaign applications access.',
        );
      }

      const creatorsListPayloadPromise = waitForCreatorsListPayload(session.page);
      await openCampaignApplications(session.page, campaign);
      const creatorsListPayload = await creatorsListPayloadPromise;
      const graphqlApplicants = await collectGraphqlApplicantPool(
        session.page,
        creatorsListPayload,
        Math.max(limit * 10, limit),
      );
      const applicantPool =
        graphqlApplicants.length > 0
          ? graphqlApplicants
          : await collectApplicantPool(
              session.page,
              Math.max(limit * 5, limit),
            );
      const applicants = filterUnreviewedByCampaign(
        applicantPool,
        campaignSlug,
        reviewHistory,
      ).slice(0, limit);

      records = [];

      for (const applicant of applicants) {
        if (applicant.source === 'graphql') {
          await openApplicantProfileByUsername(session.page, applicant.username);
        } else {
          await openApplicantProfile(session.page, applicant);
        }

        try {
          const drawerStats = await extractApplicantDrawerStats(session.page, applicant);
          const drawerParsed = parseProfileDrawerText(drawerStats.drawerText);
          const normalized = parseProfileStats({
            displayName: applicant.username,
            username: applicant.username,
            uploadsText:
              drawerStats.uploadsText ||
              `${drawerParsed.portfolioUploads} uploads in 0 different categories`,
            dealsText:
              drawerStats.finishedDealsText ||
              `${drawerParsed.finishedDeals} finished deals`,
            engagementText:
              drawerStats.engagementText || applicant.engagementText,
          });
          const decision = evaluateProfile(normalized);
          const profileForPolicy = {
            ...normalized,
            ...decision,
            previousCollaborator: Boolean(applicant.previousCollaborator),
            followersText: applicant.followersText,
          };
          const invitePolicy = evaluateInvitePolicy(profileForPolicy, {
            cache,
            creatorKey: applicant.creatorKey,
            campaign,
            useApprovalGate,
          });

          records.push(
            buildReviewRecord({
              campaign,
              applicant,
              normalized,
              decision,
              invitePolicy,
              niches: drawerParsed.niches || [],
              score: scoreProfile(profileForPolicy),
            }),
          );
        } finally {
          await closeApplicantProfile(session.page);
        }
      }
    } finally {
      await session.close();
    }
  } else {
    records = filterUnreviewedByCampaign(
      buildFixtureReviewRecords(campaign, cache, useApprovalGate),
      campaignSlug,
      reviewHistory,
    ).slice(0, limit);
  }

  const decisionRecords = buildDecisionSeedRecords(records);

  writeReviewArtifact(dataRoot, campaignSlug, records);
  markReviewedRecords(reviewHistory, campaignSlug, records);
  writeReviewHistory(dataRoot, reviewHistory);

  let slackThread = null;
  try {
    const threadResult = await postCandidateThread({
      campaign,
      records: decisionRecords,
      slackConfig,
    });
    if (threadResult.delivered) {
      slackThread = {
        channelId: threadResult.channelId,
        threadTs: threadResult.threadTs,
        replyTsByCreator: Object.fromEntries(
          threadResult.replies.map((reply) => [reply.creatorKey, reply.replyTs]),
        ),
      };
      console.log(
        `Candidate thread posted to Slack (${threadResult.replies.length} candidates) — react to approve/reject, then run --mode approve.`,
      );
    } else if (threadResult.skipped) {
      console.log(`Candidate thread skipped: ${threadResult.reason}`);
    }
  } catch (error) {
    console.warn(`Failed to post candidate thread: ${error.message}`);
  }

  writeDecisionSeed(
    dataRoot,
    campaignSlug,
    decisionRecords,
    slackThread ? { slack: slackThread } : {},
  );

  const summary = buildRunSummary(campaign, 'review', records);
  console.log(summary);
  await reportRunToSlack({ campaign, mode: 'review', records });
}

async function runApproveMode(campaign) {
  const campaignSlug = slugifyCampaign(campaign);
  const dataRoot = path.join(__dirname, 'data');
  const decisionFile = readDecisionSeed(dataRoot, campaignSlug);

  if (!decisionFile.slack || !decisionFile.slack.threadTs) {
    throw new Error(
      `No Slack approval thread on file for ${campaign}. Run --mode review with Slack reporting enabled first.`,
    );
  }

  const slackConfig = getSlackReportingConfig();
  const operatorUserId = process.env.INSENSE_SLACK_OPERATOR_USER_ID || '';

  const { records: updated, counts } = await collectApprovalsFromSlack({
    channelId: decisionFile.slack.channelId,
    threadTs: decisionFile.slack.threadTs,
    records: decisionFile.records,
    replyTsByCreator: decisionFile.slack.replyTsByCreator || {},
    slackConfig,
    operatorUserId,
  });

  writeDecisionSeed(dataRoot, campaignSlug, updated, { slack: decisionFile.slack });

  const summaryText = `Approvals collected for ${campaign} — ${counts.approved} to send, ${counts.rejected} rejected, ${counts.pending} still pending`;
  console.log(summaryText);

  try {
    await sendSlackText({
      text: summaryText,
      slackConfig: { ...slackConfig, channelId: decisionFile.slack.channelId },
      threadTs: decisionFile.slack.threadTs,
    });
  } catch (error) {
    console.warn(`Failed to post approval summary to thread: ${error.message}`);
  }
}

async function executeSendMode({
  campaign,
  session = null,
  shouldUseLiveSession = Boolean(process.env.INSENSE_PASSWORD),
  pageAlreadyOnApplications = false,
}) {
  const campaignSlug = slugifyCampaign(campaign);
  const dataRoot = path.join(__dirname, 'data');
  const decisionFile = readDecisionSeed(dataRoot, campaignSlug);
  const cache = readCreatorCache(dataRoot);
  const results = [];
  let ownedSession = session;

  if (shouldUseLiveSession && !ownedSession) {
    ownedSession = await createSession({ headless: true });
    await ownedSession.gotoCampaigns();
    if (!pageAlreadyOnApplications) {
      await openCampaignApplications(ownedSession.page, campaign);
    }
  }

  try {
    for (const record of decisionFile.records) {
      validateDecisionRecord(record);

      const result = await sendInviteIfEligible({
        page: ownedSession?.page || null,
        record,
        cache,
        sendMessage: shouldUseLiveSession,
        async openChat(page, currentRecord) {
          if (!page) {
            throw new Error('Live send requires an authenticated Insense session');
          }

          await openApplicantProfileByUsername(page, currentRecord.username);
          await openApplicantChatComposer(page);
        },
      });

      results.push(result);
      if (!cache.creators) {
        cache.creators = {};
      }

      cache.creators[record.creatorKey] = {
        status: result.status,
        updatedAt: new Date().toISOString(),
        campaign: record.campaign || '',
      };

      if (ownedSession?.page) {
        await closeTopDrawer(ownedSession.page);
      }
    }
  } finally {
    if (ownedSession && ownedSession !== session) {
      await ownedSession.close();
    }
  }

  writeCreatorCache(dataRoot, cache);
  writeSendArtifact(dataRoot, campaignSlug, results);
  console.log(buildRunSummary(campaign, 'send', results));
  await reportRunToSlack({ campaign, mode: 'send', records: results });
}

async function runSendMode(campaign) {
  await executeSendMode({ campaign });
}

async function runDailySummaryMode() {
  const dataRoot = path.join(__dirname, 'data');
  const localDate = new Date();
  const dateKey = formatLocalDate(localDate);
  const runArtifacts = loadDailyRunArtifacts(dataRoot, localDate);
  const summary = buildDailySummary(dateKey, runArtifacts);

  writeDailySummaryArtifact(dataRoot, dateKey, summary);

  const text = buildDailySlackSummary(summary);
  console.log(text);

  const result = await sendSlackText({
    text,
    slackConfig: getSlackReportingConfig(),
  });

  if (result.delivered) {
    console.log(`Slack report sent to #airwallexdrafts for daily summary (${dateKey})`);
    return;
  }

  if (result.skipped) {
    console.log(`Slack report skipped for daily summary (${dateKey}): ${result.reason}`);
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.mode === 'review') {
  await runReviewMode(args.campaign, args.limit, {
    resetReviewHistory: args.resetReviewHistory,
  });
} else if (args.mode === 'daily-summary') {
  await runDailySummaryMode();
} else if (args.mode === 'approve') {
  await runApproveMode(args.campaign);
} else {
  await runSendMode(args.campaign);
}
