import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
// Relative import required — Vite processes config files without tsconfig path aliases
import {
  allProfiles,
  getLaunchOptions,
} from '../../libs/shared/browser-profiles/src/index';

/** Vitest browser instances built from the shared profile definitions. */
const allInstances = allProfiles.map((p) => ({
  browser: 'chromium' as const,
  name: p.name,
  provider: playwright({
    persistentContext: p.profileDir,
    launchOptions: getLaunchOptions(p),
  }),
}));

const appRoot = 'apps/in-browser-ai-coding-agent';

/**
 * Creates a Vitest config for on-device AI browser testing.
 *
 * @param options.instanceFilter - Instance name to select a single browser.
 *   When omitted, all instances run.
 * @param options.globalSetup - Path to the globalSetup file that seeds the
 *   profile and runs diagnostics. Defaults to the all-browsers setup.
 */
export function createVitestConfig(options?: {
  instanceFilter?: string;
  globalSetup?: string;
}) {
  const { instanceFilter, globalSetup = `${appRoot}/global-setup.ts` } =
    options ?? {};

  const instances = instanceFilter
    ? allInstances.filter((i) => i.name === instanceFilter)
    : allInstances;

  return defineConfig({
    test: {
      globalSetup: [globalSetup],
      // Warm up the model in the SAME browser process that runs tests.
      // globalSetup runs diagnostics in a separate browser (closed before
      // tests), so the actual inference warm-up must happen here.
      setupFiles: [`${appRoot}/browser-warmup.ts`],
      // Persistent context cannot be shared across parallel sessions
      fileParallelism: false,
      // No retries — each retry would re-launch the browser and re-warm the
      // model (12+ min cold-start on ARM64), exceeding CI step timeouts.
      retry: 0,
      // Surface flaky test annotations in GitHub Actions job summaries
      reporters: process.env['CI']
        ? ['default', 'github-actions']
        : ['default'],
      browser: {
        enabled: true,
        // LanguageModel API requires headed mode — headless Chrome exits
        // immediately. Vitest defaults to headless in CI and overrides
        // launchOptions.headless, so it must be set here.
        headless: false,
        instances,
        trace: process.env['CI'] ? 'on-first-retry' : 'off',
      },
    },
  });
}
