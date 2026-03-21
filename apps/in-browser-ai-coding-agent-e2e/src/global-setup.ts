import { resolve } from 'node:path';
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

const browserProfiles: Record<
  string,
  { profileDir: string; channel: string; args: string[] }
> = {
  'chrome-gemini-nano': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
    channel: 'chrome-beta',
    args: [
      '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
  'edge-phi4-mini': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
    channel: 'msedge-dev',
    args: [
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
};

/**
 * Global setup: warm up the on-device AI model by prompting it once.
 * Runs in Node.js before any test files execute. Launches a persistent
 * browser context (same profile as tests), sends a warm-up prompt, then
 * closes. The model's inference pipeline is fully initialized so tests
 * don't pay cold-start latency.
 */
export default async function globalSetup(config: FullConfig) {
  for (const project of config.projects) {
    const profile = browserProfiles[project.name];

    if (!profile) {
      continue;
    }

    const context = await chromium.launchPersistentContext(profile.profileDir, {
      channel: profile.channel,
      headless: false,
      args: profile.args,
      ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto('about:blank');

    try {
      await page.waitForFunction(
        async () => {
          if (typeof LanguageModel === 'undefined') {
            return true;
          }

          const status = await LanguageModel.availability();

          if (status !== 'available') {
            return true;
          }

          const session = await LanguageModel.create();
          await session.prompt('warmup');
          session.destroy();

          return true;
        },
        { timeout: 300_000 },
      );
    } catch (error) {
      console.warn(
        `[global-setup] Model warm-up failed for ${project.name}: ${error}`,
      );
    }

    await context.close();
  }
}
