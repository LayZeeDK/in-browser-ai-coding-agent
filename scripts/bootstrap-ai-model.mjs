/**
 * Bootstrap script for downloading on-device AI models via the LanguageModel API.
 *
 * Launches a branded browser with a persistent user data directory, seeds
 * the required chrome://flags in the Local State file, removes Playwright
 * defaults that block the LanguageModel API, and triggers model download
 * if needed.
 *
 * Usage:
 *   node scripts/bootstrap-ai-model.mjs --browser chrome-beta --profile .playwright-profiles/chrome-beta
 *   node scripts/bootstrap-ai-model.mjs --browser msedge-dev --profile .playwright-profiles/msedge-dev
 */
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'chrome-beta' },
    profile: { type: 'string', default: '.playwright-profiles/chrome-beta' },
    timeout: { type: 'string', default: '300000' },
    headless: { type: 'boolean', default: false },
  },
});

/**
 * Playwright's exact --disable-features default arg. Must match exactly
 * for ignoreDefaultArgs to remove it (exact string comparison).
 *
 * We replace it with the same list minus OptimizationHints, which is
 * required for the on-device model system to function.
 */
const PLAYWRIGHT_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

const DISABLE_FEATURES_WITHOUT_OPT_HINTS =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

/**
 * Playwright defaults that must be removed for the LanguageModel API:
 *
 * --disable-features=...OptimizationHints: Disables the Optimization Guide
 *   that manages on-device models.
 * --disable-field-trial-config: Disables Chrome's field trial system that
 *   gates model eligibility.
 * --disable-background-networking: Prevents variations seed fetch and model
 *   component update checks.
 * --disable-component-update: Prevents the model component from registering.
 */
const IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES,
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-component-update',
];

/**
 * chrome://flags entries stored in Local State -> browser.enabled_labs_experiments.
 * Format: "flag-name@option-index" where @1 = Enabled, @2 = Enabled BypassPerfRequirement.
 */
const browserConfig = {
  'chrome-beta': {
    flags: [
      'optimization-guide-on-device-model@2',
      'prompt-api-for-gemini-nano@1',
    ],
    args: ['--no-first-run', DISABLE_FEATURES_WITHOUT_OPT_HINTS],
  },
  'msedge-dev': {
    flags: [
      'edge-llm-prompt-api-for-phi-mini@1',
      'edge-llm-on-device-model-performance-param@3',
    ],
    args: [
      '--no-first-run',
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
};

const channel = values.browser;
const config = browserConfig[channel];

if (!config) {
  console.error(
    `[ERROR] Unknown browser: ${channel}. Use chrome-beta or msedge-dev.`,
  );
  process.exit(1);
}

// Seed Local State with chrome://flags entries
seedLocalState(values.profile, config.flags);

console.log(
  `[INFO] Launching ${channel} with persistent profile at ${values.profile}`,
);

const context = await chromium.launchPersistentContext(values.profile, {
  channel,
  headless: values.headless,
  args: config.args,
  ignoreDefaultArgs: IGNORE_DEFAULT_ARGS,
});

const page = context.pages()[0] || (await context.newPage());

// Navigate away from about:blank. The LanguageModel API is only exposed in
// navigated page contexts (HTTPS, chrome://, etc.), not on about:blank.
await page.goto('chrome://gpu');

const timeoutMs = parseInt(values.timeout, 10);

const status = await page.evaluate(async (timeout) => {
  if (typeof LanguageModel === 'undefined') {
    return { status: 'no-api', message: 'LanguageModel API is not available' };
  }

  const availability = await LanguageModel.availability();

  if (availability === 'available') {
    return {
      status: 'available',
      message: 'Model is already downloaded and ready',
    };
  }

  if (availability === 'downloadable' || availability === 'downloading') {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Model download timed out after ${timeout}ms`)),
        timeout,
      );

      LanguageModel.create({
        monitor: (monitor) => {
          monitor.addEventListener('downloadprogress', (event) => {
            const pct = ((event.loaded / event.total) * 100).toFixed(1);
            console.log(`Download progress: ${pct}%`);
          });
        },
      })
        .then((session) => {
          clearTimeout(timer);
          session.destroy();
          resolve({ status: 'downloaded', message: 'Model download complete' });
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  return {
    status: availability,
    message: `Unexpected availability: ${availability}`,
  };
}, timeoutMs);

console.log(`[${status.status.toUpperCase()}] ${status.message}`);

await context.close();

if (status.status === 'no-api' || status.status === 'unavailable') {
  process.exit(1);
}

/**
 * Seeds the browser's Local State file with chrome://flags entries.
 * This is equivalent to manually enabling flags via chrome://flags UI.
 */
function seedLocalState(profileDir, flags) {
  mkdirSync(profileDir, { recursive: true });

  const localStatePath = join(profileDir, 'Local State');
  let state = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      state = {};
    }
  }

  if (!state.browser) {
    state.browser = {};
  }

  const existing = state.browser.enabled_labs_experiments || [];
  const existingNames = new Set(existing.map((f) => f.split('@')[0]));

  for (const flag of flags) {
    const name = flag.split('@')[0];

    if (!existingNames.has(name)) {
      existing.push(flag);
      console.log(`[INFO] Seeding flag: ${flag}`);
    } else {
      console.log(`[INFO] Flag already set: ${name}`);
    }
  }

  state.browser.enabled_labs_experiments = existing;

  writeFileSync(localStatePath, JSON.stringify(state, null, 2));
}
