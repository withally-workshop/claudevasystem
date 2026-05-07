const TYPEFORM_URL = 'https://form.typeform.com/to/lAPIxgqv';

export function renderInviteMessage(record) {
  const greetingName = String(record.firstName || record.username || 'there')
    .replace(/^@/, '')
    .trim();

  return `Hey ${greetingName},

Thanks for applying to our project on Insense. We loved your work and wanted to reach out personally. You weren't quite the right fit for that specific brief, but we absolutely want to keep working with you!

We're Krave Media and we work with some of the fastest-growing DTC brands in the US.
We'd love for you to join our own creator network so our strategists can match you directly to briefs. If you join, you get:

- First look at paid briefs matched to your niche
- Set your own UGC rates - keep 100% of what you earn
- Work directly with the brand team
- Early access to our private creator Discord - jobs board, work-sharing, and direct line to our brand partners
- Long-term relationships - most of our creators work 6+ campaigns a year with us

It just takes 5 min to fill out:
${TYPEFORM_URL}

Once you're in, our strategist team will reach out directly with briefs that match you!
Excited to have you on the team! :)

Cheers,
Krave Media Creator Team`;
}

export function validateDecisionRecord(record) {
  if (typeof record.creatorKey !== 'string' || !record.creatorKey.trim()) {
    throw new Error('Decision record must include creatorKey');
  }

  if (record.invite !== true && record.invite !== false && record.invite !== 'pending') {
    throw new Error('Decision record invite must be true, false, or "pending"');
  }

  return record;
}

export async function scanChatForPriorInvite(page) {
  const bodyText = await page.locator('body').innerText();
  return bodyText.includes(TYPEFORM_URL);
}

export async function fillComposerMessage(page, message) {
  const textarea = page.locator('textarea[data-test="msgField:textarea:text"]');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await textarea.fill(message);
}

export async function sendComposerMessage(page) {
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea[data-test="msgField:textarea:text"]');
    if (!textarea) {
      throw new Error('Could not find Insense message textarea');
    }

    const composer = textarea.parentElement?.parentElement?.parentElement;
    const sendButton = composer?.lastElementChild?.lastElementChild;

    if (!sendButton) {
      throw new Error('Could not find Insense send button');
    }

    sendButton.click();
  });
}

export async function sendInviteIfEligible({
  page,
  record,
  openChat,
  cache,
  sendMessage = false,
}) {
  validateDecisionRecord(record);

  if (record.invite !== true) {
    const status = record.invite === 'pending' ? 'pending_approval' : 'skipped';
    return { ...record, status, messageSent: false, dedupMatched: false };
  }

  if (cache.creators?.[record.creatorKey]?.status === 'messaged') {
    return {
      ...record,
      status: 'already_messaged',
      messageSent: false,
      dedupMatched: true,
    };
  }

  await openChat(page, record);

  const dedupMatched = await scanChatForPriorInvite(page);
  if (dedupMatched) {
    return {
      ...record,
      status: 'already_messaged',
      messageSent: false,
      dedupMatched: true,
    };
  }

  const messagePreview = renderInviteMessage(record);

  if (sendMessage) {
    await fillComposerMessage(page, messagePreview);
    await sendComposerMessage(page);

    return {
      ...record,
      status: 'messaged',
      messageSent: true,
      dedupMatched: false,
      messagePreview,
    };
  }

  return {
    ...record,
    status: 'ready_to_send',
    messageSent: false,
    dedupMatched: false,
    messagePreview,
  };
}
