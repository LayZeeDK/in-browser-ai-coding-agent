import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  AI_IGNORE_DEFAULT_ARGS,
  allProfiles,
  seedLocalState,
} from '../../in-browser-ai-coding-agent/browser-profiles';

const profilesByName = Object.fromEntries(allProfiles.map((p) => [p.name, p]));

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
      const profile = profilesByName[projectName];

      if (!profile) {
        throw new Error(
          `No browser profile configured for project "${projectName}". ` +
            `Available: ${allProfiles.map((p) => p.name).join(', ')}`,
        );
      }

      // Seed profile with flags before launching
      seedLocalState(profile);

      // Retry launch — Chrome's ProcessSingleton on Windows may reject
      // the launch if a previous chrome_crashpad_handler is still running
      let context!: BrowserContext;
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          context = await chromium.launchPersistentContext(profile.profileDir, {
            channel: profile.channel,
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

      const phaseStart = Date.now();
      const elapsed = () => `${((Date.now() - phaseStart) / 1000).toFixed(1)}s`;

      try {
        console.log(
          `[fixtures] ${projectName}: navigating to ${profile.onDeviceInternalsUrl}`,
        );
        await warmupPage.goto(profile.onDeviceInternalsUrl);

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

        // Capture GPU diagnostics
        const gpuUrl =
          profile.channel === 'msedge-dev' ? 'edge://gpu' : 'chrome://gpu';
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
        await warmupPage.goto(profile.onDeviceInternalsUrl);

        // Trigger model registration
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

        // Wait for Model Status tab to report "Ready"
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

        // Warm up the inference pipeline with a prompt
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
    { scope: 'worker', timeout: 7_200_000 }, // 2h — matches CI step timeout
  ],

  // Test-scoped: provides a fresh page from the shared context
  persistentPage: async ({ persistentContext }, use) => {
    const page =
      persistentContext.pages()[0] || (await persistentContext.newPage());

    await use(page);
  },
});

export { expect } from '@playwright/test';
