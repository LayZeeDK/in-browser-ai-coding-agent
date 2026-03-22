# Codebase Concerns

**Analysis Date:** 2026-03-22

---

## Executive Summary

This project operates in an extremely constrained environment: on-device AI model inference with multi-gigabyte models, 11+ minute cold-start times on ARM, and pre-release browser APIs with transient failure modes. The infrastructure is fundamentally sound and well-architected for these constraints, but the core concerns are fragility from external dependencies (Chrome/Edge behavior changes), complex interdependencies between multiple warm-up sequences, and platform-specific brittleness that cannot be readily tested locally.

---

## Tech Debt

### 1. Hardcoded Playwright Feature List Duplication

**Area/Component:** Playwright default args handling
**Files:**

- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 15-28)
- `apps/in-browser-ai-coding-agent/global-setup.ts` (lines 15-19)
- `vitest.config.mts` (equivalent definitions)

**Issue:** The `PLAYWRIGHT_DISABLE_FEATURES` constant must match Playwright's internal default features exactly, byte-for-byte. This string is copied manually across three locations:

```typescript
// fixtures.ts
const PLAYWRIGHT_DISABLE_FEATURES = '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,...,OptimizationHints';

// global-setup.ts (duplicate)
const PLAYWRIGHT_DISABLE_FEATURES = '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,...,OptimizationHints';
```

**Impact:** When Playwright updates its internal default feature list (new minor/patch release), the hardcoded string becomes stale. The `ignoreDefaultArgs` mechanism uses exact string comparison — if the string doesn't match, Playwright won't remove it, and `OptimizationHints` remains disabled, silently breaking the LanguageModel API. This would cause tests to fail with confusing "unavailable" or timeout errors with no hint that the cause is a stale feature list.

**Fragility:** Playwright version bumps are the highest-frequency dependency updates. This constant needs updating on every Playwright release that changes its default feature list. There is no automated check — the breakage would only surface when tests fail in CI.

**Fix approach:**

- Extract the constant to a shared module: `libs/testing-utils/browser-config.ts` or similar
- Add a Vitest test that verifies the constant matches Playwright's actual defaults by launching a test browser and inspecting the real flags
- Or: Detect the string at runtime by inspecting Playwright's exports (if possible)

---

### 2. Profile Cache Key Versioning

**Area/Component:** CI model cache invalidation
**Files:** `.github/workflows/ci.yml` (lines 73, 79)

**Issue:** The model profile cache key includes a hardcoded version suffix: `chrome-beta-cpu-container-v2` and `msedge-dev-ai-model-windows11-arm-v2`. When the profile structure changes (e.g., new ONNX Runtime DLL layout, changed inference cache format), this version must be manually incremented. There is no automation or documentation of what changes warrant a version bump.

**Impact:** If the cache structure becomes incompatible (e.g., a new Edge Dev version requires a different ONNX Runtime layout) and the version suffix is not incremented, restored caches will be stale and tests will fail or redownload the model on every run. The first failure gives no hint that the cache is the culprit — it only appears as a timeout during bootstrap or warm-up.

**Example:** If Edge releases a version that changes the ONNX Runtime component layout, the current `v2` key would still be used, causing cache hits with incompatible files.

**Fix approach:**

- Document decision criteria for bumping version (e.g., "bump on Edge/Chrome major version changes, ONNX Runtime changes, profile directory structure changes")
- Add a CI check that validates a sample restored cache by verifying key file presence and structure
- Consider including browser version or ONNX Runtime version in the cache key automatically

---

### 3. Three-Way Duplication of Model Warm-Up Logic

**Area/Component:** Model warm-up sequences
**Files:**

- `scripts/bootstrap-ai-model.mjs` (bootstrap during cache miss)
- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (e2e fixture warm-up)
- `apps/in-browser-ai-coding-agent/global-setup.ts` (Vitest global setup warm-up)

**Issue:** The same warm-up sequence is implemented three times:

1. Navigate to `chrome://on-device-internals`
2. Call `LanguageModel.create()`
3. Call `session.prompt('warmup')` (only in fixtures and global-setup)
4. Click "Model Status" tab
5. Wait for "Foundational model state: Ready"
6. Handle "Not Ready For Unknown Reason" transient state with reload

The bootstrap script is in Node.js/MJS, the fixture is TypeScript/Playwright, and the global setup is TypeScript/Playwright but in a different file. Each has slight variations in error handling, timeout values, and logging.

**Impact:**

- Bug fixes in one location don't automatically propagate to others
- If one implementation changes behavior (e.g., timeout increased), the others become inconsistent
- The "Not Ready For Unknown Reason" transient-state handling might not be present in all three
- Maintenance cost: a single improvement requires three edits

**Example:** The bootstrap script does NOT run `session.prompt('warmup')` — it only calls `LanguageModel.create()`. This means the bootstrap-only cache (model files downloaded but inference pipeline not initialized) is faster but incomplete. The e2e fixture must then warm up again, which the e2e docs identify as intentional (commit `7aa55ad`), but the fragmentation means understanding this requires reading three different files.

**Fix approach:**

- Extract shared warm-up logic into a reusable utility module in a shared lib
- Playwright offers a way to share utilities across fixtures and tests; move the core logic there
- Create a single source of truth for warm-up timing, retry logic, and transient-state handling

---

## Known Bugs

### 1. Chrome ProcessSingleton Flakiness on Windows

**Bug description:** Chrome's profile locking mechanism causes first-time persistent context launches to fail on Windows, especially when a prior test run crashed or when launching immediately after previous browser shutdown.

**Symptoms:**

- E2E test run fails with `Protocol error (Browser.getWindowForTarget): Browser window not found`
- Playwright error: `Chrome profile is in use by another process`
- Exit code 0 from Chrome indicating ProcessSingleton rejection, not a crash

**Files:**

- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 101-127: retry loop)
- `apps/in-browser-ai-coding-agent/global-setup.ts` (lines 102-128: retry loop)

**Trigger:**

1. Run e2e tests that use a persistent Chrome context
2. Test run completes (either success or hard failure)
3. `context.close()` is called, but `chrome_crashpad_handler` child process outlives the main browser process
4. The crashpad handler holds a `FILE_FLAG_DELETE_ON_CLOSE` file handle on the profile lockfile
5. Immediately launching another persistent context fails because `CreateFile(CREATE_NEW)` returns `ERROR_ACCESS_DENIED` on the lockfile in "delete pending" state
6. Chrome interprets this as "profile in use" and exits with code 0

**Workaround:** Two layers of mitigation are already implemented:

1. **5-attempt retry loop with 2s delay** in both the fixture and global-setup (gives crashpad up to 10 seconds to release the lock)
2. **`retries: 2`** in Playwright config (if the first worker creation fails, the retry creates a new worker where the launch succeeds)

This workaround is reliable in practice (the second attempt usually succeeds), but it is a workaround for a platform issue that should not require such complexity.

**Browser-specific:** Only Chrome channels exhibit this. Edge Dev does not have this issue.

**Tracking:** Playwright issues [#2828](https://github.com/microsoft/playwright/issues/2828), [#6123](https://github.com/microsoft/playwright/issues/6123), [#6310](https://github.com/microsoft/playwright/issues/6310), [#12830](https://github.com/microsoft/playwright/issues/12830)

**Remaining risk:** If a browser process crashes hard (e.g., OOM during model loading), `chrome_crashpad_handler` may hold the lock for longer than 10 seconds. The 45-minute CI step timeout provides a safety net, but the first test run might still fail and retry.

---

### 2. Edge "Not Ready For Unknown Reason" Transient State

**Bug description:** Edge Dev's on-device model system intermittently reports the model as "Not Ready For Unknown Reason" even when model files are present and the API is functional.

**Symptoms:** The `edge://on-device-internals` page displays "Foundational model state: Not Ready For Unknown Reason" instead of "Ready", blocking the warm-up flow from completing.

**Files:**

- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 202-212: refresh handling)
- `apps/in-browser-ai-coding-agent/global-setup.ts` (lines 185-193: refresh handling)

**Trigger:** Occurs more frequently after abrupt browser shutdowns (e.g., OOM during model loading, CI runner timeout).

**Workaround:** The warm-up code detects the text "Not Ready For Unknown Reason" and reloads the page, after which the model typically reports "Ready":

```typescript
const notReady = warmupPage.getByText(/Not Ready For Unknown Reason/i);
if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
  console.log(`[fixtures] refreshing...`);
  await warmupPage.reload();
  await modelStatusTab.click();
}
```

**Root cause:** Unknown. Likely a race condition in Edge's model registration system where the component is registered but the LLM service has not yet acknowledged it.

**Remaining risk:** If the model files are genuinely corrupt or missing (not a transient state), the refresh loop will consume the full 10-minute deadline before failing. There is currently no way to distinguish a transient "Not Ready" from a permanent failure condition without waiting.

---

## Security Considerations

### 1. `bypassSecurityTrustHtml` in ModelStatusComponent

**Area:** Markdown rendering
**Files:** `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (lines 110-111)

**Risk:** The component uses Angular's `DomSanitizer.bypassSecurityTrustHtml()` to render Markdown-converted HTML:

```typescript
return this.sanitizer.bypassSecurityTrustHtml(marked.parse(md, { async: false }) as string);
```

**Current mitigation:** The HTML comes from a local on-device model (Gemini Nano or Phi-4 Mini), not user input or a remote server. The content never traverses a network — it is generated entirely within the browser process. XSS risk is minimal because there is no untrusted input path.

**Remaining consideration:** If the `marked` library has a vulnerability in its Markdown parsing (e.g., a bypass of its own sanitization), the bypassSecurityTrustHtml would amplify it. Similarly, if the LanguageModel API is ever exposed to user-provided system prompts or fine-tuning data that could influence output, XSS becomes possible.

**Recommendation:** This is acceptable given the current architecture, but if future changes allow user-provided prompts to influence the model's output, consider using Angular's built-in sanitizer or a dedicated XSS library instead of full HTML bypass.

---

## Performance Bottlenecks

### 1. Phi-4 Mini Cold-Start (11+ minutes on ARM64)

**Problem:** First `session.prompt()` call after a fresh profile launch requires ONNX Runtime to:

- Compile the execution graph for the target hardware
- Load ~4 GB of model weights into memory
- Initialize the tokenizer
- Allocate KV cache

This takes **11+ minutes** on `windows-11-arm` CI runners and is the single largest bottleneck in the test pipeline.

**Files:**

- `apps/in-browser-ai-coding-agent/global-setup.ts` (lines 141-151: warm-up prompt with 600s timeout)
- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 148-154: warm-up prompt with 20-minute timeout)
- Unit test specs: 300-second per-test timeouts to accommodate cold-start bleed-through

**Cause:** The ONNX Runtime inference engine (used by Edge) has substantial initialization overhead on first call. The adapter and encoder cache files (`adapter_cache.bin`, `encoder_cache.bin`) are generated during first inference and make subsequent inferences fast.

**Current mitigation:**

- The rolling model profile cache preserves inference artifacts across CI runs
- E2E tests run before unit tests, so the e2e warm-up eliminates cold-start for unit tests
- Global setup runs `session.prompt('warmup')` to front-load the cost before tests start
- Generous timeouts: 600s global setup deadline, 300s per-test, 20-minute fixture timeout

**Remaining risk:**

- On exceptionally slow runners or during network contention, the 600-second global setup timeout might be exceeded
- If the warm-up is skipped (e.g., due to ProcessSingleton lock contention), the first real test inference absorbs the full 11+ minute cost and may timeout
- Bootstrap-only cache (cache hit during bootstrap but cache miss during test) could cause unit tests to timeout if warm-up was incomplete

---

### 2. Docker Container Layer Caching Complexity

**Problem:** The CI builds Docker container images for Chrome Beta on every push to `main` (when dependencies change). The build uses multi-stage Docker caching with `type=gha`, but layer invalidation is complex and not well-documented.

**Files:**

- `.github/docker/Dockerfile` (multi-stage build)
- `.github/workflows/build-playwright-images.yml` (build triggers and caching)

**Impact:** Cache misses result in 30-60 second container build time added to every CI run. While not critical, it adds latency.

**Complexity:** The build has multiple touch points:

- Base stage caches depend on `.node-version`, `package-lock.json`, `.github/docker/Dockerfile`
- Chrome Beta stage rebuilds when any of the above change
- GHA cache is scoped per browser to avoid collisions

**Recommendation:** This is a known complexity documented in the CI architecture. Monitor cache hit rates in build workflow runs; if hit rates drop below 80%, investigate whether trigger conditions need adjustment.

---

## Fragile Areas

### 1. E2E Fixture Warm-Up Interdependency

**Component:** E2E test fixture (`apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`)
**Files:** `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (entire file)

**Why fragile:** The worker-scoped persistent context is a single point of failure for all e2e tests. The fixture must:

1. Launch a persistent Chrome context (5-attempt retry loop for ProcessSingleton)
2. Navigate to `chrome://on-device-internals`
3. Trigger model loading and first inference (11+ minutes)
4. Detect the "Ready" state on the internals page
5. Handle transient "Not Ready For Unknown Reason" state
6. Close the context cleanly (required for Vitest cleanup)

If any of these steps fails, all e2e tests fail because they share the context. A timeout in step 3 (warm-up inference) causes all subsequent tests to fail with no indication that the warm-up was incomplete.

**Safe modification:**

- Test changes should not modify the fixture launch arguments (`args`, `ignoreDefaultArgs`) without understanding the LanguageModel API requirements
- The `internal_only_uis_enabled` flag must be seeded before launch; if this step is removed, navigating to `chrome://on-device-internals` will show a gate page, breaking warm-up
- The "Not Ready For Unknown Reason" detection and page reload logic is critical; removing it causes intermittent CI failures on Edge
- Changes to timeouts should account for Phi-4 Mini's 11+ minute worst-case on ARM runners

**Test coverage:** The fixture is not directly tested. Its correctness is verified implicitly by e2e test success. If the fixture is modified and a regression is introduced, the first signal is e2e test timeout or failure.

**Recommendation:** Add a dedicated fixture smoke test that:

1. Launches the persistent context
2. Navigates to the internals page
3. Runs a test prompt
4. Verifies the model reaches "Ready" state
5. Closes cleanly

This test would be independent of e2e specs and would immediately surface fixture regressions.

---

### 2. Global Setup Warm-Up Separate from E2E Fixture

**Component:** Vitest global setup (`apps/in-browser-ai-coding-agent/global-setup.ts`)
**Files:** `apps/in-browser-ai-coding-agent/global-setup.ts` (entire file)

**Why fragile:** The global setup runs `chromium.launchPersistentContext()` independently of the e2e fixture. Both warm up the same model, but in separate browser processes:

1. **Global setup** launches Chrome, warms up model, closes Chrome
2. **E2E fixture** then launches Chrome again against the same profile

This means the profile directory is touched by two separate browser launches. If the global setup crashes before closing the context, the profile might be left in an inconsistent state (partial model files, stale inference caches). When the e2e fixture launches, it may encounter:

- ProcessSingleton lock contention (if the first browser didn't fully shut down)
- Stale cache files that don't match the current model version
- Incomplete model downloads

**Safe modification:** The global setup uses the exact same `enableInternalDebugPages()` function and warming logic as the fixture, but the code is not shared. Changes to one should be mirrored to the other.

**Test coverage:** Like the fixture, global setup correctness is verified implicitly. Its failure manifests as unit test timeouts, not as a direct signal that global setup failed.

---

### 3. Playwright Default Args String Matching

**Component:** Browser launch configuration
**Files:**

- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 15-28)
- `apps/in-browser-ai-coding-agent/global-setup.ts` (lines 15-19)

**Why fragile:** The `PLAYWRIGHT_DISABLE_FEATURES` constant must match Playwright's internal default string exactly:

```typescript
const PLAYWRIGHT_DISABLE_FEATURES = '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,...';
```

The `ignoreDefaultArgs` mechanism uses exact string comparison. If this constant is stale (Playwright released a new version with a different default feature list), `ignoreDefaultArgs` will fail silently — the string won't match, so Playwright won't remove it, and `OptimizationHints` remains disabled.

**Symptom of failure:** Tests report the model as "unavailable" or timeout with no clear indication of why. Debugging this requires understanding that `OptimizationHints` is disabled, which is not obvious.

**Safe modification:** After updating Playwright, manually verify the `PLAYWRIGHT_DISABLE_FEATURES` constant by:

1. Launching a test browser with the new Playwright version
2. Inspecting the actual command-line args passed to the browser
3. Updating the constant to match

Or: add an automated test that compares the constant to Playwright's actual defaults at runtime.

---

## Scaling Limits

### 1. Single-Threaded Test Execution

**Resource/System:** Test parallelism
**Current capacity:** `workers: 1` (serial execution only)
**Limit:** Any increase to `workers: 2+` will trigger Chrome ProcessSingleton conflicts because persistent contexts cannot share the same profile directory

**Scaling path:**

- Create separate profile directories for each worker (e.g., `.playwright-profiles/chrome-beta-worker-1`, `.playwright-profiles/chrome-beta-worker-2`)
- Implement a profile directory rotation scheme in the fixture to distribute workers across profiles
- Cache each profile separately
- This would double the profile cache storage and require twice the model download/warm-up work per CI run

**Trade-off:** The added complexity and storage cost may not be worth the parallelism gain given that on-device inference is resource-intensive anyway (loading GBs of model weights, running CPU/NPU inference). The current serial execution is likely close to optimal for resource-constrained CI runners.

---

### 2. Node.js RAM Usage During npm ci

**Resource/System:** Dependency installation
**Current capacity:** Works on all runners (4 vCPU, 16 GB RAM)
**Limit:** On Windows ARM runners, native module compilation (esbuild, @swc/core, @parcel/watcher, lmdb, @rollup/rollup) consumes significant RAM during `npm ci`

**Scaling path:** Already partially addressed — the Windows ARM job caches `node_modules` directly and skips `npm ci` on cache hits. On cache miss, the build completes successfully but is slow.

No further scaling required unless the dependency tree grows significantly.

---

## Dependencies at Risk

### 1. Playwright Version Pinning

**Risk:** Playwright is a critical dependency. The version is pinned in `package-lock.json`, but any update to Playwright may require:

- Updating the hardcoded `PLAYWRIGHT_DISABLE_FEATURES` constant (due to default args changes)
- Rebuilding the Docker container image
- Re-testing against new browser builds (Chrome Beta, Edge Dev channel versions)

**Impact:** A Playwright minor version bump could introduce new default `--disable-*` flags that inadvertently disable the LanguageModel API. This would manifest as silent failures (model "unavailable") rather than errors.

**Migration plan:**

1. When updating Playwright, always verify the `PLAYWRIGHT_DISABLE_FEATURES` constant against new defaults
2. Run full CI on the new version to validate LanguageModel API still works
3. Check if new default args affect any other functionality

---

### 2. Browser Version Drift (Chrome Beta, Edge Dev)

**Risk:** The CI uses the latest Chrome Beta and Edge Dev releases (`playwright install chrome-beta`, `playwright install msedge-dev`). These channels update frequently (weekly or more). A new browser release could:

- Change the `chrome://on-device-internals` UI, breaking the warm-up page selectors
- Change LanguageModel API behavior (new error types, different availability states)
- Introduce new bugs in on-device model delivery

**Current detection:** Tests fail with timeout or "Model not available" errors, but there's no automated detection of "browser version changed and broke something."

**Mitigation:**

- The CI includes two browser/model combinations, reducing the risk that a single browser change breaks everything
- The 20-minute e2e timeout accommodates some transient failures
- Logs include timestamps and browser channel, aiding diagnostics

**Recommendation:** Add a CI step that logs the actual browser version at test time so that correlating CI failures with browser releases is easier.

---

### 3. Chrome's `optimization-guide-on-device-model` Flag Semantics

**Risk:** The `optimization-guide-on-device-model@1` flag is a Chrome-internal API configuration. The `@1` vs `@2` values and their behavior are not officially documented. The current choice (`@1`) is based on empirical testing in the codebase (commit history shows the switch from `@2` after discovering the BypassPerfRequirement issue).

**Impact:** If Chrome changes the flag's internal behavior in a future release:

- `@1` might stop working for CPU inference
- `@2` might be fixed (making the workaround unnecessary)
- A new `@3` or `@4` might be needed

**Mitigation:** The codebase includes extensive research documentation (`platform-runner-findings.md`) explaining why `@1` is used and what the BypassPerfRequirement issue was. Future maintainers should refer to this when issues arise.

**Recommendation:** Monitor Chrome release notes for any mention of on-device model system changes. Add a unit test that specifically verifies CPU inference works on no-GPU machines (as a regression check for this issue).

---

## Missing Critical Features

### 1. Model Download Progress UI Not Implemented

**Feature gap:** The `LanguageModelService.downloadModel()` accepts an `onProgress` callback (lines 34-48 in `language-model.service.ts`), and the component displays download progress (lines 38-42 in `model-status.component.ts`). However, testing this feature requires a browser with:

- No cached model
- A way to trigger model download (not automatic)
- A way to monitor actual download progress (event emission)

**Blocks:** No manual testing or CI testing of the download progress feature. If the progress callback stops emitting events (due to a browser API change), the UI will silently report 0% indefinitely, and the feature won't be detected as broken.

**Test coverage:** There is a `language-model.service.spec.ts` but it does not test the `downloadModel()` method's `onProgress` callback (search for "downloadModel" — the method exists but is not tested).

---

## Test Coverage Gaps

### 1. `LanguageModelService.downloadModel()` Not Tested

**Untested area:** The `downloadModel(text: string, onProgress?: callback)` method (lines 33-51 in `language-model.service.ts`)

**Files:** `apps/in-browser-ai-coding-agent/src/app/language-model.service.spec.ts`

**What's not tested:**

- Calling `downloadModel()` when the model is not yet downloaded
- The `onProgress` callback receiving download events
- Error handling if download fails
- Cleanup (session.destroy()) after download

**Risk:** If the LanguageModel API changes how `downloadprogress` events are emitted, or if the event is not fired, the UI will report 0% progress indefinitely, and the feature won't be detected as broken until a user tries it.

**Why untested:** The e2e tests don't trigger downloads (models are pre-bootstrapped in CI). Unit tests could test this, but the method requires either:

- A real on-device model in the test browser (only available on Chrome Beta / Edge Dev with persistent profiles)
- A mock LanguageModel API (would defeat the purpose of the unit test)

**Priority:** Medium — this feature is rarely used in practice (the model is usually already available), but it should be validated.

---

### 2. Component Error State Recovery

**Untested area:** What happens when a prompt fails and the user immediately submits another prompt?

**Files:** `apps/in-browser-ai-coding-agent/src/app/model-status.component.spec.ts`

**What's not tested:**

- Sequence: prompt fails with error → error message displayed → user submits new prompt
- Does the error state clear?
- Does the new prompt execute cleanly or inherit error state?

**Potential issue:** The component sets `error()` on failure and clears it on form submit (line 156: `this.error.set('')`). This is correct, but there's no test validating the sequence.

**Risk:** Low — the code path is straightforward and the test suite does cover error cases.

---

## Summary of Priorities

| Area                                          | Severity                                   | Effort                 | Priority |
| --------------------------------------------- | ------------------------------------------ | ---------------------- | -------- |
| Hardcoded Playwright feature list duplication | High (silent failure on Playwright update) | Medium                 | High     |
| Profile cache key versioning                  | Medium (requires manual bump)              | Low                    | Medium   |
| Three-way warm-up logic duplication           | Medium (maintenance burden)                | High                   | Low      |
| Chrome ProcessSingleton flakiness             | Medium (handled by workaround)             | N/A (blocked upstream) | N/A      |
| Edge "Not Ready" transient state              | Low (handled by retry)                     | N/A (pre-release API)  | N/A      |
| `downloadModel()` not tested                  | Medium (feature untested)                  | Medium                 | Medium   |
| Model cold-start 11+ minutes                  | Medium (accepted constraint)               | High (no real fix)     | N/A      |
| Global setup / fixture redundancy             | Medium (coordination risk)                 | High                   | Low      |

---

_Concerns audit: 2026-03-22_
