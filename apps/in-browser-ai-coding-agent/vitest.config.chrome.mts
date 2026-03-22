import { createVitestConfig } from './vitest.shared.mts';

/** Chrome Beta with Gemini Nano only. */
export default createVitestConfig({
  instanceFilter: 'chrome-gemini-nano',
  globalSetup: 'apps/in-browser-ai-coding-agent/global-setup.chrome.ts',
});
