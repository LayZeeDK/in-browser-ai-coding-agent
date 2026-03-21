import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

/**
 * Playwright's exact --disable-features default arg. Must match exactly
 * for ignoreDefaultArgs to remove it (exact string comparison).
 */
const PLAYWRIGHT_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

/** Playwright defaults to remove for LanguageModel API support. */
const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES,
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-component-update',
];

/** Same list without OptimizationHints — required for on-device AI. */
const DISABLE_FEATURES_WITHOUT_OPT_HINTS =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

interface BrowserProfile {
  profileDir: string;
  channel: string;
  onDeviceInternalsUrl: string;
  args: string[];
}

const browserProfiles: Record<string, BrowserProfile> = {
  'chrome-gemini-nano': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
    channel: 'chrome-beta',
    onDeviceInternalsUrl: 'chrome://on-device-internals',
    args: [
      '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
  'edge-phi4-mini': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
    channel: 'msedge-dev',
    onDeviceInternalsUrl: 'edge://on-device-internals',
    args: [
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
};

/**
 * Global setup: warm up the on-device AI model and wait until the
 * inference engine reports "Ready" state. Monitors the browser's
 * on-device-internals page to verify the model is fully loaded before
 * any tests run.
 *
 * Steps per browser project:
 * 1. Trigger LanguageModel.create() to start model loading
 * 2. Navigate to on-device-internals
 * 3. Wait for "Device performance class" to resolve (not "Loading...")
 * 4. Click "Model Status" tab
 * 5. Wait for "Foundational model state: Ready"
 */
export default async function globalSetup(config: FullConfig) {
  for (const project of config.projects) {
    const profile = browserProfiles[project.name];

    if (!profile) {
      continue;
    }

    if (!existsSync(profile.profileDir)) {
      continue;
    }

    try {
      await warmUpModel(project.name, profile);
    } catch (error) {
      console.warn(
        `[global-setup] Model warm-up skipped for ${project.name}: ${error}`,
      );
    }
  }
}

async function warmUpModel(projectName: string, profile: BrowserProfile) {
  const context = await chromium.launchPersistentContext(profile.profileDir, {
    channel: profile.channel,
    headless: false,
    args: profile.args,
    ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(1_200_000);

  // Navigate to on-device-internals — Chrome may gate this behind a
  // debug page enable flow. Use page.evaluate to enable programmatically
  // (clicking the enable button opens a new tab in the default profile,
  // not the Playwright context, leaving a stale Chrome window open).
  await page.goto(profile.onDeviceInternalsUrl);

  const disabledText = page.getByText(
    /debugging pages are currently disabled/i,
  );

  if (await disabledText.isVisible({ timeout: 3_000 }).catch(() => false)) {
    console.log(
      `[global-setup] ${projectName}: enabling internal debugging pages...`,
    );

    // Click enable and reload in the same page instead of waiting for
    // a new tab (which opens in the default profile on Windows)
    await page
      .getByRole('button', { name: /enable/i })
      .or(page.locator('button:has-text("Enable")'))
      .click();

    // Wait briefly for the enable to take effect, then reload
    await page.waitForTimeout(1_000);
    await page.goto(profile.onDeviceInternalsUrl);
  }

  // Trigger model loading via the LanguageModel API
  await page.evaluate(async () => {
    if (typeof LanguageModel !== 'undefined') {
      const session = await LanguageModel.create();
      session.destroy();
    }
  });

  console.log(
    `[global-setup] ${projectName}: waiting for device performance class...`,
  );

  // Wait for "Device performance class" to resolve from "Loading..."
  // Timeout gracefully — the page may render differently in containers
  try {
    await page
      .getByText(/Device performance class:/)
      .waitFor({ timeout: 30_000 });
    await page
      .locator(
        ':text-matches("Device performance class:"):not(:has-text("Loading"))',
      )
      .waitFor({ timeout: 120_000 });

    const perfClass = await page
      .getByText(/Device performance class:/)
      .textContent();
    console.log(`[global-setup] ${projectName}: ${perfClass?.trim()}`);
  } catch {
    console.log(
      `[global-setup] ${projectName}: device performance class not found, continuing...`,
    );
  }

  // Click "Model Status" tab
  const modelStatusTab = page
    .getByRole('tab', { name: /Model Status/i })
    .or(page.locator('text=Model Status'));
  await modelStatusTab.click();

  console.log(
    `[global-setup] ${projectName}: waiting for foundational model state: Ready...`,
  );

  // Wait for "Foundational model state: Ready", refreshing if the model
  // reports "Not Ready For Unknown Reason" (transient Edge state)
  const deadline = Date.now() + 600_000;

  while (Date.now() < deadline) {
    const readyEl = page.getByText(/Foundational model state:\s*Ready/i);

    if (await readyEl.isVisible({ timeout: 30_000 }).catch(() => false)) {
      break;
    }

    const notReady = page.getByText(/Not Ready For Unknown Reason/i);

    if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
      console.log(
        `[global-setup] ${projectName}: model not ready, refreshing...`,
      );
      await page.reload();
      await modelStatusTab.click();
    }
  }

  console.log(`[global-setup] ${projectName}: model is ready`);

  await context.close();

  // Wait for Chrome's lockfile to be released — chrome_crashpad_handler
  // outlives the main process and holds the FILE_FLAG_DELETE_ON_CLOSE handle
  const lockfile = join(profile.profileDir, 'lockfile');
  const lockDeadline = Date.now() + 10_000;

  while (existsSync(lockfile) && Date.now() < lockDeadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
}
