/**
 * Vitest setupFile — runs in the browser context (same process as tests).
 *
 * Warms up the on-device AI model by running a single inference before
 * tests start. Because this executes in the SAME browser that Vitest
 * launched via @vitest/browser-playwright, the ONNX Runtime compilation
 * state is preserved for all subsequent test prompts.
 *
 * No timeout — the CI step timeout (60 min) is the backstop. On CI
 * ARM64, first inference takes 23-48 min. Once complete, all test
 * prompts respond in 1-3s.
 *
 * Uses globalThis to run once across all test files (Vitest setupFiles
 * run per file, not once globally).
 */

declare const globalThis: typeof window & {
  __vitest_warmup_done?: boolean;
};

async function warmUp() {
  if (globalThis.__vitest_warmup_done) {
    return;
  }

  globalThis.__vitest_warmup_done = true;

  if (typeof LanguageModel === 'undefined') {
    console.log('[browser-warmup] LanguageModel API not available, skipping');

    return;
  }

  const availability = await LanguageModel.availability();
  console.log(
    `[browser-warmup] LanguageModel.availability() = "${availability}"`,
  );

  if (availability !== 'available' && availability !== 'downloading') {
    console.log(
      `[browser-warmup] model not ready (${availability}), skipping warm-up`,
    );

    return;
  }

  console.log(
    '[browser-warmup] warming up model (first inference may take minutes)...',
  );
  const start = Date.now();

  try {
    const session = await LanguageModel.create();
    await session.prompt('warmup');
    session.destroy();

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[browser-warmup] warm-up complete (${duration}s)`);
  } catch (error) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.warn(
      `[browser-warmup] warm-up failed after ${duration}s: ${error}`,
    );
  }
}

await warmUp();

export {};
