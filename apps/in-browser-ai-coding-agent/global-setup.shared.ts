/**
 * Shared warm-up logic for Vitest globalSetup files.
 *
 * Each globalSetup entry point (global-setup.ts, global-setup.chrome.ts,
 * global-setup.edge.ts) calls warmUpInstances() with its browser list.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const PLAYWRIGHT_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

const DISABLE_FEATURES_WITHOUT_OPT_HINTS =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES,
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-component-update',
];

export interface BrowserInstance {
  name: string;
  channel: string;
  profileDir: string;
  onDeviceInternalsUrl: string;
  args: string[];
}

export const allInstances: BrowserInstance[] = [
  {
    name: 'chrome-gemini-nano',
    channel: 'chrome-beta',
    profileDir: resolve('.playwright-profiles/chrome-beta'),
    onDeviceInternalsUrl: 'chrome://on-device-internals',
    args: [
      '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
  {
    name: 'edge-phi4-mini',
    channel: 'msedge-dev',
    profileDir: resolve('.playwright-profiles/msedge-dev'),
    onDeviceInternalsUrl: 'edge://on-device-internals',
    args: [
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
  },
];

/**
 * Warm up the given browser instances. Skips instances without a
 * profile directory on disk and instances already warmed in this process.
 *
 * Uses a PID-based file marker to guard against duplicate invocations —
 * Vitest calls globalSetup.setup() twice in browser mode (once during
 * orchestrator init, once when the browser instance starts). The module-
 * level Set approach fails because Vitest re-imports the module fresh
 * for the second call.
 */
export async function warmUpInstances(instances: BrowserInstance[]) {
  const pid = process.pid.toString();

  for (const instance of instances) {
    if (!existsSync(instance.profileDir)) {
      continue;
    }

    // Skip if already warmed in this process (same PID = same Vitest run)
    const markerPath = join(instance.profileDir, '.warmup-pid');

    if (existsSync(markerPath)) {
      try {
        if (readFileSync(markerPath, 'utf8') === pid) {
          console.log(
            `[global-setup] ${instance.name}: already warmed (pid ${pid}), skipping`,
          );

          continue;
        }
      } catch {
        // stale or corrupt marker — proceed with warm-up
      }
    }

    try {
      await warmUpModel(instance);
      writeFileSync(markerPath, pid);
    } catch (error) {
      console.warn(
        `[global-setup] Model warm-up skipped for ${instance.name}: ${error}`,
      );
    }
  }
}

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

async function warmUpModel(instance: BrowserInstance) {
  enableInternalDebugPages(instance.profileDir);

  // Retry launch — Chrome's ProcessSingleton on Windows may reject
  // the launch if a previous chrome_crashpad_handler is still running
  let context;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      context = await chromium.launchPersistentContext(instance.profileDir, {
        channel: instance.channel,
        headless: false,
        args: instance.args,
        ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
        timeout: 60_000,
      });

      break;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.warn(
        `[global-setup] ${instance.name}: launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`,
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
    await page.goto(instance.onDeviceInternalsUrl);

    // Trigger model registration so the model system starts loading.
    // create() is lightweight (no inference) but kicks off the
    // optimization guide pipeline that Model Status reflects.
    console.log(
      `[global-setup] ${instance.name}: triggering LanguageModel.create() [${elapsed()}]`,
    );
    const availability = await page.evaluate(async () => {
      if (typeof LanguageModel === 'undefined') {
        return 'no-api';
      }

      return LanguageModel.availability();
    });
    console.log(
      `[global-setup] ${instance.name}: LanguageModel.availability() = "${availability}" [${elapsed()}]`,
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
      `[global-setup] ${instance.name}: model session created and destroyed (${(createMs / 1000).toFixed(1)}s) [${elapsed()}]`,
    );

    // Step 1: Wait for Model Status tab to report "Ready"
    const modelStatusTab = page
      .getByRole('tab', { name: /Model Status/i })
      .or(page.locator('text=Model Status'));

    if (
      !(await modelStatusTab.isVisible({ timeout: 10_000 }).catch(() => false))
    ) {
      console.warn(
        `[global-setup] ${instance.name}: Model Status tab not found, skipping`,
      );
      return;
    }

    await modelStatusTab.click();
    console.log(
      `[global-setup] ${instance.name}: waiting for model ready state... [${elapsed()}]`,
    );

    const deadline = Date.now() + 1_200_000;
    let lastLogTime = 0;

    while (Date.now() < deadline) {
      const readyEl = page.getByText(/Foundational model state:\s*Ready/i);

      if (await readyEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log(
          `[global-setup] ${instance.name}: model is ready [${elapsed()}]`,
        );

        break;
      }

      // Log current state for diagnostics (throttle to ~1 per 30s)
      const now = Date.now();

      if (!lastLogTime || now - lastLogTime >= 30_000) {
        lastLogTime = now;
        const stateText = await page
          .locator(':has-text("Foundational model state")')
          .last()
          .textContent()
          .catch(() => '(not found)');
        console.log(
          `[global-setup] ${instance.name}: ${stateText?.trim().substring(0, 100)}`,
        );
      }

      // Only refresh on explicit error — "NO STATE" is a transient
      // loading state that resolves on its own. Reload lands on the
      // default "Tools" tab, so re-click Model Status after.
      const notReady = page.getByText(/Not Ready For Unknown Reason/i);

      if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(`[global-setup] ${instance.name}: refreshing...`);
        await page.reload();
        await modelStatusTab.click();
      }
    }

    // Step 2: Warm up the inference pipeline with a prompt.
    // Wrap in Promise.race — page.evaluate has no built-in timeout,
    // so session.prompt() can hang indefinitely if the model fails to load.
    console.log(
      `[global-setup] ${instance.name}: warming up model (first inference may take minutes)...`,
    );
    const promptStart = Date.now();
    const warmupTimeout = 1_200_000; // 20 min
    await Promise.race([
      page.evaluate(async () => {
        if (typeof LanguageModel !== 'undefined') {
          const session = await LanguageModel.create();
          await session.prompt('warmup');
          session.destroy();
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Warm-up prompt timed out')),
          warmupTimeout,
        ),
      ),
    ]);
    const promptMs = Date.now() - promptStart;
    console.log(
      `[global-setup] ${instance.name}: warm-up prompt complete (${(promptMs / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    console.warn(`[global-setup] ${instance.name}: warm-up failed: ${error}`);
  }

  await context.close();
}
