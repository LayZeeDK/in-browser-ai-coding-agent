import { createVitestConfig } from './vitest.shared.mts';

/** Edge Dev with Phi-4 Mini only. */
export default createVitestConfig({
  instanceFilter: 'edge-phi4-mini',
  globalSetup: 'apps/in-browser-ai-coding-agent/global-setup.edge.ts',
});
