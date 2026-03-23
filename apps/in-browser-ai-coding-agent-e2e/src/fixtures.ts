import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  allProfiles,
  getLaunchOptions,
  seedLocalState,
} from '@layzeedk/browser-profiles';

const profilesByName = Object.fromEntries(allProfiles.map((p) => [p.name, p]));

/**
 * Worker-scoped persistent browser context. Launches once per worker,
 * stays alive for all tests in that worker, then closes. This avoids
 * the Chrome ProcessSingleton issue where closing and relaunching a
 * persistent context fails on Windows because crashpad holds the
 * profile lockfile.
 *
 * With workers: 1, all tests share a single persistent context.
 */
export const test = base.extend<
  { persistentPage: Page },
  { persistentContext: BrowserContext }
>({
  // Worker-scoped: launches once, shared across all tests in the worker
  persistentContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const projectName = workerInfo.project.name;
      const profile = profilesByName[projectName];

      if (!profile) {
        throw new Error(
          `No browser profile configured for project "${projectName}". ` +
            `Available: ${allProfiles.map((p) => p.name).join(', ')}`,
        );
      }

      // Seed profile with flags before launching
      seedLocalState(profile);

      // Retry launch — Chrome's ProcessSingleton on Windows may reject
      // the launch if a previous chrome_crashpad_handler is still running
      let context!: BrowserContext;
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          context = await chromium.launchPersistentContext(
            profile.profileDir,
            getLaunchOptions(profile),
          );

          break;
        } catch (error) {
          if (attempt === maxAttempts) {
            throw error;
          }

          console.warn(
            `[fixtures] Launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`,
          );
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }

      // Warm up the model — same approach as browser-warmup.ts (unit tests).
      // No navigation to internal pages — just create a session and prompt.
      const warmupPage = context.pages()[0] || (await context.newPage());
      const start = Date.now();

      try {
        const availability = await warmupPage.evaluate(async () => {
          if (typeof LanguageModel === 'undefined') {
            return 'no-api';
          }

          return LanguageModel.availability();
        });
        console.log(
          `[fixtures] ${projectName}: LanguageModel.availability() = "${availability}"`,
        );

        if (availability !== 'no-api') {
          console.log(
            `[fixtures] ${projectName}: warming up model (first inference may take minutes)...`,
          );
          await warmupPage.evaluate(async () => {
            const session = await LanguageModel.create();
            await session.prompt('warmup');
            session.destroy();
          });
          const duration = ((Date.now() - start) / 1000).toFixed(1);
          console.log(
            `[fixtures] ${projectName}: warm-up complete (${duration}s)`,
          );
        }
      } catch (error) {
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        console.warn(
          `[fixtures] ${projectName}: warm-up failed after ${duration}s: ${error}`,
        );
      }

      await use(context);
      await context.close();
    },
    { scope: 'worker', timeout: 7_200_000 }, // 2h — matches CI step timeout
  ],

  // Test-scoped: provides a fresh page from the shared context
  persistentPage: async ({ persistentContext }, use) => {
    const page =
      persistentContext.pages()[0] || (await persistentContext.newPage());

    await use(page);
  },
});

export { expect } from '@playwright/test';
