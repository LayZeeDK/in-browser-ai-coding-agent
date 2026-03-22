/**
 * Vitest globalSetup — warms up Chrome Beta / Gemini Nano only.
 * Used by the `test-chrome` target.
 */
import { allInstances, warmUpInstances } from './global-setup.shared';

export const setup = () =>
  warmUpInstances(allInstances.filter((i) => i.name === 'chrome-gemini-nano'));
