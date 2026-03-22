/**
 * Vitest setupFile — runs in the browser context (same process as tests).
 *
 * Warms up the on-device AI model by running a single inference before
 * tests start. Because this executes in the SAME browser that Vitest
 * launched via @vitest/browser-playwright, the ONNX Runtime compilation
 * state is preserved for all subsequent test prompts.
 *
 * Key design decisions (informed by the W3C Prompt API spec):
 * - Do NOT call session.destroy() — the spec says "destroying the session
 *   allows the user agent to unload the language model from memory." We
 *   want the model to stay loaded for tests.
 * - Do NOT abort the prompt on timeout — let the background inference
 *   continue while tests start. The ONNX compilation progresses even
 *   after we stop waiting.
 * - Use globalThis to persist state across setupFile re-imports (Vitest
 *   runs setupFiles per test file, not once globally).
 */

const WARMUP_TIMEOUT = 2_700_000; // 45 min — CI ARM64 needs 23-44 min

declare const globalThis: typeof window & {
  __vitest_warmup_started?: boolean;
};

async function warmUp() {
  // Skip if warm-up already started in a previous test file's setupFile run.
  // The session and its background prompt persist on globalThis.
  if (globalThis.__vitest_warmup_started) {
    return;
  }

  globalThis.__vitest_warmup_started = true;

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

    // Race the prompt against a timeout. On timeout, the prompt continues
    // running in the background — we just stop blocking test execution.
    // Do NOT destroy the session: the spec says destroy() signals the
    // browser to unload the model from memory.
    const completed = await Promise.race([
      session.prompt('warmup').then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), WARMUP_TIMEOUT),
      ),
    ]);

    const duration = ((Date.now() - start) / 1000).toFixed(1);

    if (completed) {
      console.log(`[browser-warmup] warm-up complete (${duration}s)`);
      session.destroy();
    } else {
      // Do NOT destroy — let the background inference continue while tests
      // start. The ONNX compilation will complete eventually, and the next
      // session.prompt() in a test will benefit from it.
      console.warn(
        `[browser-warmup] warm-up still running after ${duration}s, ` +
          'continuing to tests (inference will complete in background)',
      );
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
