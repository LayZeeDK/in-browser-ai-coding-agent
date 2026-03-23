/**
 * Vitest globalSetup — seeds profile and runs diagnostics for Edge Dev / Phi-4 Mini.
 * Used by the `test-edge` target.
 */
import { allProfiles, setupInstances } from './global-setup.shared';

export const setup = ({ provide }) =>
  setupInstances(
    allProfiles.filter((p) => p.name === 'edge-phi4-mini'),
    provide,
  );
