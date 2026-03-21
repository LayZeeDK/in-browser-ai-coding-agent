import { defineConfig } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const port = process.env['E2E_PORT'] || '4200';
const baseURL = process.env['BASE_URL'] || `http://localhost:${port}`;

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
const preset = nxE2EPreset(__filename, { testDir: './src' });

export default defineConfig({
  ...preset,
  globalSetup: './src/global-setup.ts',
  reporter: [
    ...((Array.isArray(preset.reporter)
      ? preset.reporter
      : []) as ReporterDescription[]),
    ...(process.env['CI'] ? [['github'] as ReporterDescription] : []),
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx nx run in-browser-ai-coding-agent:serve -- --port=${port}`,
    url: baseURL,
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
            '--enable-features=AIPromptAPI',
            '--disable-features=OnDeviceModelPerformanceParams',
            DISABLE_FEATURES_WITHOUT_OPT_HINTS,
          ],
          ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
        },
      },
    },
  ],
});
