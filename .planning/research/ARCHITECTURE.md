# Architecture Patterns

**Domain:** CI/CD optimization for on-device browser AI testing
**Researched:** 2026-03-22
**Scope:** Edge Dev + Phi-4 Mini on `windows-11-arm` ONLY. Chrome Beta on `ubuntu-latest` works fine (~20s warm-up) and needs no changes.

## Recommended Architecture

### Current Architecture (Baseline)

```
CI Workflow
  |
  +-- ghcr (image name resolution)
  +-- format (PR only)
  +-- lint-typecheck-build (parallel)
  +-- test (matrix: chrome-beta + msedge-dev)
        |
        +-- chrome-beta on ubuntu-latest (containerized, ~20s warm-up -- NO CHANGES NEEDED)
        |     +-- Restore cache --> Bootstrap (if miss) --> E2E tests --> Unit tests --> Save cache
        |
        +-- msedge-dev on windows-11-arm (23+ min warm-up -- THIS IS THE PROBLEM)
              +-- Restore cache --> Bootstrap (if miss) --> E2E tests --> Kill browsers --> Unit tests --> Save cache
```

### Proposed Architecture (Optimized -- Edge Dev matrix entry only)

```
CI Workflow
  |
  +-- ghcr, format, lint-typecheck-build (unchanged)
  +-- test (matrix: chrome-beta + msedge-dev)
        |
        +-- chrome-beta on ubuntu-latest (UNCHANGED -- already fast)
        |     +-- Restore cache --> Bootstrap --> E2E tests --> Unit tests --> Save cache
        |
        +-- msedge-dev on windows-11-arm (OPTIMIZED)
              +-- Restore cache
              +-- Bootstrap (if cache miss)
              +-- Run fast e2e tests (@fast, no warm-up needed)    <-- NEW: ~30s
              +-- Run fast unit tests (tags: fast, no warm-up)     <-- NEW: ~30s
              +-- Run inference e2e tests (@inference, with warm-up) <-- 23+ min warm-up + tests
              +-- Graceful browser cleanup (sleep, not taskkill)    <-- CHANGED from kill step
              +-- Run inference unit tests (tags: inference)        <-- model warm from e2e
              +-- Cache diagnostics (log artifact sizes)            <-- NEW
              +-- Save cache
```

The key change is that fast tests run BEFORE the 23+ min inference warm-up on `windows-11-arm`, giving developers ~1 minute feedback for non-inference failures. On the Chrome Beta entry, warm-up is 20s so all tests run together without any split needed.

### Component Boundaries (Edge Dev specific)

| Component                | Responsibility                                                 | Communicates With                                         |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| Fast e2e tests           | Validate app renders, status element, no inference             | Edge Dev browser (no model invoked)                       |
| Fast unit tests          | Validate API detection, availability, component rendering      | Edge Dev browser (model may be available but not invoked) |
| Inference e2e tests      | Validate real prompt/response through full Phi-4 Mini pipeline | Edge Dev + warm Phi-4 Mini model                          |
| Inference unit tests     | Validate service.prompt() and component prompt flow            | Edge Dev + warm Phi-4 Mini model                          |
| Cache diagnostics        | Log `EdgeLLMOnDeviceModel/adapter_cache.bin` sizes             | Windows filesystem                                        |
| Global setup (fast)      | Launch Edge Dev, verify LanguageModel API exists, skip warm-up | Edge Dev profile                                          |
| Global setup (inference) | Full warm-up: create session, run prompt, wait for Ready       | Edge Dev profile + `edge://on-device-internals`           |

### Data Flow (Edge Dev on windows-11-arm)

```
1. Cache restore: .playwright-profiles/msedge-dev restored from GitHub Actions cache (~2-5 min for ~5 GB)
2. Bootstrap (cache miss): seed edge-llm flags, launch Edge Dev, download Phi-4 Mini (~4.86 GB), close
3. Fast tests: launch Edge Dev against profile (no warm-up prompt), run @fast tests, close
4. Inference tests:
   a. E2E fixture: launch Edge Dev, navigate to edge://on-device-internals,
      LanguageModel.create(), session.prompt('warmup'), wait for "Ready" (23+ min cold, ~35s warm)
   b. Run inference tests
   c. Playwright fixture teardown closes context gracefully (allow ONNX Runtime to flush)
5. Graceful cleanup: sleep 5-10s for child process + file flush (NOT taskkill //F)
6. Unit tests: Vitest global setup launches Edge Dev, confirms model ready (fast if profile has artifacts)
7. Cache diagnostics: log EdgeLLMOnDeviceModel/adapter_cache.bin and encoder_cache.bin sizes
8. Cache save: .playwright-profiles/msedge-dev saved with run_number key
```

## Patterns to Follow

### Pattern 1: Test Categorization by Warm-Up Dependency (Edge Dev only)

**What:** Tag every test with its warm-up requirement. Tests that only need a running browser get `fast`. Tests that invoke `session.prompt()` or depend on a warm model get `inference`.

**When:** For the Edge Dev (`test-edge`) target. Chrome Beta tests do not benefit from this split because warm-up is only 20s.

**Example:**

```typescript
// Vitest (applies to both browsers, but only impacts Edge Dev CI time)
it('should detect LanguageModel API support', { tags: ['fast'] }, async () => {
  expect(service.isSupported()).toBe(true);
});

it(
  'should respond to a prompt',
  { tags: ['inference'] },
  async () => {
    const response = await service.prompt('Hello, AI!');
    expect(response).toBeTruthy();
  },
  300_000,
);

// Playwright
test('should display model status', { tag: '@fast' }, async ({ persistentPage }) => {
  // ...
});

test('should respond to prompt', { tag: '@inference' }, async ({ persistentPage }) => {
  // ...
});
```

### Pattern 2: Graceful Browser Shutdown (Edge Dev on windows-11-arm)

**What:** Close the Edge Dev browser context via Playwright API (`context.close()`) instead of force-killing processes. Add a brief delay after closure to allow ONNX Runtime to flush cache files.

**When:** Between e2e and unit test steps on the `windows-11-arm` matrix entry.

**Why Edge-specific:** The kill step exists on `windows-11-arm` to handle ProcessSingleton contention. Chrome Beta on `ubuntu-latest` (Linux container) uses advisory locks that release immediately on process exit, so this is not a concern there.

**Example:**

```yaml
# Instead of:
- name: Kill lingering browser processes
  if: ${{ !matrix.container }} # Only on windows-11-arm
  run: |
    taskkill //F //IM msedge.exe 2>/dev/null || true
    taskkill //F //IM chrome_crashpad_handler.exe 2>/dev/null || true
    sleep 2

# Use:
- name: Wait for Edge Dev process cleanup
  if: ${{ !matrix.container }} # Only on windows-11-arm
  run: sleep 5
  # Playwright's fixture teardown already called context.close()
  # The 5s wait allows ONNX Runtime to flush EdgeLLMOnDeviceModel cache files
  # The 5-attempt retry loop in Vitest global setup handles any residual lockfile
```

### Pattern 3: Cache Artifact Diagnostics (Edge Dev profile)

**What:** Log file sizes of ONNX Runtime cache artifacts in the Edge profile to detect the 0-byte problem.

**When:** After e2e tests, after unit tests, and before cache save on the `windows-11-arm` matrix entry.

**Example:**

```yaml
- name: Check Edge ONNX cache artifact sizes
  if: ${{ !cancelled() && !matrix.container }} # Only on windows-11-arm
  shell: bash
  run: |
    echo "=== Edge ONNX cache artifact diagnostics ==="
    PROFILE=".playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel"
    if [ -d "$PROFILE" ]; then
      echo "adapter_cache.bin:"
      ls -la "$PROFILE/adapter_cache.bin" 2>/dev/null || echo "  NOT FOUND"
      echo "encoder_cache.bin:"
      ls -la "$PROFILE/encoder_cache.bin" 2>/dev/null || echo "  NOT FOUND"
      echo ""
      echo "Total profile size:"
      du -sh ".playwright-profiles/msedge-dev" 2>/dev/null || echo "  UNKNOWN"
    else
      echo "EdgeLLMOnDeviceModel directory not found"
    fi
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Force-Killing Edge Dev Before Cache Save

**What:** Using `taskkill //F` to kill `msedge.exe` immediately after tests on `windows-11-arm`.
**Why bad:** Force-kill terminates Edge Dev without allowing ONNX Runtime cleanup handlers or file flushes. The `adapter_cache.bin` and `encoder_cache.bin` files may be written asynchronously and get truncated to 0 bytes.
**Instead:** Let Playwright close the context gracefully. Wait 5-10 seconds. If lockfile contention remains, only kill `chrome_crashpad_handler.exe` (the lockfile holder, which does not write cache files). Note: Edge Dev does not exhibit the ProcessSingleton lockfile problem that Chrome does, so the kill step may be entirely unnecessary for the Edge Dev matrix entry.

### Anti-Pattern 2: Running All Edge Dev Tests Behind Warm-Up

**What:** Making all Edge Dev tests depend on the 23+ min model warm-up completion.
**Why bad:** Fast tests (availability checks, component rendering) do not need Phi-4 Mini inference. Gating them behind warm-up delays feedback by 20+ minutes.
**Instead:** Split tests by warm-up dependency. Run fast tests immediately on `windows-11-arm`, run inference tests after warm-up. This split is not needed for Chrome Beta (20s warm-up).

### Anti-Pattern 3: Pursuing Docker Containers for Edge Dev

**What:** Trying to containerize Edge Dev for the `windows-11-arm` runner.
**Why bad:** GitHub Actions does not support Windows containers. Docker on Windows ARM64 has issues. Edge Dev has no Linux ARM64 build. Edge model delivery requires Windows 10/11 Desktop.
**Instead:** Accept bare runner for Edge Dev. Docker works for Chrome Beta on Linux -- do not assume the same approach transfers.

### Anti-Pattern 4: Applying Chrome Beta Patterns to Edge Dev

**What:** Assuming that optimizations validated on Chrome Beta / `ubuntu-latest` will work on Edge Dev / `windows-11-arm`.
**Why bad:** The two matrix entries have fundamentally different characteristics. Chrome uses LiteRT/TFLite with XNNPACK (built into browser, 20s warm-up). Edge uses ONNX Runtime (downloaded as profile component, 23+ min cold-start on CPU). ProcessSingleton behavior differs (Chrome has it, Edge does not). Containerization works for Chrome, not for Edge.
**Instead:** Treat each matrix entry as a separate architecture. Optimizations must be validated on the specific runner and browser.

## Scalability Considerations (Edge Dev on windows-11-arm)

| Concern                    | Current (2 inference tests)                | At 10 inference tests                 | At 50 total tests                                         |
| -------------------------- | ------------------------------------------ | ------------------------------------- | --------------------------------------------------------- |
| Cold-start cost            | 23 min warm-up, amortized across 1-2 tests | Same 23 min, better amortization      | Same 23 min, much better amortization                     |
| Fast test feedback         | ~1 min with split                          | ~1 min (fast tests scale well)        | ~2-3 min (still fast)                                     |
| Cache size                 | ~5 GB Edge profile                         | Same (Phi-4 Mini model does not grow) | Same                                                      |
| CI wall-clock (Edge entry) | ~30 min (warm-up + tests)                  | ~35 min (approaching timeout)         | ~40 min (at timeout limit)                                |
| Mitigation for 50+ tests   | N/A                                        | N/A                                   | Split inference tests: critical on PR, full suite nightly |

Note: Chrome Beta on `ubuntu-latest` scales easily -- 20s warm-up + fast tests. The timeout concern is Edge-specific.

## Sources

- Project's existing CI workflow (`ci.yml`)
- Project's `docs/platform-runner-findings.md` -- documents Edge-specific ONNX Runtime behavior
- [Vitest Test Filtering](https://vitest.dev/guide/filtering)
- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations)
- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html)
