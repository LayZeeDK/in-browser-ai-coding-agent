import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const browserProfiles: Record<
  string,
  { profileDir: string; args: string[]; flags: string[] }
> = {
  'chrome-gemini-nano': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
    args: [
      '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
    flags: [
      'optimization-guide-on-device-model@1',
      'prompt-api-for-gemini-nano@1',
    ],
  },
  'edge-phi4-mini': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
    args: [
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
    flags: [
      'edge-llm-prompt-api-for-phi-mini@1',
      'edge-llm-on-device-model-performance-param@3',
      'edge-llm-on-device-model-debug-logs@1',
    ],
  },
};

/**
 * Seed the profile's Local State with required chrome://flags entries
 * and enable internal debug pages. Creates the profile directory if
 * it doesn't exist (e.g., container with cache miss and no bootstrap).
 */
function seedLocalState(profileDir: string, flags: string[]) {
  const localStatePath = join(profileDir, 'Local State');
  let state: Record<string, unknown> = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  // Seed chrome://flags entries
  if (!state['browser']) {
    state['browser'] = {};
  }

  const browser = state['browser'] as Record<string, unknown>;
  const existing = (browser['enabled_labs_experiments'] as string[]) || [];
  const existingNames = new Set(existing.map((f: string) => f.split('@')[0]));

  for (const flag of flags) {
    const name = flag.split('@')[0];

    if (!existingNames.has(name)) {
      existing.push(flag);
    }
  }

  browser['enabled_labs_experiments'] = existing;

  // Enable internal debug pages
  state['internal_only_uis_enabled'] = true;

  mkdirSync(profileDir, { recursive: true });
  writeFileSync(localStatePath, JSON.stringify(state, null, 2));
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
      seedLocalState(profile.profileDir, profile.flags);

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

      const phaseStart = Date.now();
      const elapsed = () => `${((Date.now() - phaseStart) / 1000).toFixed(1)}s`;

      try {
        console.log(`[fixtures] ${projectName}: navigating to ${onDeviceUrl}`);
        await warmupPage.goto(onDeviceUrl);

        // Log on-device-internals diagnostics (Tools tab is default)
        await warmupPage.waitForTimeout(3_000);
        const toolsSnapshot = await warmupPage.locator('body').ariaSnapshot();
        const toolsLines = toolsSnapshot
          .split('\n')
          .filter((l: string) => /performance class|model directory/i.test(l));
        console.log(`[fixtures] ${projectName}: on-device-internals (Tools):`);

        for (const line of toolsLines) {
          console.log(`  ${line.trim()}`);
        }

        // Click Model Status tab for model state + crash count
        const diagModelStatusTab = warmupPage
          .getByRole('tab', { name: /Model Status/i })
          .or(warmupPage.locator('text=Model Status'));

        if (
          await diagModelStatusTab
            .isVisible({ timeout: 5_000 })
            .catch(() => false)
        ) {
          await diagModelStatusTab.click();
          await warmupPage.waitForTimeout(1_000);
          const statusSnapshot = await warmupPage
            .locator('body')
            .ariaSnapshot();
          const statusLines = statusSnapshot
            .split('\n')
            .filter((l: string) =>
              /model state|crash count|^.*row "k\w+|OPTIMIZATION_TARGET|device capable|disk space|enterprise|enabled by|installing|recently used|retention|VRAM/i.test(
                l,
              ),
            );
          console.log(
            `[fixtures] ${projectName}: on-device-internals (Model Status):`,
          );

          for (const line of statusLines) {
            console.log(`  ${line.trim()}`);
          }
        }

        // Capture GPU diagnostics — graphics features, driver info,
        // device performance (memory, cores, D3D level, GPU/NPU)
        const gpuUrl =
          workerInfo.project.use.channel === 'msedge-dev'
            ? 'edge://gpu'
            : 'chrome://gpu';
        await warmupPage.goto(gpuUrl);
        await warmupPage.waitForTimeout(3_000);
        const gpuSnapshot = await warmupPage.locator('body').ariaSnapshot();
        const gpuLines = gpuSnapshot
          .split('\n')
          .filter((l: string) =>
            /gpu0|gpu1|npu|webnn|directml|d3d1[12] feature|driver d3d|has discrete|software rendering|physical memory|disk space|hardware concurrency|commit limit|canvas:|compositing:|rasterization:|video decode:|webgl:|webgpu:/i.test(
              l,
            ),
          );
        console.log(`[fixtures] ${projectName}: GPU diagnostics:`);

        for (const line of gpuLines) {
          console.log(`  ${line.trim()}`);
        }

        // Return to on-device internals for the rest of the warm-up
        await warmupPage.goto(onDeviceUrl);

        // Trigger model registration so the model system starts loading.
        // create() is lightweight (no inference) but kicks off the
        // optimization guide pipeline that Model Status reflects.
        const availability = await warmupPage.evaluate(async () => {
          if (typeof LanguageModel === 'undefined') {
            return 'no-api';
          }

          return LanguageModel.availability();
        });
        console.log(
          `[fixtures] ${projectName}: LanguageModel.availability() = "${availability}" [${elapsed()}]`,
        );

        console.log(
          `[fixtures] ${projectName}: triggering LanguageModel.create() [${elapsed()}]`,
        );
        const createStart = Date.now();
        await warmupPage.evaluate(async () => {
          if (typeof LanguageModel !== 'undefined') {
            const session = await LanguageModel.create();
            session.destroy();
          }
        });
        const createMs = Date.now() - createStart;
        console.log(
          `[fixtures] ${projectName}: model session created and destroyed (${(createMs / 1000).toFixed(1)}s) [${elapsed()}]`,
        );

        // Step 1: Wait for Model Status tab to report "Ready"
        const modelStatusTab = warmupPage
          .getByRole('tab', { name: /Model Status/i })
          .or(warmupPage.locator('text=Model Status'));

        if (
          !(await modelStatusTab
            .isVisible({ timeout: 10_000 })
            .catch(() => false))
        ) {
          console.warn(
            `[fixtures] ${projectName}: Model Status tab not found, skipping`,
          );
        } else {
          await modelStatusTab.click();
          console.log(
            `[fixtures] ${projectName}: waiting for model ready state... [${elapsed()}]`,
          );

          const deadline = Date.now() + 1_200_000;
          let lastLogTime = 0;

          while (Date.now() < deadline) {
            const readyEl = warmupPage.getByText(
              /Foundational model state:\s*Ready/i,
            );

            if (
              await readyEl.isVisible({ timeout: 5_000 }).catch(() => false)
            ) {
              console.log(
                `[fixtures] ${projectName}: model is ready [${elapsed()}]`,
              );

              break;
            }

            // Log current state for diagnostics (throttle to ~1 per 30s)
            const now = Date.now();

            if (!lastLogTime || now - lastLogTime >= 30_000) {
              lastLogTime = now;
              const stateText = await warmupPage
                .locator(':has-text("Foundational model state")')
                .last()
                .textContent()
                .catch(() => '(not found)');
              console.log(
                `[fixtures] ${projectName}: ${stateText?.trim().substring(0, 100)}`,
              );
            }

            // Only refresh on explicit error — "NO STATE" is a transient
            // loading state that resolves on its own. Reload lands on the
            // default "Tools" tab, so re-click Model Status after.
            const notReady = warmupPage.getByText(
              /Not Ready For Unknown Reason/i,
            );

            if (
              await notReady.isVisible({ timeout: 1_000 }).catch(() => false)
            ) {
              console.log(`[fixtures] ${projectName}: refreshing...`);
              await warmupPage.waitForTimeout(2_000);
              await warmupPage.reload();
              await modelStatusTab.click();
            }
          }
        }

        // Step 2: Warm up the inference pipeline with a prompt
        console.log(
          `[fixtures] ${projectName}: warming up model (first inference may take minutes)...`,
        );
        const promptStart = Date.now();
        await warmupPage.evaluate(async () => {
          if (typeof LanguageModel !== 'undefined') {
            const session = await LanguageModel.create();
            await session.prompt('warmup');
            session.destroy();
          }
        });
        const promptMs = Date.now() - promptStart;
        console.log(
          `[fixtures] ${projectName}: warm-up prompt complete (${(promptMs / 1000).toFixed(1)}s)`,
        );
      } catch (error) {
        console.warn(`[fixtures] ${projectName}: warm-up failed: ${error}`);
      }

      await use(context);
      await context.close();
    },
    { scope: 'worker', timeout: 2_400_000 },
  ],

  // Test-scoped: provides a fresh page from the shared context
  persistentPage: async ({ persistentContext }, use) => {
    const page =
      persistentContext.pages()[0] || (await persistentContext.newPage());

    await use(page);
  },
});

export { expect } from '@playwright/test';
