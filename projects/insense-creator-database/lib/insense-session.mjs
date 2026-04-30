import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  getInsenseCredentials,
  INSENSE_CAMPAIGNS_URL,
  INSENSE_SIGNIN_URL,
  STORAGE_STATE_PATH,
} from '../config.mjs';

async function dismissOverlays(page) {
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
      }
    } catch {
      // Overlay buttons are optional and vary between sessions.
    }
  }
}

async function isSignedOut(page) {
  if (page.url().includes('/signin')) {
    return true;
  }

  try {
    return await page.getByPlaceholder('Email').isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

async function login(page) {
  const credentials = getInsenseCredentials();

  await page.goto(INSENSE_SIGNIN_URL, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  await page.getByPlaceholder('Email').fill(credentials.email);
  await page.getByPlaceholder('Password').fill(credentials.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(dashboard|home|campaigns)/, { timeout: 15000 });
  await page.waitForLoadState('domcontentloaded');
  await dismissOverlays(page);
}

export async function createSession({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const contextOptions = {};

  if (fs.existsSync(STORAGE_STATE_PATH)) {
    contextOptions.storageState = STORAGE_STATE_PATH;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  async function ensureLoggedIn() {
    await page.goto(INSENSE_CAMPAIGNS_URL, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);

    if (await isSignedOut(page)) {
      await login(page);
      await page.goto(INSENSE_CAMPAIGNS_URL, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('domcontentloaded');
    await dismissOverlays(page);
    await context.storageState({ path: STORAGE_STATE_PATH });
  }

  return {
    page,
    context,
    browser,
    async gotoCampaigns() {
      await ensureLoggedIn();
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
