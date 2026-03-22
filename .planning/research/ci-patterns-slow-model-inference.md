# CI Patterns for Slow AI Model Inference in GitHub Actions

**Researched:** 2026-03-22
**Overall confidence:** MEDIUM-HIGH
**Context:** Edge Dev + Phi-4 Mini on `windows-11-arm` takes 23+ min for first `session.prompt()`. Chrome Beta + Gemini Nano on `ubuntu-latest` takes ~20s. Both are free-tier GitHub-hosted runners.
**Constraint:** Only free-for-public-repos runners (`ubuntu-latest`, `windows-11-arm`). No larger runners, no self-hosted runners.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Question 1: Docker Container for Edge Dev on ARM64](#2-question-1-docker-container-for-edge-dev-on-arm64)
3. [Question 2: Better Hardware on GitHub-Hosted Runners](#3-question-2-better-hardware-on-github-hosted-runners)
4. [Question 3: Split Test Suite (Fast vs Inference)](#4-question-3-split-test-suite-fast-vs-inference)
5. [Question 4: Parallel Warm-Up in Background](#5-question-4-parallel-warm-up-in-background)
6. [Question 5: Service Container or Sidecar for Warm Model](#6-question-5-service-container-or-sidecar-for-warm-model)
7. [Question 6: Published Patterns for On-Device AI in CI](#7-question-6-published-patterns-for-on-device-ai-in-ci)
8. [Question 7: Larger ARM64 Runners](#8-question-7-larger-arm64-runners)
9. [Question 8: Persist Browser Process Across CI Steps](#9-question-8-persist-browser-process-across-ci-steps)
10. [Recommended Strategy](#10-recommended-strategy)
11. [The adapter_cache.bin Problem](#11-the-adapter_cachebin-problem)
12. [Sources](#12-sources)

---

## 1. Executive Summary

The 23+ minute cold-start for Phi-4 Mini on `windows-11-arm` is a fundamental hardware limitation: a 4-vCPU Azure Cobalt 100 (Arm Neoverse N2) processor running full ONNX Runtime graph optimization on a 4.86 GB model with no GPU acceleration. There is no configuration flag, environment variable, or software-level optimization that can reduce this to a fast operation. The strategy must accept the cold-start as a fixed cost and optimize around it.

After thorough research, the most impactful improvements are:

1. **Split the test suite** into fast tests (no inference) and slow tests (inference required), running them in separate CI steps with different timeouts. Fast tests run without model warm-up.
2. **Background warm-up** -- start the model warm-up as a background process while other CI steps (lint, build, typecheck) run concurrently in a restructured workflow.
3. **Fix the cache artifact problem** -- the `adapter_cache.bin` and `encoder_cache.bin` files are always 0 bytes in the cache, which means every CI run pays the full cold-start penalty regardless of cache hits. This is the single highest-impact fix.
4. **Persist the browser process across steps** within the same job using background processes (`&`) to avoid relaunching and reloading the model between e2e and unit test steps.

Docker containers are not viable for Edge Dev on ARM64 Windows. No GitHub-hosted runner offers better hardware for free. No published patterns exist for this specific use case -- this project is pioneering the domain.

---

## 2. Question 1: Docker Container for Edge Dev on ARM64

**Verdict: NOT VIABLE**
**Confidence: HIGH**

Running Edge Dev in a Docker container on the `windows-11-arm` runner is blocked by multiple hard constraints:

### Blockers

1. **GitHub Actions does not support container operations on Windows runners.** The `container:` directive in workflow YAML only works on Linux runners. Attempting to use it on Windows produces: `Container operations are only supported on Linux runners.` This is tracked in [actions/runner#1402](https://github.com/actions/runner/issues/1402) and [actions/runner#904](https://github.com/actions/runner/issues/904), both open since 2020/2021 with no resolution.

2. **Docker on Windows ARM64 has fundamental issues.** Docker Desktop's Windows ARM64 support has known problems -- users report `hcs::CreateComputeSystem` errors when trying to run containers, tracked in [docker/for-win#14368](https://github.com/docker/for-win/issues/14368).

3. **Edge Dev is not available for Linux ARM64.** There is no ARM64 Linux build of Edge Dev. The Cypress team has an open request ([cypress-io/cypress-docker-images#1189](https://github.com/cypress-io/cypress-docker-images/issues/1189)) for Edge on Linux ARM64, but Microsoft has not released one.

4. **Edge's model delivery requires Windows 10/11 Desktop.** Even if containerized, the model delivery system checks for a Desktop SKU (not Server), as documented in the project's platform findings. A Windows container running Server would be rejected.

### What About WSL2 or Linux Containers on Windows?

Even if Docker worked on Windows ARM64, the Edge Dev browser and its ONNX Runtime DLLs are Windows-native executables. They cannot run inside a Linux container. WSL2 adds an emulation layer that would make the already-slow inference even slower.

---

## 3. Question 2: Better Hardware on GitHub-Hosted Runners

**Verdict: NOT AVAILABLE on free tier**
**Confidence: HIGH**

### Standard `windows-11-arm` Runner Specs

| Spec      | Value                                       |
| --------- | ------------------------------------------- |
| Processor | Azure Cobalt 100 (Arm Neoverse N2, Armv9-A) |
| vCPUs     | 4                                           |
| RAM       | 16 GB                                       |
| Storage   | ~14 GB SSD (ephemeral)                      |
| GPU       | None                                        |
| NPU       | None                                        |
| OS Image  | Windows 11 Desktop (partner image)          |
| Cost      | Free for public repos                       |

### Larger Runners Exist But Are Not Free

GitHub offers larger ARM64 runners with configurations up to 64 vCPU / 208 GB RAM, and they can use the Windows 11 Desktop ARM image. However:

- **Larger runners are never free**, even for public repositories. They are billed per-minute to GitHub Team or Enterprise Cloud plans.
- **No GPU/NPU options exist for ARM64.** The only GPU runner (NVIDIA T4) is x64-only. No GitHub-hosted runner exposes NPU hardware.
- **An 8-vCPU ARM64 runner** (2x current cores, 32 GB RAM) could potentially halve the cold-start time from ~23 min to ~12 min based on the hardware performance analysis. But this requires a paid plan.

### No NPU on Any GitHub-Hosted Runner

No GitHub-hosted runner exposes NPU hardware (Qualcomm Hexagon, Intel Meteor Lake NPU, etc.). The developer's local Snapdragon X Elite NPU is not replicated in any CI environment. NPU inference for Phi-4 Mini would dramatically reduce inference time but is unavailable in CI.

---

## 4. Question 3: Split Test Suite (Fast vs Inference)

**Verdict: YES -- this is the highest-impact architectural change**
**Confidence: HIGH**

Splitting tests into "fast" (no inference) and "slow" (inference required) categories eliminates the warm-up dependency for the majority of tests.

### Current State

All unit tests currently run after e2e tests, with the e2e fixture performing model warm-up. Both the fast tests (availability checks, component rendering, API detection) and slow tests (actual prompting) share the same warm-up dependency.

### Vitest Tags (Available in Vitest 4.1+)

Vitest 4.1 introduced a tag system for test filtering:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    tags: [
      { name: 'fast', description: 'Tests that do not require model inference.' },
      { name: 'inference', description: 'Tests requiring on-device model inference.', timeout: 300_000 },
    ],
  },
});

// language-model.service.spec.ts
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
```

Filter from CLI:

```bash
# Run only fast tests (no warm-up needed)
vitest --tags-filter="fast"

# Run only inference tests (requires warm model)
vitest --tags-filter="inference"
```

### Playwright Tags

Playwright supports a similar pattern:

```typescript
test('should display model status', { tag: '@fast' }, async ({ persistentPage }) => {
  // No inference needed
});

test('should respond to prompt', { tag: '@inference' }, async ({ persistentPage }) => {
  // Requires warm model
});
```

Filter: `npx playwright test --grep @fast` or `--grep-invert @inference`

### Proposed CI Structure

```yaml
# Step 1: Fast e2e tests (no warm-up, ~2 min)
- name: Run fast e2e tests
  run: npx playwright test --grep @fast

# Step 2: Fast unit tests (no warm-up, ~1 min)
- name: Run fast unit tests
  run: vitest --tags-filter="fast"

# Step 3: Inference e2e tests (with warm-up, ~25 min)
- name: Run inference e2e tests
  timeout-minutes: 45
  run: npx playwright test --grep @inference

# Step 4: Inference unit tests (model already warm, ~5 min)
- name: Run inference unit tests
  run: vitest --tags-filter="inference"
```

### Impact Assessment

| Test Category                                             | Count (estimated) | Current Time                 | With Split         |
| --------------------------------------------------------- | ----------------- | ---------------------------- | ------------------ |
| Fast e2e (app renders, status element)                    | 2-3               | Blocked by 23 min warm-up    | ~30s               |
| Fast unit (API detection, availability, component render) | 4-6               | Blocked by 23 min warm-up    | ~30s               |
| Inference e2e (prompt test)                               | 1-2               | 23 min warm-up + ~1 min test | Same (unavoidable) |
| Inference unit (prompt tests)                             | 2-3               | ~5 min (model already warm)  | Same               |

**Fast test feedback in ~1 minute instead of ~25 minutes.** The inference tests still take the same time but no longer block fast feedback.

### Caveats

- The global setup currently warms the model for ALL tests. With the split, fast tests should skip the global setup entirely (or use a lightweight global setup that only verifies the browser launches).
- The `CI_VITEST_BROWSER_INSTANCE` filtering must compose with tag filtering.
- Guard tests (availability checks) can be tagged `fast` since they call `LanguageModel.availability()` which returns immediately without inference.

---

## 5. Question 4: Parallel Warm-Up in Background

**Verdict: YES -- viable with restructured workflow, medium complexity**
**Confidence: MEDIUM**

### The Concept

Start the model warm-up as a background process in the same job while other CI steps (that do not need the model) run concurrently. When the inference tests are ready to run, the model is already warm or nearly warm.

### How Background Processes Work in GitHub Actions

A process started with `&` in a step's shell command **persists for the entire job**. It does not exit when the step completes. This is a documented GitHub Actions behavior.

```yaml
- name: Start model warm-up (background)
  shell: bash
  run: |
    node scripts/warm-up-model.mjs --browser msedge-dev --profile .playwright-profiles/msedge-dev &
    echo $! > /tmp/warmup-pid.txt
    echo "Warm-up started in background (PID: $(cat /tmp/warmup-pid.txt))"

- name: Run fast e2e tests
  run: npx playwright test --grep @fast

- name: Run fast unit tests
  run: vitest --tags-filter="fast"

- name: Wait for warm-up to complete
  shell: bash
  run: |
    WARMUP_PID=$(cat /tmp/warmup-pid.txt)
    echo "Waiting for warm-up process (PID: $WARMUP_PID)..."
    wait $WARMUP_PID
    echo "Warm-up complete"

- name: Run inference tests
  timeout-minutes: 45
  run: npx playwright test --grep @inference
```

### Problems with This Approach on Windows

1. **ProcessSingleton conflict.** The warm-up process launches Edge Dev with a persistent context on the profile directory. If the fast tests also need Edge Dev (even for non-inference tests in browser mode), the second launch will fail due to the profile lockfile. Fast e2e tests and the warm-up process cannot run concurrently against the same browser profile.

2. **The warm-up script launches a headed browser.** On Windows, this requires a display environment. The warm-up browser window would be visible (and potentially interfering) while fast tests also try to use the display.

3. **`wait` on Windows (Git Bash).** The `wait` builtin in Git Bash works for backgrounded shell processes but may not correctly track a Node.js child process that spawns Chrome/Edge as a grandchild process.

### Viable Variant: Cross-Job Parallelism

Instead of parallel steps within a job, restructure the workflow so the warm-up runs in a separate job that the inference job depends on:

```yaml
jobs:
  fast-tests:
    runs-on: windows-11-arm
    steps:
      - name: Run fast e2e tests (no model needed)
        run: npx playwright test --grep @fast
      - name: Run fast unit tests
        run: vitest --tags-filter="fast"

  warm-up:
    runs-on: windows-11-arm
    steps:
      - name: Warm up model
        run: node scripts/warm-up-model.mjs ...
      - name: Save warmed profile cache
        uses: actions/cache/save@v5
        with:
          path: .playwright-profiles/msedge-dev
          key: msedge-dev-warmed-${{ github.run_number }}

  inference-tests:
    needs: [warm-up]
    runs-on: windows-11-arm
    steps:
      - name: Restore warmed profile
        uses: actions/cache/restore@v5
      - name: Run inference tests
        run: npx playwright test --grep @inference
```

**Problem:** This uses two `windows-11-arm` runners concurrently, which may not be available under free-tier concurrency limits. Also, the warm-up job produces cache artifacts that the inference job consumes -- but the cache transfer adds ~2-5 min for a ~5 GB profile, which partially negates the parallelism benefit.

### Verdict on Parallel Warm-Up

Background warm-up within the same job is blocked by ProcessSingleton for Edge/Chrome tests. Cross-job parallelism is possible but limited by runner concurrency and cache transfer overhead. The test suite split (Question 3) provides the same benefit (fast feedback for non-inference tests) without the complexity.

---

## 6. Question 5: Service Container or Sidecar for Warm Model

**Verdict: NOT VIABLE**
**Confidence: HIGH**

### Why Service Containers Cannot Work

1. **Service containers require Linux runners.** GitHub Actions service containers (the `services:` key in workflow YAML) are only supported on Linux runners. The `windows-11-arm` runner cannot use service containers.

2. **The model runs inside Edge Dev's process.** Phi-4 Mini inference is not a standalone service -- it runs inside Edge Dev's browser process via the embedded ONNX Runtime. There is no HTTP API, gRPC endpoint, or IPC mechanism to access it from outside the browser. The `LanguageModel` API is a JavaScript API accessible only within the browser's page context.

3. **Sidecar pattern requires a network-accessible service.** The sidecar pattern (a separate container or process running alongside the main workload) works for databases, caches, and API servers. On-device browser AI inference is fundamentally not a network service -- it is a browser-internal API.

### Could We Build a Custom Inference Server?

Theoretically, one could:

1. Download the ONNX model files from the Edge profile.
2. Run ONNX Runtime GenAI directly (outside Edge) as a standalone inference server.
3. Expose it via a local HTTP API.

This would bypass Edge entirely and make the model available as a service. However:

- The model files are Edge-proprietary (downloaded by Edge's LLM service, in Edge-specific format).
- The ONNX Runtime DLLs in the profile are Edge's embedded build, not the public ONNX Runtime package.
- The test suite needs to validate that the LanguageModel API works in the browser -- a standalone server would test ONNX Runtime, not the browser integration.
- This fundamentally changes what the tests validate.

---

## 7. Question 6: Published Patterns for On-Device AI in CI

**Verdict: No published patterns exist for this specific use case**
**Confidence: MEDIUM (searched extensively, found nothing)**

### What Exists in the Ecosystem

The on-device AI testing landscape in CI/CD is nascent. Research found:

- **Model evaluation pipelines** that run ONNX/TFLite/CoreML models in CI for regression testing of model quality (accuracy, latency benchmarks). These use standalone runtime binaries, not browser APIs.

- **WebGPU/WebAssembly model testing** in browsers using tools like Transformers.js. These are typically tested with standard headless Chromium and do not require branded browsers or on-device model delivery systems.

- **Apple's on-device model testing** uses QAT (Quantization-Aware Training) and dedicated hardware testing farms. Not applicable to CI.

- **Meta's ExecuTorch** (GA October 2025) has CI/CD integration for edge model testing but targets mobile/embedded devices, not browser APIs.

### Why No Published Patterns Exist

This project tests a pre-release browser API (`LanguageModel`) that requires:

- Branded browser channels (Chrome Beta, Edge Dev) -- not available in standard CI containers.
- Model delivery via browser-internal systems (Optimization Guide, Edge LLM Service) -- not accessible programmatically outside the browser.
- Multi-gigabyte model downloads cached in browser profiles.
- Real inference (no mocking) to validate the full pipeline.

No other open-source project appears to be running real on-device browser AI inference in CI with both Chrome and Edge. The patterns being developed in this project are novel.

### What Other Heavy-Model CI Projects Do

Projects with heavy model inference in CI (PyTorch, TensorFlow, Hugging Face) typically:

1. Use GPU runners (NVIDIA T4 on GitHub Actions, or self-hosted GPU machines).
2. Cache model weights in a shared filesystem or artifact store.
3. Run model warm-up as a dedicated CI step with generous timeouts.
4. Separate "model quality" tests (run nightly with full warm-up) from "integration" tests (run on every PR without inference).

The last pattern -- separating model quality from integration tests -- is directly applicable to this project (see Question 3).

---

## 8. Question 7: Larger ARM64 Runners

**Verdict: Available but NOT free -- excluded by constraint**
**Confidence: HIGH**

### What Exists

GitHub offers larger ARM64 Windows runners with the Windows 11 Desktop image:

| vCPU        | RAM    | Storage | Estimated Cold-Start | Cost                |
| ----------- | ------ | ------- | -------------------- | ------------------- |
| 4 (current) | 16 GB  | 150 GB  | ~23 min              | Free (public repos) |
| 8           | 32 GB  | 300 GB  | ~12 min (estimated)  | Paid                |
| 16          | 64 GB  | 600 GB  | ~7 min (estimated)   | Paid                |
| 32          | 128 GB | 1200 GB | ~4 min (estimated)   | Paid                |

Cold-start estimates are extrapolated from the hardware performance gap analysis: ONNX Runtime graph optimization is partially parallelizable, and more RAM eliminates memory pressure. An 8-vCPU runner with 2x cores and 2x RAM would likely halve the cold-start.

### Why Excluded

The project constraint is free-tier runners only. Larger runners are billed per-minute even for public repositories. They are not included in the free tier.

### If the Constraint Were Lifted

An 8-vCPU ARM64 runner would be the single most impactful change. At $0.02/min (estimated ARM64 rate), a 45-minute test run would cost ~$0.90. For a project that runs CI 5-10 times/day, that is $4.50-$9.00/day or $135-$270/month. Whether that is acceptable depends on the project's budget.

---

## 9. Question 8: Persist Browser Process Across CI Steps

**Verdict: YES -- viable and recommended**
**Confidence: HIGH**

### How It Works

Background processes started with `&` in a GitHub Actions step **persist for the entire job**. They do not terminate when the step completes. This is a documented and stable behavior.

The key insight: if the e2e tests launch Edge Dev with a persistent context and perform model warm-up, and the browser process is NOT killed between e2e and unit tests, the unit tests can potentially reuse the same warm browser process.

### Current Problem

The current workflow has an explicit "Kill lingering browser processes" step between e2e and unit tests:

```yaml
- name: Kill lingering browser processes
  run: |
    taskkill //F //IM msedge.exe 2>/dev/null || true
    taskkill //F //IM chrome.exe 2>/dev/null || true
    taskkill //F //IM chrome_crashpad_handler.exe 2>/dev/null || true
    sleep 2
```

This was added to resolve ProcessSingleton conflicts. But it also kills the warm browser, forcing the Vitest global setup to re-launch and re-warm the model.

### The Opportunity

If Vitest's browser mode could connect to an already-running browser instance instead of launching a new one, the kill step could be removed and unit tests would benefit from the warm model without any re-initialization.

However, **Vitest browser mode (`@vitest/browser-playwright`) always launches its own browser instance.** There is no "connect to existing browser" option. The `persistentContext` option specifies a profile directory path, but it launches a new browser process against that profile.

### Alternative: Shared Profile with Pre-Warmed Artifacts

The current approach (e2e writes ONNX artifacts to the profile, unit tests read them from the same profile) is the correct architecture. The problem is that the ONNX artifacts are not persisting correctly (see Section 11).

If the artifacts persisted correctly in the profile, the Vitest global setup warm-up would be fast (seconds, not minutes) because ONNX Runtime would load the pre-compiled session data instead of recompiling from scratch.

### Another Alternative: Merge E2E and Unit Tests Into One Job Step

Instead of separate e2e and unit test steps with a browser kill between them, run both in a single step where the browser stays alive:

```yaml
- name: Run all tests
  timeout-minutes: 60
  shell: bash
  run: |
    set -o pipefail
    # E2E first (warms the model)
    ${{ matrix.xvfb }} npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c ${{ matrix.e2e-config }} || E2E_EXIT=$?
    # Unit tests second (model already warm in profile)
    ${{ matrix.xvfb }} npm exec nx -- ${{ matrix.test-target }} in-browser-ai-coding-agent 2>&1 | tee unit-test-output.log || UNIT_EXIT=$?
    # Fail if either failed
    exit $((${E2E_EXIT:-0} + ${UNIT_EXIT:-0}))
```

This avoids the kill step, but Vitest still launches its own browser process. The benefit is that the profile directory retains any warm artifacts from the e2e run without interference from the kill step.

---

## 10. Recommended Strategy

Based on this research, the highest-impact changes in priority order:

### Priority 1: Fix the Cache Artifact Problem (Section 11)

**Impact: Potentially eliminates 23+ min cold-start on cache hits**
**Effort: Investigation + implementation**

The `adapter_cache.bin` and `encoder_cache.bin` files are always 0 bytes in the cache. If these files contained actual pre-compiled session data, subsequent CI runs would skip the full ONNX Runtime compilation and load from cache. This is the intended behavior -- the project already saves the cache post-test specifically to capture these artifacts. Something is preventing them from being populated.

Investigate:

1. Are the files actually populated during the test run (before cache save)?
2. Are they populated on the developer's local machine?
3. Is there a timing issue where the browser process is killed before ONNX Runtime has a chance to flush the files to disk?
4. Does ONNX Runtime's CPU EP on ARM64 even generate these cache files, or are they only generated by GPU/NPU EPs?

### Priority 2: Split Tests Into Fast and Inference Categories

**Impact: Fast test feedback in ~1 min instead of ~25 min**
**Effort: Medium (tag tests, add Vitest tag config, update CI workflow)**

Use Vitest tags and Playwright annotations to separate tests. Fast tests (availability checks, component rendering, API detection) run first without any model warm-up. Inference tests run after warm-up with extended timeouts.

This does not reduce total CI time but provides fast feedback for the most common failure modes (type errors, rendering bugs, API misconfiguration).

### Priority 3: Remove Browser Kill Step, Rely on Profile Artifacts

**Impact: Faster unit test warm-up after e2e**
**Effort: Low**

Instead of killing browser processes between e2e and unit tests, let them terminate naturally when Playwright closes the context. The 5-attempt retry loop in Vitest's global setup already handles ProcessSingleton contention. Removing the explicit kill step preserves any in-flight file writes (like ONNX cache files being flushed to disk) and reduces the delay between test suites.

If the kill step was added because of specific CI failures, consider replacing it with a targeted approach: only kill `chrome_crashpad_handler.exe` (which is the actual lockfile holder), not the main browser process.

### Priority 4: Restructure Workflow for Partial Parallelism

**Impact: Run fast tests while inference tests are warming up**
**Effort: Medium-High (workflow restructure)**

Move lint, typecheck, build, and fast tests to run before inference tests. This is already partially the case (lint-typecheck-build runs in parallel), but fast e2e/unit tests are currently bundled with inference tests in the same job.

### What NOT to Do

- **Do not invest in Docker for Edge Dev.** Blocked by multiple hard constraints.
- **Do not build a standalone ONNX inference server.** Changes what the tests validate.
- **Do not pursue parallel warm-up within the same job.** ProcessSingleton prevents concurrent browser instances on the same profile.
- **Do not disable/skip inference tests.** They are the core value of the CI pipeline.

---

## 11. The adapter_cache.bin Problem

**This is the critical finding that warrants immediate investigation.**

### The Problem

The existing research documents state:

- `adapter_cache.bin` and `encoder_cache.bin` are "always 0 bytes" in the CI cache.
- These files are "Pre-compiled ONNX Runtime session data" that should eliminate the cold-start.
- The cache is saved post-test to capture inference artifacts.

If these files are always 0 bytes, the entire caching strategy for eliminating cold-start is not working as intended. Every CI run pays the full 23+ minute cold-start even with a cache hit, because the restored cache contains model weights (useful -- avoids re-download) but not compiled session data (the slow part).

### Possible Causes

1. **ONNX Runtime CPU EP does not generate these files.** The EP Context Cache mechanism in ONNX Runtime is documented primarily for hardware-accelerator EPs (TensorRT, OpenVINO, QNN). The CPU EP may not implement session serialization. If true, there is no software fix -- the cold-start is unavoidable.

2. **Edge's embedded ONNX Runtime writes these files lazily.** The files might be populated asynchronously after `session.destroy()` or when the browser process exits cleanly. If the browser is killed (`taskkill //F`) before the flush completes, the files remain 0 bytes.

3. **The files are written but then truncated.** When `actions/cache/save` compresses the profile directory, it might encounter file locking issues with the browser still holding handles on these files.

4. **Different behavior on ARM64 vs x86_64.** The CPU EP on ARM64 may have different caching behavior than on x86_64. The ONNX Runtime KleidiAI optimizations for ARM64 (Neon/SVE2) might not support session serialization.

### Investigation Steps

```bash
# After e2e tests complete, before cache save, check file sizes
ls -la .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/adapter_cache.bin
ls -la .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/encoder_cache.bin

# Check on local machine after successful inference
ls -la .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/

# Add a sleep between browser close and cache save to allow lazy writes
sleep 10
```

If the files are 0 bytes locally too, the CPU EP does not generate them, and the caching strategy should be adjusted to accept this limitation. If they are populated locally but not in CI, the cause is likely the browser kill step or the cache save timing.

### ONNX Runtime EP Context Design

The ONNX Runtime [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) documents a mechanism where EPs can serialize their compiled context to disk:

> "To eliminate the repeated overhead of model conversion and compilation, most backend SDKs offer a feature to dump the pre-compiled model into a binary file. The pre-compiled model can be directly loaded by the backend SDK and executed on the target device."

However, this is enabled by `ep.context_enable = 1` (default is 0), and it is primarily implemented by NPU/GPU EPs (QNN, TensorRT, OpenVINO), not the CPU EP. If Edge's embedded ONNX Runtime has CPU EP context caching, it would be a proprietary extension not documented in the public API.

---

## 12. Sources

### GitHub Actions Runners and Infrastructure

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) - Runner specs, images, capabilities
- [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners) - Available larger runner sizes and configurations
- [GitHub Actions arm64 runners GA](https://github.blog/changelog/2024-09-03-github-actions-arm64-linux-and-windows-runners-are-now-generally-available/) - ARM64 runner availability announcement
- [Windows ARM64 runners announcement](https://blogs.windows.com/windowsdeveloper/2025/04/14/github-actions-now-supports-windows-on-arm-runners-for-all-public-repos/) - Free for public repos
- [ARM64 runners in private repos](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/) - January 2026 expansion
- [Arm Newsroom: Windows ARM64 runners](https://newsroom.arm.com/blog/windows-arm64-runners-git-hub-actions) - Hardware specs (Azure Cobalt 100)
- [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) - Per-minute rates

### Docker and Container Limitations

- [actions/runner#1402](https://github.com/actions/runner/issues/1402) - Windows container support request (open since 2021)
- [actions/runner#904](https://github.com/actions/runner/issues/904) - Container operations on Windows runners
- [docker/for-win#14368](https://github.com/docker/for-win/issues/14368) - Docker on Windows ARM64 issues
- [cypress-io/cypress-docker-images#1189](https://github.com/cypress-io/cypress-docker-images/issues/1189) - Edge for Linux ARM64 request

### Background Processes and Step Parallelism

- [Running a background service on GitHub Actions](https://www.eliostruyf.com/devhack-running-background-service-github-actions/) - Background process persistence
- [JarvusInnovations/background-action](https://github.com/marketplace/actions/background-action) - Background task action with readiness checks
- [Steps in parallel? (community discussion)](https://github.com/orgs/community/discussions/26291) - Official discussion on parallel steps

### Test Splitting and Filtering

- [Vitest Test Filtering](https://vitest.dev/guide/filtering) - Tag-based test filtering docs
- [Vitest 4.1 announcement](https://vitest.dev/blog/vitest-4-1.html) - Tags feature introduction
- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations) - Tag-based test selection

### ONNX Runtime

- [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) - Pre-compiled model caching
- [ONNX Runtime Performance Tuning](https://oliviajain.github.io/onnxruntime/docs/performance/tune-performance.html) - CPU inference optimization
- [OpenVINO EP + Model Caching](https://medium.com/openvino-toolkit/openvino-execution-provider-model-caching-better-first-inference-latency-for-your-onnx-models-cbcef1e79d65) - EP-level caching for first inference latency
- [onnxruntime#3802](https://github.com/microsoft/onnxruntime/issues/3802) - Slow model loading on ARM64
- [KleidiAI + ONNX Runtime](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) - ARM64 inference optimizations

### On-Device AI in CI (General)

- [On-Device LLMs: State of the Union, 2026](https://v-chandra.github.io/on-device-llms/) - Meta's overview of on-device LLM landscape
- [On-Device LLMs in 2026](https://www.edge-ai-vision.com/2026/01/on-device-llms-in-2026-what-changed-what-matters-whats-next/) - Edge AI industry perspective
