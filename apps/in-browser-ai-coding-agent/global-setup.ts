/**
 * Vitest globalSetup — warms up all on-device AI models.
 * Used by the default `test` target (both browsers).
 */
import { allInstances, warmUpInstances } from './global-setup.shared';

export const setup = () => warmUpInstances(allInstances);
