import { resolve } from 'node:path';
import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
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
 * Worker-scoped persistent browser context. Launches once per worker,
 * stays alive for all tests in that worker, then closes. This avoids
 * the Chrome ProcessSingleton issue where closing and relaunching a
 * persistent context fails on Windows because crashpad holds the
 * profile lockfile.
 *
 * With workers: 1, all tests share a single persistent context.
 */
export const test = base.extend<
  { persistentPage: Page },
  { persistentContext: BrowserContext }
>({
  // Worker-scoped: launches once, shared across all tests in the worker
  persistentContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const projectName = workerInfo.project.name;
      const profile = browserProfiles[projectName];

      if (!profile) {
        throw new Error(
          `No browser profile configured for project "${projectName}". ` +
            `Available: ${Object.keys(browserProfiles).join(', ')}`,
        );
      }

      // Retry launch — Chrome's ProcessSingleton on Windows may reject
      // the launch if a previous chrome_crashpad_handler is still running
      let context!: BrowserContext;
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          context = await chromium.launchPersistentContext(profile.profileDir, {
            channel: workerInfo.project.use.channel as string,
            headless: false,
            args: profile.args,
            ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
            timeout: 60_000,
          });

          break;
        } catch (error) {
          if (attempt === maxAttempts) {
            throw error;
          }

          console.warn(
            `[fixtures] Launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`,
          );
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }

      // Warm up: navigate to on-device-internals and wait for model ready
      const warmupPage = context.pages()[0] || (await context.newPage());

      const onDeviceUrl =
        workerInfo.project.use.channel === 'msedge-dev'
          ? 'edge://on-device-internals'
          : 'chrome://on-device-internals';

      try {
        await warmupPage.goto(onDeviceUrl);

        // Chrome may gate debug pages behind an enable button
        const disabledText = warmupPage.getByText(
          /debugging pages are currently disabled/i,
        );

        if (
          await disabledText.isVisible({ timeout: 3_000 }).catch(() => false)
        ) {
          await warmupPage
            .getByRole('button', { name: /enable/i })
            .or(warmupPage.locator('button:has-text("Enable")'))
            .click();
          await warmupPage.waitForTimeout(1_000);
          await warmupPage.goto(onDeviceUrl);
        }

        // Trigger model loading
        await warmupPage.evaluate(async () => {
          if (typeof LanguageModel !== 'undefined') {
            const session = await LanguageModel.create();
            session.destroy();
          }
        });

        // Wait for model ready state — bail if Model Status tab
        // isn't found (page may render differently in containers)
        const modelStatusTab = warmupPage
          .getByRole('tab', { name: /Model Status/i })
          .or(warmupPage.locator('text=Model Status'));

        if (
          !(await modelStatusTab
            .isVisible({ timeout: 10_000 })
            .catch(() => false))
        ) {
          console.warn(
            '[fixtures] Model Status tab not found, skipping warm-up',
          );
        } else {
          await modelStatusTab.click();

          const deadline = Date.now() + 600_000;

          while (Date.now() < deadline) {
            const readyEl = warmupPage.getByText(
              /Foundational model state:\s*Ready/i,
            );

            if (
              await readyEl.isVisible({ timeout: 30_000 }).catch(() => false)
            ) {
              break;
            }

            const notReady = warmupPage.getByText(
              /Not Ready For Unknown Reason/i,
            );

            if (
              await notReady.isVisible({ timeout: 1_000 }).catch(() => false)
            ) {
              await warmupPage.reload();
              await modelStatusTab.click();
            }
          }
        }
      } catch (error) {
        console.warn(`[fixtures] Model warm-up failed: ${error}`);
      }

      await use(context);
      await context.close();
    },
    { scope: 'worker', timeout: 1_200_000 },
  ],

  // Test-scoped: provides a fresh page from the shared context
  persistentPage: async ({ persistentContext }, use) => {
    const page =
      persistentContext.pages()[0] || (await persistentContext.newPage());

    await use(page);
  },
});

export { expect } from '@playwright/test';
