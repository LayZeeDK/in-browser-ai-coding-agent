/**
 * Bootstrap script that runs inside the Chrome Beta container with --ipc=host.
 * Downloads the Gemini Nano model and optionally warms up inference.
 *
 * Usage (from build-playwright-images.yml):
 *   docker run --ipc=host image xvfb-run --auto-servernum node /opt/bootstrap-model.mjs
 */
import { chromium } from 'playwright';

const profileDir = '/home/pwuser/.ai-model-profile/chrome-beta';
const maxAttempts = 5;

let context;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome-beta',
      headless: false,
      args: [
        '--no-first-run',
        '--disable-gpu',
        '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
        '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument',
      ],
      ignoreDefaultArgs: [
        '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints',
        '--disable-field-trial-config',
        '--disable-background-networking',
        '--disable-component-update',
      ],
      timeout: 60_000,
    });

    break;
  } catch (error) {
    if (attempt === maxAttempts) {
      throw error;
    }

    console.warn(
      `[WARN] Launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`,
    );
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

if (!context) {
  process.exit(1);
}

const page = context.pages()[0] || (await context.newPage());
await page.goto('chrome://gpu');

const availability = await page.evaluate(async () => {
  if (typeof LanguageModel === 'undefined') {
    return 'no-api';
  }

  return LanguageModel.availability();
});

console.log(`[INFO] LanguageModel.availability() = "${availability}"`);

if (availability === 'no-api' || availability === 'unavailable') {
  console.error('[ERROR] LanguageModel API not available');
  await context.close();
  process.exit(1);
}

if (availability === 'downloadable' || availability === 'downloading') {
  console.log('[INFO] Downloading model...');
  await page.evaluate(async () => {
    const session = await LanguageModel.create({
      monitor: (monitor) => {
        monitor.addEventListener('downloadprogress', (event) => {
          const pct = ((event.loaded / event.total) * 100).toFixed(1);
          console.log(`[INFO] Download: ${pct}%`);
        });
      },
    });
    session.destroy();
  });
  console.log('[INFO] Model downloaded');
}

// Warm up with a prompt to populate any inference caches
console.log('[INFO] Warming up model...');
const start = Date.now();
await page.evaluate(async () => {
  const session = await LanguageModel.create();
  await session.prompt('warmup');
  session.destroy();
});
const ms = Date.now() - start;
console.log(`[INFO] Warm-up complete (${(ms / 1000).toFixed(1)}s)`);

await context.close();
console.log('[OK] Bootstrap complete');
