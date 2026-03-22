/**
 * Vitest globalSetup — warms up Edge Dev / Phi-4 Mini only.
 * Used by the `test-edge` target.
 */
import { allInstances, warmUpInstances } from './global-setup.shared';

export const setup = () =>
  warmUpInstances(allInstances.filter((i) => i.name === 'edge-phi4-mini'));
