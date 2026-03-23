/**
 * Shared diagnostics logic for Vitest globalSetup files.
 *
 * Each globalSetup entry point (global-setup.ts, global-setup.chrome.ts,
 * global-setup.edge.ts) calls setupInstances() with its browser list.
 *
 * This runs diagnostics (GPU, model status) in a separate browser.
 * The actual inference warm-up is in browser-warmup.ts (setupFile)
 * which runs in the same browser process as tests.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  AI_IGNORE_DEFAULT_ARGS,
  allProfiles,
  seedLocalState,
  type BrowserProfile,
} from './browser-profiles';

export { allProfiles };

/**
 * Set up the given browser instances: seed profile, run diagnostics.
 *
 * Uses a PID-based file marker to guard against duplicate invocations —
 * Vitest calls globalSetup.setup() twice in browser mode (once during
 * orchestrator init, once when the browser instance starts).
 */
export async function setupInstances(profiles: BrowserProfile[]) {
  const pid = process.pid.toString();

  for (const profile of profiles) {
    // Ensure profile exists with correct flags — even if no bootstrap ran
    seedLocalState(profile);

    // Skip if diagnostics already ran in this process (same PID = same Vitest run)
    const markerPath = join(profile.profileDir, '.setup-pid');

    if (existsSync(markerPath)) {
      try {
        if (readFileSync(markerPath, 'utf8') === pid) {
          console.log(
            `[global-setup] ${profile.name}: diagnostics already ran (pid ${pid}), skipping`,
          );

          continue;
        }
      } catch {
        // stale or corrupt marker — proceed
      }
    }

    try {
      await runDiagnostics(profile);
      writeFileSync(markerPath, pid);
    } catch (error) {
      console.warn(
        `[global-setup] diagnostics skipped for ${profile.name}: ${error}`,
      );
    }
  }
}

async function runDiagnostics(profile: BrowserProfile) {
  // Retry launch — Chrome's ProcessSingleton on Windows may reject
  // the launch if a previous chrome_crashpad_handler is still running
  let context;
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
        `[global-setup] ${profile.name}: launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`,
      );
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  if (!context) {
    return;
  }

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(600_000);

  const phaseStart = Date.now();
  const elapsed = () => `${((Date.now() - phaseStart) / 1000).toFixed(1)}s`;

  try {
    await page.goto(profile.onDeviceInternalsUrl);

    // Log on-device-internals diagnostics (Tools tab is default)
    await page.waitForTimeout(3_000);
    const toolsSnapshot = await page.locator('body').ariaSnapshot();
    const toolsLines = toolsSnapshot
      .split('\n')
      .filter((l: string) => /performance class|model directory/i.test(l));
    console.log(`[global-setup] ${profile.name}: on-device-internals (Tools):`);

    for (const line of toolsLines) {
      console.log(`  ${line.trim()}`);
    }

    // Click Model Status tab for model state + crash count
    const diagModelStatusTab = page
      .getByRole('tab', { name: /Model Status/i })
      .or(page.locator('text=Model Status'));

    if (
      await diagModelStatusTab.isVisible({ timeout: 5_000 }).catch(() => false)
    ) {
      await diagModelStatusTab.click();
      await page.waitForTimeout(1_000);
      const statusSnapshot = await page.locator('body').ariaSnapshot();
      const statusLines = statusSnapshot
        .split('\n')
        .filter((l: string) =>
          /model state|crash count|^.*row "k\w+|OPTIMIZATION_TARGET|device capable|disk space|enterprise|enabled by|installing|recently used|retention|VRAM/i.test(
            l,
          ),
        );
      console.log(
        `[global-setup] ${profile.name}: on-device-internals (Model Status):`,
      );

      for (const line of statusLines) {
        console.log(`  ${line.trim()}`);
      }
    }

    // Capture GPU diagnostics
    const gpuUrl =
      profile.channel === 'msedge-dev' ? 'edge://gpu' : 'chrome://gpu';
    await page.goto(gpuUrl);
    await page.waitForTimeout(3_000);
    const gpuSnapshot = await page.locator('body').ariaSnapshot();
    const gpuLines = gpuSnapshot
      .split('\n')
      .filter((l: string) =>
        /gpu0|gpu1|npu|webnn|directml|d3d1[12] feature|driver d3d|has discrete|software rendering|physical memory|disk space|hardware concurrency|commit limit|canvas:|compositing:|rasterization:|video decode:|webgl:|webgpu:/i.test(
          l,
        ),
      );
    console.log(`[global-setup] ${profile.name}: GPU diagnostics:`);

    for (const line of gpuLines) {
      console.log(`  ${line.trim()}`);
    }

    // Trigger model registration
    await page.goto(profile.onDeviceInternalsUrl);
    console.log(
      `[global-setup] ${profile.name}: triggering LanguageModel.create() [${elapsed()}]`,
    );
    const availability = await page.evaluate(async () => {
      if (typeof LanguageModel === 'undefined') {
        return 'no-api';
      }

      return LanguageModel.availability();
    });
    console.log(
      `[global-setup] ${profile.name}: LanguageModel.availability() = "${availability}" [${elapsed()}]`,
    );

    const createStart = Date.now();
    await page.evaluate(async () => {
      if (typeof LanguageModel !== 'undefined') {
        const session = await LanguageModel.create();
        session.destroy();
      }
    });
    const createMs = Date.now() - createStart;
    console.log(
      `[global-setup] ${profile.name}: model session created and destroyed (${(createMs / 1000).toFixed(1)}s) [${elapsed()}]`,
    );

    // Wait for Model Status tab to report "Ready"
    const modelStatusTab = page
      .getByRole('tab', { name: /Model Status/i })
      .or(page.locator('text=Model Status'));

    if (
      !(await modelStatusTab.isVisible({ timeout: 10_000 }).catch(() => false))
    ) {
      console.warn(
        `[global-setup] ${profile.name}: Model Status tab not found, skipping`,
      );

      return;
    }

    await modelStatusTab.click();
    console.log(
      `[global-setup] ${profile.name}: waiting for model ready state... [${elapsed()}]`,
    );

    const deadline = Date.now() + 1_200_000;
    let lastLogTime = 0;

    while (Date.now() < deadline) {
      const readyEl = page.getByText(/Foundational model state:\s*Ready/i);

      if (await readyEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log(
          `[global-setup] ${profile.name}: model is ready [${elapsed()}]`,
        );

        break;
      }

      const now = Date.now();

      if (!lastLogTime || now - lastLogTime >= 30_000) {
        lastLogTime = now;
        const stateText = await page
          .locator(':has-text("Foundational model state")')
          .last()
          .textContent()
          .catch(() => '(not found)');
        console.log(
          `[global-setup] ${profile.name}: ${stateText?.trim().substring(0, 100)}`,
        );
      }

      const notReady = page.getByText(/Not Ready For Unknown Reason/i);

      if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(`[global-setup] ${profile.name}: refreshing...`);
        await page.reload();
        await modelStatusTab.click();
      }
    }

    // NOTE: Inference warm-up is in browser-warmup.ts (Vitest setupFile)
    // which runs in the SAME browser process as tests.
  } catch (error) {
    console.warn(
      `[global-setup] ${profile.name}: diagnostics failed: ${error}`,
    );
  }

  await context.close();
}
