import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaginatedCreatorsListRequest,
  chooseApplicantListAdvanceAction,
  extractApplicantsFromCreatorsListPayload,
  mergeUniqueApplicants,
  detectApplicantProfileReady,
  detectWorkspaceContext,
  resolveCampaignApplicationsHref,
} from '../lib/applications.mjs';

test('detects creator workspace from creator-side navigation', () => {
  const context = detectWorkspaceContext({
    pageText: 'Complete onboarding to start applying for campaigns.',
    links: [
      { text: 'Campaigns', href: '/campaigns' },
      { text: 'Creator Marketplace', href: '/marketplace' },
      { text: 'Creator Lists', href: '/creators' },
    ],
  });

  assert.equal(context.kind, 'creator');
  assert.match(context.reason, /creator workspace/i);
});

test('detects brand workspace from campaign-management text', () => {
  const context = detectWorkspaceContext({
    pageText: 'Active campaigns New campaign Applications Received applications',
    links: [
      { text: 'Campaigns', href: '/dashboard' },
      { text: 'Creator Marketplace', href: '/marketplace' },
    ],
  });

  assert.equal(context.kind, 'brand');
});

test('returns unknown when the navigation does not match a known workspace', () => {
  const context = detectWorkspaceContext({
    pageText: 'Welcome back',
    links: [{ text: 'Home', href: '/home' }],
  });

  assert.equal(context.kind, 'unknown');
});

test('resolves a campaign applications href to an absolute insense url', () => {
  assert.equal(
    resolveCampaignApplicationsHref('/campaigns/abc/received-applicants'),
    'https://app.insense.pro/campaigns/abc/received-applicants',
  );
  assert.equal(
    resolveCampaignApplicationsHref('https://app.insense.pro/campaigns/abc/received-applicants'),
    'https://app.insense.pro/campaigns/abc/received-applicants',
  );
});

test('detects when an applicant profile drawer is ready', () => {
  assert.equal(
    detectApplicantProfileReady({
      username: 'creator.one',
      bodyText: 'creator.one\n12 finished deals\n4.2% Engagement rate',
      hasDrawerCloseButton: true,
      hasSendMessageButton: false,
    }),
    true,
  );

  assert.equal(
    detectApplicantProfileReady({
      username: 'creator.one',
      bodyText: 'creator.one\nPortfolio only',
      hasDrawerCloseButton: false,
      hasSendMessageButton: false,
    }),
    false,
  );
});

test('merges unique applicants and preserves order', () => {
  const merged = mergeUniqueApplicants(
    [
      { creatorKey: 'one', username: 'one' },
      { creatorKey: 'two', username: 'two' },
    ],
    [
      { creatorKey: 'two', username: 'two' },
      { creatorKey: 'three', username: 'three' },
    ],
    5,
  );

  assert.deepEqual(
    merged.map((item) => item.creatorKey),
    ['one', 'two', 'three'],
  );
});

test('chooses a next applicants action from pagination controls', () => {
  const action = chooseApplicantListAdvanceAction([
    { text: 'Previous', ariaLabel: '', href: '', disabled: false, tagName: 'button' },
    { text: 'Next', ariaLabel: 'Next page', href: '', disabled: false, tagName: 'button' },
  ]);

  assert.equal(action?.text, 'Next');
});

test('prefers load more style actions over unrelated controls', () => {
  const action = chooseApplicantListAdvanceAction([
    { text: 'Export CSV', ariaLabel: '', href: '', disabled: false, tagName: 'button' },
    { text: 'Load more', ariaLabel: '', href: '', disabled: false, tagName: 'button' },
  ]);

  assert.equal(action?.text, 'Load more');
});

test('extracts applicant summaries from creators list graphql payload', () => {
  const applicants = extractApplicantsFromCreatorsListPayload({
    campaign: {
      projects: {
        edges: [
          {
            node: {
              id: 'project-1',
              price: 1500,
              creator: {
                id: 'creator-1',
                username: 'chris.pluhacek',
                type: 'INSTAGRAM',
                previousCollaborator: true,
                ratingVotes: { totalCount: 42 },
                ownership: {
                  owner: {
                    rating: {
                      averageScore: 4.9344,
                    },
                  },
                },
                profile: {
                  countries: [{ name: 'United States' }],
                },
                user: {
                  fullName: 'Chris Pluhacek',
                  followedByCount: 33979,
                  engagementRate: 0.006734,
                },
              },
            },
          },
        ],
      },
    },
  });

  assert.equal(applicants.length, 1);
  assert.equal(applicants[0].username, 'chris.pluhacek');
  assert.equal(applicants[0].country, 'United States');
  assert.equal(applicants[0].rate, '$1,500');
  assert.equal(applicants[0].followersText, '33,979 followers');
  assert.equal(applicants[0].engagementText, '0.67% ER');
  assert.equal(applicants[0].previousCollaborator, true);
  assert.equal(
    applicants[0].socialHref,
    'https://instagram.com/chris.pluhacek/',
  );
});

test('builds a paginated creators list graphql request from the captured query', () => {
  const request = buildPaginatedCreatorsListRequest({
    query: 'query CreatorsListQuery($campaignId: ID!) { campaign(id: $campaignId) { projects(first: 10, orderBy: RATING) { edges { cursor } pageInfo { hasNextPage endCursor } } } }',
    variables: { campaignId: 'abc' },
    afterCursor: 'MTA',
  });

  assert.match(request.query, /\$after: String/);
  assert.match(request.query, /projects\(first: 10, after: \$after,/);
  assert.equal(request.variables.after, 'MTA');
});
