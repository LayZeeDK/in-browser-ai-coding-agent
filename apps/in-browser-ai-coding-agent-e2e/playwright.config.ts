import { defineConfig } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const port = process.env['E2E_PORT'] || '4200';
const baseURL = process.env['BASE_URL'] || `http://localhost:${port}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const preset = nxE2EPreset(__filename, { testDir: './src' });

export default defineConfig({
  ...preset,
  // Persistent browser contexts cannot be shared across parallel workers
  workers: 1,
  // Chrome Beta's ProcessSingleton on Windows can cause the first
  // launchPersistentContext to fail — retry handles this gracefully
  retries: 2,
  reporter: [
    ...(
      (Array.isArray(preset.reporter)
        ? preset.reporter
        : []) as ReporterDescription[]
    ).map((r) =>
      // Disable auto-opening the HTML report — launching Chrome Stable
      // for the report interferes with Chrome Beta persistent contexts
      r[0] === 'html'
        ? (['html', { ...r[1], open: 'never' }] as ReporterDescription)
        : r,
    ),
    ...(process.env['CI'] ? [['github'] as ReporterDescription] : []),
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx nx run in-browser-ai-coding-agent:serve -- --port=${port}`,
    url: baseURL,
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chrome-gemini-nano',
      use: { channel: 'chrome-beta' },
    },
    {
      name: 'edge-phi4-mini',
      use: { channel: 'msedge-dev' },
    },
  ],
});
