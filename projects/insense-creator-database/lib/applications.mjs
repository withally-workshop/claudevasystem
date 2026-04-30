function normalizeText(value) {
  return String(value || '').trim();
}

function parseLineNumber(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? match[1] : '';
}

export async function dismissPageOverlays(page) {
  const dismissLabels = [
    /allow all/i,
    /accept/i,
    /got it/i,
    /close/i,
    /dismiss/i,
  ];

  for (const label of dismissLabels) {
    const button = page.getByRole('button', { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // Overlay buttons are optional and vary between sessions.
    }
  }

  const knownCookieButtons = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
  ];

  for (const selector of knownCookieButtons) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 500 })) {
        await button.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // Cookie banner ids vary between sessions.
    }
  }
}

export function detectWorkspaceContext({ pageText = '', links = [] }) {
  const normalizedText = normalizeText(pageText).toLowerCase();
  const normalizedLinks = links.map((link) => ({
    text: normalizeText(link.text),
    href: normalizeText(link.href),
  }));

  const hasCreatorMarketplace = normalizedLinks.some((link) =>
    /creator marketplace/i.test(link.text),
  );
  const hasCreatorOnboardingCopy =
    normalizedText.includes('start applying for campaigns');
  const hasBrandCampaignSignals =
    normalizedText.includes('active campaigns') ||
    normalizedText.includes('new campaign') ||
    normalizedText.includes('received applications');
  const campaignsTargetsDashboard = normalizedLinks.some(
    (link) => /campaigns/i.test(link.text) && link.href === '/dashboard',
  );

  if (hasBrandCampaignSignals || campaignsTargetsDashboard) {
    return {
      kind: 'brand',
      reason: 'Detected brand campaign-management workspace.',
    };
  }

  if (hasCreatorMarketplace || hasCreatorOnboardingCopy) {
    return {
      kind: 'creator',
      reason:
        'Detected creator workspace navigation instead of the brand campaign-management workspace.',
    };
  }

  return {
    kind: 'unknown',
    reason: 'Workspace navigation did not match a known creator or brand pattern.',
  };
}

export async function inspectWorkspaceContext(page) {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a').length >= 5,
      null,
      { timeout: 5000 },
    );
  } catch {
    // Fall through and inspect whatever the page has rendered so far.
  }

  const links = await page.locator('a').evaluateAll((els) =>
    els
      .map((el) => ({
        text: (el.textContent || '').trim(),
        href: el.getAttribute('href') || '',
      }))
      .filter((link) => link.text || link.href),
  );

  const pageText = await page.locator('body').innerText().catch(() => '');
  return detectWorkspaceContext({ pageText, links });
}

const DASHBOARD_URL = 'https://app.insense.pro/dashboard';

export function resolveCampaignApplicationsHref(href) {
  const normalized = normalizeText(href);
  if (!normalized) {
    throw new Error('Campaign applications link is missing an href');
  }

  return new URL(normalized, DASHBOARD_URL).toString();
}

export function detectApplicantProfileReady({
  username = '',
  bodyText = '',
  hasDrawerCloseButton = false,
  hasSendMessageButton = false,
}) {
  const normalizedUsername = normalizeText(username).toLowerCase();
  const normalizedText = normalizeText(bodyText).toLowerCase();
  const hasUsername = normalizedUsername
    ? normalizedText.includes(normalizedUsername)
    : false;
  const hasProfileSignals =
    /finished deals/i.test(bodyText) ||
    /engagement rate/i.test(bodyText) ||
    /uploads?\s+in\s+\d+\s+different categories/i.test(bodyText);

  return hasUsername && (hasDrawerCloseButton || hasSendMessageButton || hasProfileSignals);
}

export function mergeUniqueApplicants(existing, incoming, limit = Number.POSITIVE_INFINITY) {
  const merged = [...existing];
  const seen = new Set(
    existing.map((applicant) => applicant.creatorKey || applicant.username || applicant.rawText),
  );

  for (const applicant of incoming) {
    const key = applicant.creatorKey || applicant.username || applicant.rawText;
    if (seen.has(key)) {
      continue;
    }

    merged.push(applicant);
    seen.add(key);

    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

export function chooseApplicantListAdvanceAction(controls) {
  const normalizedControls = controls
    .map((control) => ({
      ...control,
      text: normalizeText(control.text),
      ariaLabel: normalizeText(control.ariaLabel),
      href: normalizeText(control.href),
      tagName: normalizeText(control.tagName).toLowerCase(),
    }))
    .filter((control) => !control.disabled);

  const loadMore = normalizedControls.find((control) =>
    /load more|show more|view more|more applicants/i.test(
      `${control.text} ${control.ariaLabel}`,
    ),
  );
  if (loadMore) {
    return loadMore;
  }

  const nextPage = normalizedControls.find((control) =>
    /\bnext\b|next page|older/i.test(`${control.text} ${control.ariaLabel}`),
  );
  if (nextPage) {
    return nextPage;
  }

  return null;
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '';
  }

  return `$${amount.toLocaleString('en-US')}`;
}

function formatFollowersText(value) {
  const followers = Number(value);
  if (!Number.isFinite(followers)) {
    return '';
  }

  return `${followers.toLocaleString('en-US')} followers`;
}

function formatEngagementText(value) {
  const engagementRate = Number(value);
  if (!Number.isFinite(engagementRate)) {
    return '';
  }

  return `${(engagementRate * 100).toFixed(2)}% ER`;
}

function formatRatingText(averageScore, totalCount) {
  const score = Number(averageScore);
  const votes = Number(totalCount);
  if (!Number.isFinite(score)) {
    return '';
  }

  const votesText = Number.isFinite(votes) && votes > 0 ? String(votes) : '-';
  return `${score.toFixed(2)} (${votesText})`;
}

function buildSocialHref(creatorType, username) {
  const normalizedUsername = normalizeText(username).replace(/^@/, '');
  if (!normalizedUsername) {
    return '';
  }

  if (creatorType === 'INSTAGRAM') {
    return `https://instagram.com/${normalizedUsername}/`;
  }

  if (creatorType === 'TIKTOK') {
    return `https://www.tiktok.com/@${normalizedUsername}`;
  }

  return '';
}

export function extractApplicantsFromCreatorsListPayload(payload, limit = Number.POSITIVE_INFINITY) {
  const edges = payload?.campaign?.projects?.edges;
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges
    .map((edge) => {
      const project = edge?.node;
      const creator = project?.creator;
      const username = normalizeText(creator?.username);
      if (!project || !creator || !username) {
        return null;
      }

      const fullName = normalizeText(creator?.user?.fullName);
      return {
        creatorKey:
          buildSocialHref(creator?.type, username) ||
          `insense-creator:${creator?.id || username}`,
        cardIndex: -1,
        buttonIndex: -1,
        username,
        displayName: fullName || username,
        firstName: fullName ? fullName.split(/\s+/)[0] : username,
        socialHref: buildSocialHref(creator?.type, username),
        country: normalizeText(creator?.profile?.countries?.[0]?.name),
        rate: formatCurrency(project?.price),
        rating: formatRatingText(
          creator?.ownership?.owner?.rating?.averageScore,
          creator?.ratingVotes?.totalCount,
        ),
        followersText: formatFollowersText(creator?.user?.followedByCount),
        engagementText: formatEngagementText(creator?.user?.engagementRate),
        previousCollaborator: Boolean(creator?.previousCollaborator),
        rawText: '',
        projectId: normalizeText(project?.id),
        source: 'graphql',
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

export function buildPaginatedCreatorsListRequest({
  query,
  variables,
  afterCursor,
}) {
  const sourceQuery = String(query || '');
  if (!sourceQuery.includes('query CreatorsListQuery(')) {
    throw new Error('Captured query does not look like CreatorsListQuery');
  }

  const queryWithAfterVariable = sourceQuery.replace(
    'query CreatorsListQuery(',
    'query CreatorsListQuery($after: String, ',
  );
  const paginatedQuery = queryWithAfterVariable.replace(
    'projects(first: 10,',
    'projects(first: 10, after: $after,',
  );

  return {
    operationName: 'CreatorsListQuery',
    query: paginatedQuery,
    variables: {
      ...(variables || {}),
      after: afterCursor,
    },
  };
}

export async function openCampaignApplications(page, campaignName) {
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
  await dismissPageOverlays(page);
  await page.locator('a[href*="/received-applicants"]').first().waitFor({
    state: 'visible',
    timeout: 20000,
  });
  await page.waitForTimeout(2000);

  const campaignLink = page
    .locator('a[href*="/received-applicants"]')
    .filter({ hasText: campaignName })
    .first();

  await campaignLink.waitFor({ state: 'visible', timeout: 15000 });
  const campaignHref = resolveCampaignApplicationsHref(
    await campaignLink.getAttribute('href'),
  );
  await page.goto(campaignHref, { waitUntil: 'domcontentloaded' });
  await dismissPageOverlays(page);
  await page.waitForURL(/\/campaigns\/.+\/received-applicants/, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => document.body.innerText.includes('Total applicants'),
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(2000);
}

export async function collectVisibleApplicantSummaries(page, limit = 10) {
  const summaries = await page.evaluate((countLimit) => {
    function findApplicantCard(button) {
      let node = button;
      while (node && node !== document.body) {
        const text = (node.innerText || '').trim();
        if (
          text.includes('View application') &&
          text.includes('View profile') &&
          text.includes('Portfolio')
        ) {
          return node;
        }
        node = node.parentElement;
      }

      return null;
    }

    return Array.from(document.querySelectorAll('button'))
      .filter((button) => (button.textContent || '').trim() === 'View profile')
      .map((button, buttonIndex) => {
        const card = findApplicantCard(button);
        if (!card) {
          return null;
        }

        const text = (card.innerText || '').trim();
        const lines = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const profileLink = card.querySelector('a[target="_blank"]');

        return {
          buttonIndex,
          username:
            (profileLink?.textContent || '').trim() ||
            lines[0] ||
            `applicant-${buttonIndex + 1}`,
          socialHref: profileLink?.getAttribute('href') || '',
          country: lines[1] || '',
          rate: lines.find((line) => /^\$\d/.test(line)) || '',
          rating: lines.find((line) => /^\d+(?:\.\d+)? \(\d+\)$/.test(line)) || '',
          followersText:
            lines.find((line) => /followers/i.test(line)) || '',
          engagementText: lines.find((line) => /\bER\b/i.test(line)) || '',
          previousCollaborator: text.includes('Previous Collaborator'),
          rawText: text,
        };
      })
      .filter(Boolean)
      .slice(0, countLimit);
  }, limit);

  return summaries.map((summary, index) => ({
    ...summary,
    creatorKey: summary.socialHref || `insense:${summary.username}`,
    cardIndex: index,
  }));
}

export async function collectApplicantPool(page, limit = 10, maxRounds = 6) {
  let collected = [];
  let stagnantRounds = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const visible = await collectVisibleApplicantSummaries(page, Math.max(limit, 20));
    const merged = mergeUniqueApplicants(collected, visible, limit);

    if (merged.length === collected.length) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }

    collected = merged;

    if (collected.length >= limit) {
      break;
    }

    const advanced = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('button, a')).map((element) => ({
        text: (element.textContent || '').trim(),
        ariaLabel: element.getAttribute('aria-label') || '',
        href: element.getAttribute('href') || '',
        disabled:
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true',
        tagName: element.tagName || '',
      }));

      const pickAction = (items) => {
        const normalizedItems = items
          .map((item) => ({
            ...item,
            text: String(item.text || '').trim(),
            ariaLabel: String(item.ariaLabel || '').trim(),
          }))
          .filter((item) => !item.disabled);

        const loadMore = normalizedItems.find((item) =>
          /load more|show more|view more|more applicants/i.test(
            `${item.text} ${item.ariaLabel}`,
          ),
        );
        if (loadMore) {
          return loadMore;
        }

        const nextPage = normalizedItems.find((item) =>
          /\bnext\b|next page|older/i.test(`${item.text} ${item.ariaLabel}`),
        );
        if (nextPage) {
          return nextPage;
        }

        return null;
      };

      const action = pickAction(controls);
      if (!action) {
        const buttons = Array.from(document.querySelectorAll('button')).filter(
          (button) => (button.textContent || '').trim() === 'View profile',
        );

        const lastButton = buttons.at(-1);
        if (lastButton) {
          lastButton.scrollIntoView({ behavior: 'instant', block: 'end' });
          return 'scroll';
        }

        window.scrollBy(0, window.innerHeight * 1.5);
        return 'scroll';
      }

      const candidates = Array.from(document.querySelectorAll('button, a'));
      const element = candidates.find((candidate) => {
        const text = (candidate.textContent || '').trim();
        const ariaLabel = candidate.getAttribute('aria-label') || '';
        const href = candidate.getAttribute('href') || '';
        return (
          text === action.text &&
          ariaLabel === action.ariaLabel &&
          href === action.href
        );
      });

      if (!element) {
        return 'scroll';
      }

      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      element.click();
      return action.href ? 'navigate' : 'click';
    });

    if (stagnantRounds >= 2 && advanced === 'scroll') {
      break;
    }

    if (advanced === 'navigate' || advanced === 'click') {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    await page.waitForTimeout(2000);
  }

  return collected.slice(0, limit);
}

export async function searchApplicants(page, query) {
  await dismissPageOverlays(page);
  const searchInput = page.getByPlaceholder('Search by username, bio info or hashtags');
  await searchInput.waitFor({ state: 'visible', timeout: 15000 });
  await searchInput.fill(query);
  await page.waitForTimeout(2500);
}

export async function openApplicantProfile(page, applicant) {
  await dismissPageOverlays(page);
  const button = page
    .locator('button')
    .filter({ hasText: 'View profile' })
    .nth(applicant.buttonIndex);
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();

  await page.waitForFunction(
    (username) => {
      const text = document.body.innerText || '';
      const closeButton = document.querySelector(
        '[data-testid="drawer:project-application:closeButton"]',
      );
      const hasSendMessageButton = Array.from(document.querySelectorAll('button')).some(
        (element) => (element.textContent || '').trim() === 'Send a message',
      );
      const normalizedUsername = String(username || '').trim().toLowerCase();
      const normalizedText = String(text || '').trim().toLowerCase();
      const hasUsername = normalizedUsername
        ? normalizedText.includes(normalizedUsername)
        : false;
      const hasProfileSignals =
        /finished deals/i.test(text) ||
        /engagement rate/i.test(text) ||
        /uploads?\s+in\s+\d+\s+different categories/i.test(text);

      return hasUsername && (Boolean(closeButton) || hasSendMessageButton || hasProfileSignals);
    },
    applicant.username,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
}

export async function openApplicantProfileByUsername(page, username) {
  await searchApplicants(page, username);
  await dismissPageOverlays(page);
  const button = page
    .locator('button')
    .filter({ hasText: 'View profile' })
    .first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();

  await page.waitForFunction(
    (value) => {
      const text = document.body.innerText || '';
      const closeButton = document.querySelector(
        '[data-testid="drawer:project-application:closeButton"]',
      );
      const hasSendMessageButton = Array.from(document.querySelectorAll('button')).some(
        (element) => (element.textContent || '').trim() === 'Send a message',
      );
      const normalizedValue = String(value || '').trim().toLowerCase();
      const normalizedText = String(text || '').trim().toLowerCase();
      const hasUsername = normalizedValue
        ? normalizedText.includes(normalizedValue)
        : false;
      const hasProfileSignals =
        /finished deals/i.test(text) ||
        /engagement rate/i.test(text) ||
        /uploads?\s+in\s+\d+\s+different categories/i.test(text);

      return hasUsername && (Boolean(closeButton) || hasSendMessageButton || hasProfileSignals);
    },
    username,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
}

export async function extractApplicantDrawerStats(page, applicant) {
  const bodyText = await page.locator('body').innerText();
  const startIndex = bodyText.lastIndexOf(applicant.username);
  const drawerText = startIndex >= 0 ? bodyText.slice(startIndex) : bodyText;

  return {
    drawerText,
    finishedDealsText:
      parseLineNumber(drawerText, /(\d+\s+finished deals)/i) || '',
    uploadsText:
      parseLineNumber(drawerText, /(\d+\s+uploads?\s+in\s+\d+\s+different categories)/i) ||
      '',
    engagementText:
      parseLineNumber(drawerText, /(\d+(?:\.\d+)?%\s+Engagement rate)/i) || '',
  };
}

export async function closeApplicantProfile(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

export async function openApplicantChatComposer(page) {
  await dismissPageOverlays(page);
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => (element.textContent || '').trim() === 'Send a message',
    );

    if (!button) {
      throw new Error('Could not find Send a message button');
    }

    button.click();
  });

  const textarea = page.locator('textarea[data-test="msgField:textarea:text"]');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
}

export async function closeTopDrawer(page) {
  const closeButton = page.locator('[data-testid="drawer:project-application:closeButton"]').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await page.waitForTimeout(1000);
    return;
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

export async function gotoCampaignByName(page, campaignName) {
  const campaignLink = page.getByRole('link', { name: new RegExp(campaignName, 'i') }).first();
  await campaignLink.waitFor({ state: 'visible', timeout: 15000 });
  await campaignLink.click();
}

export async function openApplicationsTab(page) {
  const applicationsTab = page.getByRole('tab', { name: /applications/i }).first();
  await applicationsTab.waitFor({ state: 'visible', timeout: 15000 });
  await applicationsTab.click();
}
