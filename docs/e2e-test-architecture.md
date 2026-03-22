# E2E Test Architecture

**Last updated:** 2026-03-22

## Overview

The e2e tests verify that the application can perform on-device AI model inference via the LanguageModel API (formerly Prompt API) in real browsers. This is not a mock or simulation -- the tests launch actual Chrome Beta (Gemini Nano) and Edge Dev (Phi-4-mini) browsers, load real on-device language models, and execute real inference. The test suite confirms that:

1. The application renders and displays a model availability status (`available`, `downloading`, `downloadable`, or `unavailable`).
2. The model can be downloaded if not already cached.
3. A user can submit a prompt and receive a generated response from the on-device model.

Because the LanguageModel API is only available in branded Chromium channels (not Playwright's bundled Chromium), the tests must launch real installed browsers with specific feature flags and persistent user profiles that contain cached model files.

## Architecture at a Glance

```
playwright.config.ts
  |
  +-- projects: chrome-gemini-nano (chrome-beta), edge-phi4-mini (msedge-dev)
  |
  +-- workers: 1 (single persistent context)
  |
  +-- retries: 2 (ProcessSingleton flakiness)

fixtures.ts (worker-scoped persistent context)
  |
  +-- enableInternalDebugPages()   -- seeds Local State before launch
  |
  +-- retry loop (5 attempts)      -- handles ProcessSingleton lockfile
  |
  +-- launchPersistentContext()     -- branded browser with AI flags
  |
  +-- model warm-up                -- on-device-internals + LanguageModel.create() + session.prompt()
  |
  +-- persistentPage               -- test-scoped page from shared context

example.spec.ts   -- basic app tests (title, status element)
prompt.spec.ts    -- end-to-end prompt/response with GITHUB_STEP_SUMMARY logging
```

## Worker-Scoped Persistent Context

### The Problem: Chrome's ProcessSingleton

Chromium browsers enforce a single-process constraint per user data directory via a file called `SingletonLock` (Linux/macOS) or `lockfile` (Windows). When a browser closes, the `chrome_crashpad_handler` process -- Chrome's crash reporting daemon -- continues holding the lockfile. The surface error is "Browser window not found," but the root cause was traced to Chrome's ProcessSingleton mechanism: `chrome_crashpad_handler` outlives the main browser process and holds a `FILE_FLAG_DELETE_ON_CLOSE` handle on the profile lockfile.

On Windows this is especially severe because file locks are mandatory (kernel-enforced by the OS), not advisory as on POSIX systems. No other process can open the locked file until crashpad releases it. If a test framework closes a persistent context and immediately relaunches one against the same profile directory, the new launch fails with a ProcessSingleton rejection.

This is a known Playwright upstream issue tracked across multiple reports: [#2828](https://github.com/microsoft/playwright/issues/2828), [#6123](https://github.com/microsoft/playwright/issues/6123), [#6310](https://github.com/microsoft/playwright/issues/6310), [#12830](https://github.com/microsoft/playwright/issues/12830). Notably, Edge Dev does not exhibit this problem -- only Chrome channels are affected.

### Approaches Tried and Rejected

The current architecture was the result of a long debugging session. Three other approaches were tried and failed:

**1. `globalSetup` (commit `4f4326d`).** Model warm-up was moved to Playwright's `globalSetup`. This had a fatal flaw: `globalSetup` runs in a separate Node.js process, so it launches its own browser instance, performs warm-up, and then closes it. When the actual test workers later try to launch their own persistent contexts against the same profile directory, Chrome's ProcessSingleton rejects the second launch because crashpad from the globalSetup browser is still holding the lockfile. Even if the lockfile were released in time, this approach performs warm-up in a browser instance that is immediately discarded -- the test workers launch a completely new browser that needs to re-initialize the model pipeline anyway.

**2. Per-test fixture.** Using `launchPersistentContext()` per test would mean closing and relaunching the browser for each test, directly triggering the ProcessSingleton conflict described above.

**3. `setupFiles`.** Vitest's `setupFiles` option was considered, but `setupFiles` runs in the browser context (for browser-mode Vitest), not in Node.js. It has no access to Playwright's `chromium.launchPersistentContext()` API, making it unsuitable for browser lifecycle management.

### The Solution: Worker-Scoped Fixture

The fixture in `fixtures.ts` declares `persistentContext` with `{ scope: 'worker' }`. The key insight is that this approach avoids the close-and-relaunch cycle entirely:

1. **One launch per worker.** The browser launches once when the first test in the worker starts, and stays alive for all subsequent tests in that worker.
2. **No close-relaunch cycle.** Since the browser never closes between tests, there is no ProcessSingleton conflict. This is the critical difference from all other approaches.
3. **Combined with `workers: 1`.** The Playwright config sets `workers: 1`, so there is exactly one persistent context for the entire test run. All tests share it.

Tests receive a `persistentPage` fixture (test-scoped) that simply grabs the first page from the shared context or creates a new one.

### Retry Loop: 5 Attempts, 2-Second Delay

Even with a worker-scoped fixture, the very first launch can fail if a previous test run's crashpad process is still lingering (e.g., from a crashed run, or from the bootstrap script). The fixture wraps `launchPersistentContext()` in a retry loop:

```typescript
const maxAttempts = 5;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    context = await chromium.launchPersistentContext(profileDir, { ... });
    break;
  } catch (error) {
    if (attempt === maxAttempts) throw error;
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
```

The 2-second delay gives crashpad enough time to release the lockfile. Five attempts provides ample margin -- in practice, the second attempt almost always succeeds.

## Model Warm-Up Inside the Fixture

### Why Warm-Up Inside the Worker Fixture?

The warm-up must happen in the same browser instance that will run the tests. Since the worker-scoped fixture owns the only browser instance, warm-up happens there. This guarantees:

- The model is loaded into the same process that will serve inference requests during tests.
- No close-relaunch cycle between warm-up and test execution.
- The warm-up timeout (20 minutes via `timeout: 1_200_000`) is generous enough for first-time model downloads.

### The Warm-Up Flow

1. **Navigate to on-device-internals.** The fixture opens `chrome://on-device-internals` (or `edge://on-device-internals` for Edge Dev). This is Chrome's internal page for monitoring on-device model status.

2. **Trigger `LanguageModel.create()`.** This API call initiates model loading. For Chrome/Gemini Nano, it loads TFLite model files from the optimization guide model store. For Edge/Phi-4-mini, it loads ONNX model files. The `create()` call resolves when the model session is established, but this only means the model files are loaded into memory -- the inference pipeline is not yet fully initialized.

3. **Execute `session.prompt('warmup')`.** This is a critical step added in commit `7aa55ad`, and its history illustrates why it exists. The warm-up prompt was originally removed because it took 18 minutes on ARM. But then tests themselves started failing: `LanguageModel.create()` followed by `session.destroy()` only loads the model files into memory. The first actual inference call triggers additional pipeline initialization -- tokenizer setup, attention weight materialization, KV cache allocation -- which on ARM hardware takes 11+ minutes. Without the warm-up prompt, the first real test prompt incurred this cold-start penalty, causing timeout failures. The warm-up prompt was restored since the fixture already has a 20-minute timeout that accommodates it. By issuing a throwaway `'warmup'` prompt, the fixture forces the full inference pipeline to initialize before any test runs.

4. **Click Model Status tab.** After the warm-up prompt, the fixture clicks the "Model Status" tab on the on-device-internals page to verify the model state.

5. **Wait for "Foundational model state: Ready".** The fixture polls for up to 10 minutes (600 seconds) for this text to appear, checking every 30 seconds.

6. **Handle "Not Ready For Unknown Reason".** If the page shows "Not Ready For Unknown Reason" -- a transient state specific to Edge Dev -- the fixture reloads the page and re-clicks the Model Status tab. This was discovered through CI diagnostics logging: the state is entirely transient, and a page refresh after approximately 1 second resolves it. The "unknown reason" is a timing race in Edge's model loading pipeline, not a permanent failure condition.

7. **Graceful degradation.** If the Model Status tab is not found (possible in some container environments where the on-device-internals page renders differently), the fixture logs a warning and proceeds. Tests may still pass if the model was already loaded.

## `internal_only_uis_enabled`

### The Problem

The `chrome://on-device-internals` page is classified as an internal debugging page in Chromium. In normal browser installations, navigating to this URL shows a gate page with an "Enable" button. Clicking this button sets the `internal_only_uis_enabled` flag in the profile's `Local State` file and reloads the page to show the actual model status UI.

The original implementation attempted to automate this click. This failed in Docker containers: clicking the enable button opened a new tab in Chrome's default profile (not the Playwright persistent context), leaving a stale Chrome window that could not be controlled. The button click effectively escaped the Playwright context entirely, making the warm-up flow unreliable.

### The Solution

The `enableInternalDebugPages()` function in `fixtures.ts` writes `"internal_only_uis_enabled": true` directly into the profile's `Local State` JSON file before the browser launches:

```typescript
function enableInternalDebugPages(profileDir: string) {
  const localStatePath = join(profileDir, 'Local State');
  let state = {};
  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      /* ignore corrupt file */
    }
  }
  if (!state['internal_only_uis_enabled']) {
    state['internal_only_uis_enabled'] = true;
    writeFileSync(localStatePath, JSON.stringify(state, null, 2));
  }
}
```

This pre-seeding happens before `launchPersistentContext()`, so by the time the browser starts, it reads the flag and skips the gate page entirely. The same seeding also happens in the `bootstrap-ai-model.mjs` script used in CI for initial model download.

## All Tests Use `persistentPage`

### The Problem

The original `example.spec.ts` imported directly from `@playwright/test`:

```typescript
import { test, expect } from '@playwright/test';
```

When the prompt test was added using the custom `persistentPage` fixture, Playwright launched **two** Chrome instances simultaneously -- one managed instance (for example.spec.ts via `@playwright/test`) and one persistent instance (for prompt.spec.ts via `./fixtures`). Chrome's ProcessSingleton detected two chrome-beta processes contending for the same executable and rejected the persistent context launch. The managed instance and the persistent instance use different profile directories, but they share the same browser binary, and Chrome's singleton lock is per-binary on some platforms.

### The Solution

Commit `647f119` changed `example.spec.ts` to import from `./fixtures` instead of `@playwright/test`:

```typescript
import { test, expect } from './fixtures';
```

Now all tests -- both `example.spec.ts` and `prompt.spec.ts` -- use the `persistentPage` fixture. This ensures every test runs in the same persistent context that was warmed up with the model, and Playwright does not attempt to launch any additional managed browser instances.

## Playwright Config Simplification

### `launchOptions` Removed from Project Configs

Earlier versions of the config included `launchOptions` in each project's `use` block:

```typescript
// BEFORE (removed)
projects: [
  {
    name: 'chrome-gemini-nano',
    use: {
      channel: 'chrome-beta',
      launchOptions: {
        args: ['--enable-features=...'],
        ignoreDefaultArgs: [...],
      },
    },
  },
]
```

This was removed in commit `ddd92a4` because the fixture handles all launch arguments directly in `chromium.launchPersistentContext()`. Having `launchOptions` in the project config is not only redundant -- it can cause Playwright to pre-validate or pre-launch the browser channel during test setup, which interferes with the fixture's own launch logic and can trigger ProcessSingleton conflicts.

The current project configs are minimal:

```typescript
projects: [
  { name: 'chrome-gemini-nano', use: { channel: 'chrome-beta' } },
  { name: 'edge-phi4-mini', use: { channel: 'msedge-dev' } },
];
```

The `channel` value is read by the fixture via `workerInfo.project.use.channel` to select the correct browser executable.

### `workers: 1`

Persistent contexts are bound to a physical user data directory. Two workers trying to launch persistent contexts against the same profile directory would cause a ProcessSingleton conflict. Even if they used separate profiles, on-device model inference is resource-intensive (loading GBs of model weights into RAM, running ONNX/TFLite inference on CPU), so parallel execution would likely OOM or produce unreliable timings. Single-worker execution serializes all tests, which is the only safe configuration.

### `retries: 2` Always (Not Just CI)

Chrome's ProcessSingleton issue happens locally too, not just in CI. An earlier version only enabled retries on CI (`retries: process.env.CI ? 2 : 0`), but local developers hit the same first-launch failures. The mechanism is: the first worker creation fails because crashpad from a previous run is still holding the lockfile, the Playwright retry creates a new worker where the launch succeeds because crashpad has had time to exit. Making retries unconditional (`retries: 2`) ensures consistent behavior everywhere.

### `open: 'never'` for HTML Report

Playwright's default HTML reporter opens the report in a browser after the test run. This was disabled because it launches Chrome Stable to display the report. Chrome Stable's `chrome.exe` processes confused Chrome Beta's ProcessSingleton mechanism even though they are different channels -- they share the same executable name (`chrome.exe`), and the ProcessSingleton detection on Windows keys on the executable name in some configurations, not the channel or profile directory.

The Nx preset may include an HTML reporter by default, so the config intercepts it and injects `open: 'never'`:

```typescript
reporter: [...(Array.isArray(preset.reporter) ? preset.reporter : []).map((r) => (r[0] === 'html' ? ['html', { ...r[1], open: 'never' }] : r)), ...(process.env['CI'] ? [['github']] : [])];
```

A GitHub reporter is also added in CI for inline test failure annotations on PRs.

## Browser Profiles

### Profile Locations

Two sets of profile directories exist:

| Directory                                                              | Used By                                 | Git-tracked                          |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------ |
| `.playwright-profiles/chrome-beta/`                                    | CI workflow, local development          | No (`.gitignore`d)                   |
| `.playwright-profiles/msedge-dev/`                                     | CI workflow, local development          | No (`.gitignore`d)                   |
| `apps/in-browser-ai-coding-agent-e2e/.playwright-profiles/msedge-dev/` | Edge Dev persistent context (app-local) | No (nested under `.gitignore`d root) |

The fixture resolves profile paths relative to `workspaceRoot`:

```typescript
const browserProfiles = {
  'chrome-gemini-nano': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/chrome-beta'),
    args: [
      /* Chrome-specific flags */
    ],
  },
  'edge-phi4-mini': {
    profileDir: resolve(workspaceRoot, '.playwright-profiles/msedge-dev'),
    args: [
      /* Edge-specific flags */
    ],
  },
};
```

### What Profiles Contain

A browser profile directory is essentially a Chrome/Edge user data directory. For on-device AI testing, the critical contents are:

| Content                        | Example Path                                                    | Purpose                                                                                                 |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Model weights                  | `OptGuideOnDeviceModel/2025.8.8.1141/weights.bin`               | The actual neural network weights (Gemini Nano)                                                         |
| Model config                   | `OptGuideOnDeviceModel/.../on_device_model_execution_config.pb` | Protobuf config for model execution parameters                                                          |
| Optimization guide model store | `optimization_guide_model_store/49/.../model.tflite`            | TFLite models used by Chrome's optimization guide                                                       |
| Local State                    | `Local State`                                                   | JSON file with `internal_only_uis_enabled` flag and `browser.enabled_labs_experiments` (chrome://flags) |
| Component cache                | `component_crx_cache/`                                          | Cached browser component downloads                                                                      |
| Inference cache                | `adapter_cache.bin` (Edge)                                      | Pre-compiled inference pipeline cache                                                                   |
| ONNX Runtime DLLs              | (Edge-specific)                                                 | Edge's on-device model runtime                                                                          |

### Bootstrapping Profiles

In CI, profiles are bootstrapped via the `scripts/bootstrap-ai-model.mjs` script when the cache is cold:

```yaml
- name: Bootstrap AI model
  if: steps.model-cache.outputs.cache-hit != 'true'
  run: node scripts/bootstrap-ai-model.mjs --browser ${{ matrix.browser }} --profile .playwright-profiles/${{ matrix.browser }} --timeout 600000
```

The bootstrap script:

1. Seeds `Local State` with the correct chrome://flags entries and `internal_only_uis_enabled`.
2. Launches a persistent context with AI feature flags.
3. Calls `LanguageModel.availability()` to check the current state.
4. If `downloadable` or `downloading`, calls `LanguageModel.create()` with a download progress monitor.
5. Closes the browser once the model is downloaded.
6. The resulting profile directory (containing model files) is cached via `actions/cache/save`.

On subsequent CI runs, the cache is restored and the bootstrap step is skipped.

For local development, the developer runs the tests once (which triggers the fixture's warm-up flow), and the profile directory persists on disk across runs.

## Playwright Default Args and LanguageModel API

A key complexity in this architecture is that Playwright injects default browser arguments that disable functionality required by the LanguageModel API. The fixture must selectively remove these defaults:

| Playwright Default                        | Why It Breaks LanguageModel API                                                    | Handling                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `--disable-features=...OptimizationHints` | Disables the Optimization Guide that manages on-device model downloads and loading | Replaced with the same list minus `OptimizationHints` |
| `--disable-field-trial-config`            | Disables Chrome's field trial system that gates model eligibility                  | Removed via `ignoreDefaultArgs`                       |
| `--disable-background-networking`         | Prevents variations seed fetch and model component update checks                   | Removed via `ignoreDefaultArgs`                       |
| `--disable-component-update`              | Prevents the model component from being registered with the component updater      | Removed via `ignoreDefaultArgs`                       |

The `ignoreDefaultArgs` array must contain the exact string that Playwright uses for `--disable-features`. If the string does not match byte-for-byte, Playwright will not remove it, and the LanguageModel API will be silently disabled. This is why the fixture defines `PLAYWRIGHT_DISABLE_FEATURES` as a constant copied from Playwright's source.

## Prompt Response Logging

### GITHUB_STEP_SUMMARY Integration

`prompt.spec.ts` writes the AI model's response to the GitHub Actions job summary when running in CI:

```typescript
if (process.env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `### E2E Prompt Response\n\n**Prompt:** Hello, AI!\n\n**Response:** ${trimmed}\n\n`);
}
```

This serves two purposes:

1. **Visibility.** The actual model response is visible on the GitHub Actions run summary page, making it easy to verify that the model is producing coherent output without digging through test logs.
2. **Regression tracking.** If a model update changes response characteristics (length, coherence, language), the job summary provides a historical record.

The CI workflow also extracts unit test prompt responses from Vitest output using regex and writes them to the same summary, providing a unified view of all AI responses from the test run.

### Console Logging

Both locally and in CI, the test logs the prompt/response pair to console:

```typescript
console.log(`[e2e] Prompt: "Hello, AI!" -> Response: "${trimmed}"`);
```

This is invaluable for debugging: when a test fails with a timeout or unexpected error, the log shows whether the model produced any output at all.

## Known Limitations

### Chrome First-Launch Flakiness on Windows (ProcessSingleton/Crashpad)

**Symptom:** The first `launchPersistentContext()` call fails with "Browser window not found."

**Root cause:** Chrome's `chrome_crashpad_handler.exe` outlives the main browser process and holds a `FILE_FLAG_DELETE_ON_CLOSE` handle on the profile lockfile. On Windows, file locks are mandatory (kernel-enforced), so no other process can open the lock file until crashpad exits. This is tracked in Playwright issues [#2828](https://github.com/microsoft/playwright/issues/2828), [#6123](https://github.com/microsoft/playwright/issues/6123), [#6310](https://github.com/microsoft/playwright/issues/6310), [#12830](https://github.com/microsoft/playwright/issues/12830).

**Browser-specific:** Only Chrome channels are affected. Edge Dev does not exhibit this behavior.

**Mitigation:** Two layers of defense:

1. The retry loop in the fixture (5 attempts, 2-second delay) handles the common case where crashpad exits within a few seconds.
2. Playwright's `retries: 2` provides a second safety net: if the first worker creation fails entirely, the retry creates a new worker where the launch succeeds because crashpad has had time to exit.

**When it still fails:** If a previous browser process crashed hard (e.g., OOM during model loading), crashpad may hold the lock for longer. Manually killing `chrome_crashpad_handler.exe` or waiting for it to time out (usually under 30 seconds) resolves the issue.

### Edge "Not Ready For Unknown Reason" Transient State

**Symptom:** The `edge://on-device-internals` page shows "Foundational model state: Not Ready For Unknown Reason" even though the model files are present.

**Root cause:** Edge Dev's on-device model system enters a transient state during model loading where it reports "Not Ready For Unknown Reason." Discovered through CI diagnostics logging, this is a timing race in Edge's model loading pipeline, not a permanent failure.

**Mitigation:** The fixture detects this state and reloads the page. A page refresh after approximately 1 second resolves it -- the page re-queries the model state and finds it ready.

**Remaining risk:** If the model files are genuinely corrupt or missing, this reload loop will waste the full 10-minute timeout before failing. There is currently no way to distinguish a transient "Not Ready" from a permanent one without waiting.

### No Headless Mode

The LanguageModel API requires GPU or CPU inference pipelines that are not available in headless mode. All tests run in headed mode (`headless: false`). In CI, this requires `xvfb-run` on Linux containers to provide a virtual display:

```yaml
xvfb: 'xvfb-run --auto-servernum'
```

On Windows CI runners (used for Edge Dev), headed mode works natively without a virtual display.

### Single-Threaded Test Execution

`workers: 1` means test execution is serial. This is a fundamental constraint: persistent contexts cannot share a profile directory, and on-device inference is too resource-intensive for parallelism. The tradeoff is slower test suites in exchange for reliability.

### Model Download and First-Inference Time

First-run model downloads can take 5-10 minutes depending on network speed and model size (Gemini Nano ~1.5 GB, Phi-4-mini varies). Beyond download, the first inference call triggers pipeline initialization (tokenizer, attention weights, KV cache) which takes 11+ minutes on ARM hardware. The CI workflow mitigates download time with `actions/cache` to persist the profile directory. The fixture's 20-minute timeout (`timeout: 1_200_000`) accommodates both download and first-inference initialization.

### Browser Channel Availability

The tests require specific browser channels (`chrome-beta`, `msedge-dev`) to be installed. These are not bundled by Playwright -- they must be installed separately via `npx playwright install chrome-beta --with-deps`. The CI Dockerfile pre-installs these channels in dedicated container images.

## CI Matrix

The CI workflow runs e2e tests in two configurations:

| Project              | Browser     | Runner           | Environment                                                     |
| -------------------- | ----------- | ---------------- | --------------------------------------------------------------- |
| `chrome-gemini-nano` | Chrome Beta | `ubuntu-latest`  | Docker container (ghcr.io image with Chrome Beta pre-installed) |
| `edge-phi4-mini`     | Edge Dev    | `windows-11-arm` | Native Windows (ARM64, real hardware)                           |

Chrome Beta runs in a Linux container because Gemini Nano's CPU inference works on x86_64 Linux. Edge Dev runs on Windows ARM because Microsoft's on-device model infrastructure is Windows-only and the model files/DLLs are ARM-native.

The profile cache key includes the runner and browser channel to prevent cross-contamination:

```yaml
cache-key: chrome-beta-cpu-container-v2   # Linux container
cache-key: msedge-dev-ai-model-windows11-arm-v2  # Windows ARM
```

## Decision Log

A summary of every architectural decision and the problem that motivated it:

| Decision                                     | Problem                                                                                                    | Commit    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| Worker-scoped persistent context             | globalSetup closes browser, relaunches in worker -- ProcessSingleton rejects second launch                 | `f9c6afe` |
| Retry loop (5 attempts, 2s delay)            | `chrome_crashpad_handler` holds `FILE_FLAG_DELETE_ON_CLOSE` lockfile handle after browser close            | `bc9159e` |
| `session.prompt('warmup')` in fixture        | `create()`+`destroy()` only loads files; first inference (tokenizer, KV cache) takes 11+ min on ARM        | `7aa55ad` |
| `internal_only_uis_enabled` pre-seeded       | Enable button in Docker opened new tab in default profile, not Playwright context                          | `0905c27` |
| All tests import from `./fixtures`           | `@playwright/test` import launched managed Chrome alongside persistent Chrome -- ProcessSingleton conflict | `647f119` |
| `launchOptions` removed from project configs | Redundant with fixture; Playwright pre-validates/pre-launches browser, causing ProcessSingleton races      | `ddd92a4` |
| `workers: 1`                                 | Persistent contexts cannot share a profile directory; inference too resource-intensive for parallelism     | `2e0095f` |
| `retries: 2` unconditionally                 | ProcessSingleton flakiness is not CI-specific; first worker fails, retry worker succeeds                   | `ddd92a4` |
| HTML report `open: 'never'`                  | Chrome Stable's `chrome.exe` confused Chrome Beta's ProcessSingleton (same executable name)                | `0185ae8` |
| "Not Ready" refresh loop                     | Edge Dev transient state resolves with page reload after ~1 second                                         | `72a26f0` |
