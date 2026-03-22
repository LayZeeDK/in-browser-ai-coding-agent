import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
 * Ensure chrome://on-device-internals is accessible by seeding the
 * internal_only_uis_enabled flag in the profile's Local State file.
 */
function enableInternalDebugPages(profileDir: string) {
  const localStatePath = join(profileDir, 'Local State');
  let state: Record<string, unknown> = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  if (!state['internal_only_uis_enabled']) {
    state['internal_only_uis_enabled'] = true;
    writeFileSync(localStatePath, JSON.stringify(state, null, 2));
  }
}

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

      // Seed internal debug pages flag before launching
      enableInternalDebugPages(profile.profileDir);

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
        console.log(`[fixtures] ${projectName}: navigating to ${onDeviceUrl}`);
        await warmupPage.goto(onDeviceUrl);

        // Trigger model loading
        console.log(
          `[fixtures] ${projectName}: triggering LanguageModel.create()`,
        );
        console.log(
          `[fixtures] ${projectName}: warming up model (first inference may take minutes)...`,
        );
        await warmupPage.evaluate(async () => {
          if (typeof LanguageModel !== 'undefined') {
            const session = await LanguageModel.create();
            await session.prompt('warmup');
            session.destroy();
          }
        });
        console.log(`[fixtures] ${projectName}: warm-up prompt complete`);

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
            `[fixtures] ${projectName}: Model Status tab not found, skipping warm-up`,
          );
        } else {
          await modelStatusTab.click();
          console.log(
            `[fixtures] ${projectName}: waiting for model ready state...`,
          );

          const deadline = Date.now() + 600_000;

          while (Date.now() < deadline) {
            const readyEl = warmupPage.getByText(
              /Foundational model state:\s*Ready/i,
            );

            if (
              await readyEl.isVisible({ timeout: 30_000 }).catch(() => false)
            ) {
              console.log(`[fixtures] ${projectName}: model is ready`);

              break;
            }

            // Log current state for diagnostics
            const stateText = await warmupPage
              .locator(':has-text("Foundational model state")')
              .last()
              .textContent()
              .catch(() => '(not found)');
            console.log(
              `[fixtures] ${projectName}: ${stateText?.trim().substring(0, 100)}`,
            );

            const notReady = warmupPage.getByText(
              /Not Ready For Unknown Reason/i,
            );

            if (
              await notReady.isVisible({ timeout: 1_000 }).catch(() => false)
            ) {
              console.log(`[fixtures] ${projectName}: refreshing...`);
              await warmupPage.reload();
              await modelStatusTab.click();
            }
          }
        }
      } catch (error) {
        console.warn(`[fixtures] ${projectName}: warm-up failed: ${error}`);
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
