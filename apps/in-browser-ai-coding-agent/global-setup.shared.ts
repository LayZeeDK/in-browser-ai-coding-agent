/**
 * Shared setup logic for Vitest globalSetup files.
 *
 * Seeds browser profiles with chrome://flags and creates profile
 * directories if missing. No browser is launched here — the actual
 * inference warm-up happens in browser-warmup.ts (setupFile) which
 * runs in the same browser process as tests.
 */
// eslint-disable-next-line @nx/enforce-module-boundaries -- Vite module runner requires relative import
import {
  allProfiles,
  seedLocalState,
  type BrowserProfile,
} from '../../libs/shared/browser-profiles/src/index';

export { allProfiles };

/**
 * Seed profiles with required flags and create directories if missing.
 * Optionally provides shared context values to browser-side tests.
 */
export async function setupInstances(
  profiles: BrowserProfile[],
  provide?: (key: string, value: unknown) => void,
) {
  provide?.('CI', !!process.env['CI']);

  for (const profile of profiles) {
    seedLocalState(profile);
    console.log(
      `[global-setup] ${profile.name}: profile seeded at ${profile.profileDir}`,
    );
  }
}
