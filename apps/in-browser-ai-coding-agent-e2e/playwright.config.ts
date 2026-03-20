import { defineConfig } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

/**
 * Playwright's exact --disable-features default arg. Must match exactly
 * for ignoreDefaultArgs to remove it (exact string comparison).
 */
const PLAYWRIGHT_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

/** Same list without OptimizationHints — required for on-device AI. */
const DISABLE_FEATURES_WITHOUT_OPT_HINTS =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

/**
 * Playwright defaults to remove for LanguageModel API support:
 * - OptimizationHints in --disable-features: disables the model system
 * - --disable-field-trial-config: disables model eligibility checks
 * - --disable-background-networking: prevents model registration
 * - --disable-component-update: prevents model component loading
 */
const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES,
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-component-update',
];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx nx run in-browser-ai-coding-agent:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chrome-gemini-nano',
      use: {
        channel: 'chrome-beta',
        launchOptions: {
          args: [
            '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
            DISABLE_FEATURES_WITHOUT_OPT_HINTS,
          ],
          ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
        },
      },
    },
    {
      name: 'edge-phi4-mini',
      use: {
        channel: 'msedge-dev',
        launchOptions: {
          args: [
            '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForPhiMini',
            DISABLE_FEATURES_WITHOUT_OPT_HINTS,
          ],
          ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
        },
      },
    },
  ],
});
