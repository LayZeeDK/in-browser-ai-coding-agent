/**
 * Vitest globalSetup — seeds profile and runs diagnostics for Chrome Beta / Gemini Nano.
 * Used by the `test-chrome` target.
 */
import { allProfiles, setupInstances } from './global-setup.shared';

export const setup = ({ provide }) =>
  setupInstances(
    allProfiles.filter((p) => p.name === 'chrome-gemini-nano'),
    provide,
  );
