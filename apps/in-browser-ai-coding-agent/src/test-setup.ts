/**
 * Vitest browser setup file — runs in the browser context before each test file.
 * With fileParallelism: false and a persistent browser context, the window
 * state persists across files so the warm-up only runs once per suite.
 */
export {};

const win = globalThis as typeof globalThis & {
  __modelWarmedUp?: boolean;
};

// Poll timeout for model availability. Keep short to avoid blocking
// Vitest UI/watch mode. Tests use retries to handle slow cold starts.
const pollTimeout = 60_000;

if (!win.__modelWarmedUp && typeof LanguageModel !== 'undefined') {
  // Poll until the model is available — it may still be registering
  // when the setup file runs (especially on slower CI runners)
  const deadline = Date.now() + pollTimeout;
  let status = await LanguageModel.availability();

  while (status !== 'available' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    status = await LanguageModel.availability();
  }

  if (status === 'available') {
    // Only create a session to trigger model loading — skip the actual
    // prompt since it can take 18+ minutes on slow runners (Phi-4 Mini
    // on ARM). Tests use retries to handle cold-start: the first attempt
    // warms the model, the retry succeeds quickly.
    const session = await LanguageModel.create();
    session.destroy();
  }

  win.__modelWarmedUp = true;
}
