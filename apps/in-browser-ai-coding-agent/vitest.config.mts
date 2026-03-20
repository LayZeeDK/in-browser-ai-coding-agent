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

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances: [
        {
          browser: 'chromium',
          name: 'chrome-gemini-nano',
          provider: playwright({
            launchOptions: {
              channel: 'chrome-beta',
              args: [
                '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
                DISABLE_FEATURES_WITHOUT_OPT_HINTS,
              ],
              ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
            },
          }),
        },
        {
          browser: 'chromium',
          name: 'edge-phi4-mini',
          provider: playwright({
            launchOptions: {
              channel: 'msedge-dev',
              args: [
                '--enable-features=AIPromptAPI',
                '--disable-features=OnDeviceModelPerformanceParams',
                DISABLE_FEATURES_WITHOUT_OPT_HINTS,
              ],
              ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
            },
          }),
        },
      ],
    },
  },
});
