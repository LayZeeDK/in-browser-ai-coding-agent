import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

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

/** All browser instances for on-device AI testing. */
export const allInstances = [
  {
    browser: 'chromium' as const,
    name: 'chrome-gemini-nano',
    provider: playwright({
      persistentContext: resolve('.playwright-profiles/chrome-beta'),
      launchOptions: {
        channel: 'chrome-beta',
        headless: false,
        args: [
          '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
          DISABLE_FEATURES_WITHOUT_OPT_HINTS,
        ],
        ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
      },
    }),
  },
  {
    browser: 'chromium' as const,
    name: 'edge-phi4-mini',
    provider: playwright({
      persistentContext: resolve('.playwright-profiles/msedge-dev'),
      launchOptions: {
        channel: 'msedge-dev',
        headless: false,
        args: [
          '--enable-features=AIPromptAPI',
          '--disable-features=OnDeviceModelPerformanceParams',
          DISABLE_FEATURES_WITHOUT_OPT_HINTS,
        ],
        ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
      },
    }),
  },
];

const appRoot = 'apps/in-browser-ai-coding-agent';

/**
 * Creates a Vitest config for on-device AI browser testing.
 *
 * @param options.instanceFilter - Instance name to select a single browser.
 *   When omitted, all instances run.
 * @param options.globalSetup - Path to the globalSetup file that warms up
 *   the matching browser(s). Defaults to the all-browsers setup.
 */
export function createVitestConfig(options?: {
  instanceFilter?: string;
  globalSetup?: string;
}) {
  const { instanceFilter, globalSetup = `${appRoot}/global-setup.ts` } =
    options ?? {};

  const instances = instanceFilter
    ? allInstances.filter((i) => i.name === instanceFilter)
    : allInstances;

  return defineConfig({
    test: {
      globalSetup: [globalSetup],
      // Persistent context cannot be shared across parallel sessions
      fileParallelism: false,
      // No retries — each retry would re-launch the browser and re-warm the
      // model (12+ min cold-start on ARM64), exceeding CI step timeouts.
      retry: 0,
      // Surface flaky test annotations in GitHub Actions job summaries
      reporters: process.env['CI']
        ? ['default', 'github-actions']
        : ['default'],
      browser: {
        enabled: true,
        instances,
        trace: process.env['CI'] ? 'on-first-retry' : 'off',
      },
    },
  });
}
