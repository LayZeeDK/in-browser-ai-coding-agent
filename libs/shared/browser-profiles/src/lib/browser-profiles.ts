/**
 * Single source of truth for browser profile configuration.
 *
 * Used by:
 * - E2E fixtures (Playwright persistent context + warm-up)
 * - Vitest globalSetup (diagnostics)
 * - Vitest shared config (browser instances)
 * - Vitest setupFile (browser-warmup.ts)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { workspaceRoot } from '@nx/devkit';

/**
 * Playwright's exact --disable-features default arg. Must match exactly
 * for ignoreDefaultArgs to remove it (exact string comparison).
 */
export const PLAYWRIGHT_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

/** Same list without OptimizationHints — required for on-device AI. */
export const DISABLE_FEATURES_WITHOUT_OPT_HINTS =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

/**
 * Playwright defaults to remove for LanguageModel API support:
 * - OptimizationHints in --disable-features: disables the model system
 * - --disable-field-trial-config: disables model eligibility checks
 * - --disable-background-networking: prevents model registration
 * - --disable-component-update: prevents model component loading
 */
export const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES,
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-component-update',
];

export interface BrowserProfile {
  name: string;
  channel: string;
  profileDir: string;
  onDeviceInternalsUrl: string;
  args: string[];
  flags: string[];
}

export const allProfiles: BrowserProfile[] = [
  {
    name: 'chrome-gemini-nano',
    channel: 'chrome-beta',
    profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
    onDeviceInternalsUrl: 'chrome://on-device-internals',
    args: [
      '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
    flags: [
      'optimization-guide-on-device-model@1',
      'prompt-api-for-gemini-nano@1',
    ],
  },
  {
    name: 'edge-phi4-mini',
    channel: 'msedge-dev',
    profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
    onDeviceInternalsUrl: 'edge://on-device-internals',
    args: [
      '--enable-features=AIPromptAPI',
      '--disable-features=OnDeviceModelPerformanceParams',
      DISABLE_FEATURES_WITHOUT_OPT_HINTS,
    ],
    flags: [
      'edge-llm-prompt-api-for-phi-mini@1',
      'edge-llm-on-device-model-performance-param@3',
      'edge-llm-on-device-model-debug-logs@1',
    ],
  },
];

/**
 * Seed the profile's Local State with required chrome://flags entries
 * and enable internal debug pages. Creates the profile directory if
 * it doesn't exist (e.g., container with cache miss and no bootstrap).
 */
export function seedLocalState(profile: BrowserProfile) {
  const localStatePath = join(profile.profileDir, 'Local State');
  let state: Record<string, unknown> = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  // Seed chrome://flags entries
  if (!state['browser']) {
    state['browser'] = {};
  }

  const browser = state['browser'] as Record<string, unknown>;
  const existing = (browser['enabled_labs_experiments'] as string[]) || [];
  const existingNames = new Set(existing.map((f: string) => f.split('@')[0]));

  for (const flag of profile.flags) {
    const name = flag.split('@')[0];

    if (!existingNames.has(name)) {
      existing.push(flag);
    }
  }

  browser['enabled_labs_experiments'] = existing;

  // Enable internal debug pages
  state['internal_only_uis_enabled'] = true;

  mkdirSync(profile.profileDir, { recursive: true });
  writeFileSync(localStatePath, JSON.stringify(state, null, 2));
}
