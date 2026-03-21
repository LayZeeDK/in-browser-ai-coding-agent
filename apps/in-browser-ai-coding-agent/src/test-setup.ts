/**
 * Vitest browser setup file — runs in the browser context before each test file.
 * With fileParallelism: false and a persistent browser context, the window
 * state persists across files so the warm-up only runs once per suite.
 */
export {};

const win = globalThis as typeof globalThis & {
  __modelWarmedUp?: boolean;
};

if (!win.__modelWarmedUp && typeof LanguageModel !== 'undefined') {
  const status = await LanguageModel.availability();

  if (status === 'available') {
    const session = await LanguageModel.create();
    await session.prompt('warmup');
    session.destroy();
  }

  win.__modelWarmedUp = true;
}
