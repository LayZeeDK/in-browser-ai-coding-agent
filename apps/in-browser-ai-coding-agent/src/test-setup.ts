/**
 * Vitest browser setup file — runs in the browser context before each test file.
 * With fileParallelism: false and a persistent browser context, the window
 * state persists across files so the warm-up only runs once per suite.
 */
export {};

const win = globalThis as typeof globalThis & {
  __modelWarmedUp?: boolean;
};

// Only poll for model availability in CI — locally, the model is typically
// ready immediately. Polling blocks test discovery in Vitest UI/watch mode.
// __CI__ is a compile-time constant injected by Vite's define option
// (import.meta.env.CI is not available in browser context).
declare const __CI__: boolean;
const pollTimeout = __CI__ ? 300_000 : 5_000;

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
    const session = await LanguageModel.create();
    await session.prompt('warmup');
    session.destroy();
  }

  win.__modelWarmedUp = true;
}
