/**
 * Vitest setupFile — runs in the browser context (same process as tests).
 *
 * Warms up the on-device AI model by running a single inference before
 * tests start. Because this executes in the SAME browser that Vitest
 * launched via @vitest/browser-playwright, the ONNX Runtime compilation
 * state is preserved for all subsequent test prompts.
 *
 * Previously, warm-up ran in globalSetup which launched a SEPARATE
 * browser that was closed before tests started — wasting 20+ min of
 * ONNX compilation on every CI run.
 */

const WARMUP_TIMEOUT = 2_700_000; // 45 min — CI ARM64 needs 23-44 min

async function warmUp() {
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

    const response = await Promise.race([
      session
        .prompt('warmup')
        .then((text: string) => ({ ok: true as const, text })),
      new Promise<{ ok: false; text: string }>((resolve) =>
        setTimeout(
          () => resolve({ ok: false, text: 'timeout' }),
          WARMUP_TIMEOUT,
        ),
      ),
    ]);

    session.destroy();
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    if (response.ok) {
      console.log(`[browser-warmup] warm-up complete (${duration}s)`);
    } else {
      console.warn(`[browser-warmup] warm-up timed out after ${duration}s`);
    }
  } catch (error) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.warn(
      `[browser-warmup] warm-up failed after ${duration}s: ${error}`,
    );
  }
}

await warmUp();

export {};
