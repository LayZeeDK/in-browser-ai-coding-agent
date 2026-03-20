import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    browser: {
      instances: [
        {
          browser: 'chromium',
          name: 'chrome-gemini-nano',
          // Google Chrome Canary — Gemini Nano
          provider: playwright({
            launchOptions: {
              channel: 'chrome-canary',
              args: [
                '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
              ],
            },
          }),
        },
        {
          browser: 'chromium',
          name: 'edge-phi4-mini',
          // Microsoft Edge Dev — Phi-4-mini-instruct
          provider: playwright({
            launchOptions: {
              channel: 'msedge-dev',
              args: ['--enable-features=PromptAPIForPhiMini'],
            },
          }),
        },
      ],
    },
  },
});
