/**
 * Vitest globalSetup — runs in Node.js before the browser launches.
 * Warms up on-device AI models by launching each browser's persistent
 * context, navigating to the on-device-internals page, and waiting for
 * "Foundational model state: Ready".
 *
 * Only warms up instances selected by CI_VITEST_BROWSER_INSTANCE (in CI)
 * or all instances (locally). Runs once per vitest invocation, including
 * Vitest UI mode — subsequent test re-runs reuse the warm model.
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

interface BrowserInstance {
  name: string;
  channel: string;
  profileDir: string;
  onDeviceInternalsUrl: string;
  args: string[];
}

const allInstances: BrowserInstance[] = [
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

export async function setup() {
  const filterInstance = process.env['CI_VITEST_BROWSER_INSTANCE'];
  const instances = filterInstance
    ? allInstances.filter((i) => i.name === filterInstance)
    : allInstances;

  for (const instance of instances) {
    if (!existsSync(instance.profileDir)) {
      continue;
    }

    try {
      await warmUpModel(instance);
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

  try {
    await page.goto(instance.onDeviceInternalsUrl);

    // Trigger model loading and run first inference to warm up
    console.log(
      `[global-setup] ${instance.name}: warming up model (first inference may take minutes)...`,
    );
    await page.evaluate(async () => {
      if (typeof LanguageModel !== 'undefined') {
        const session = await LanguageModel.create();
        await session.prompt('warmup');
        session.destroy();
      }
    });
    console.log(`[global-setup] ${instance.name}: warm-up prompt complete`);

    console.log(
      `[global-setup] ${instance.name}: waiting for model ready state...`,
    );

    // Click "Model Status" tab — bail if not found (container rendering)
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

    // Wait for "Foundational model state: Ready"
    const deadline = Date.now() + 600_000;

    while (Date.now() < deadline) {
      const readyEl = page.getByText(/Foundational model state:\s*Ready/i);

      if (await readyEl.isVisible({ timeout: 30_000 }).catch(() => false)) {
        console.log(`[global-setup] ${instance.name}: model is ready`);

        break;
      }

      const notReady = page.getByText(/Not Ready For Unknown Reason/i);

      if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(
          `[global-setup] ${instance.name}: model not ready, refreshing...`,
        );
        await page.reload();
        await modelStatusTab.click();
      }
    }
  } catch (error) {
    console.warn(`[global-setup] ${instance.name}: warm-up failed: ${error}`);
  }

  await context.close();
}
