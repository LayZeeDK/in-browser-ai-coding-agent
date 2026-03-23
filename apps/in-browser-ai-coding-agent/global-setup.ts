/**
 * Vitest globalSetup — seeds profiles and runs diagnostics for all browsers.
 * Used by the default `test` target (both browsers).
 */
import { allProfiles, setupInstances } from './global-setup.shared';

export const setup = () => setupInstances(allProfiles);
