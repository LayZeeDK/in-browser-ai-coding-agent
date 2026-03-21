import { resolve } from 'node:path';
import { test as base, chromium, type Page } from '@playwright/test';
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

const browserProfiles: Record<string, { profileDir: string; args: string[] }> =
  {
    'chrome-gemini-nano': {
      profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
      args: [
        '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
        DISABLE_FEATURES_WITHOUT_OPT_HINTS,
      ],
    },
    'edge-phi4-mini': {
      profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
      args: [
        '--enable-features=AIPromptAPI',
        '--disable-features=OnDeviceModelPerformanceParams',
        DISABLE_FEATURES_WITHOUT_OPT_HINTS,
      ],
    },
  };

/**
 * Custom Playwright fixture that launches a persistent browser context
 * using the bootstrapped profile directory. This gives tests access to
 * the pre-downloaded AI model from the bootstrap script.
 */
export const test = base.extend<{ persistentPage: Page }>({
  // eslint-disable-next-line no-empty-pattern
  persistentPage: async ({}, use, testInfo) => {
    const projectName = testInfo.project.name;
    const profile = browserProfiles[projectName];

    if (!profile) {
      throw new Error(
        `No browser profile configured for project "${projectName}". ` +
          `Available: ${Object.keys(browserProfiles).join(', ')}`,
      );
    }

    const context = await chromium.launchPersistentContext(profile.profileDir, {
      channel: testInfo.project.use.channel as string,
      headless: false,
      args: profile.args,
      ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
    });

    const page = context.pages()[0] || (await context.newPage());

    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
