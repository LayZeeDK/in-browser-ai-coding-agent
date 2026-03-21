# Research: Gemini Nano CI Runner Requirements for Inference

**Researched:** 2026-03-21
**Overall confidence:** HIGH (official Chrome docs, Google developer blog, GitHub docs, Chromium discussion group, Chromium source references)
**Focus:** Which GitHub Actions runner + configuration can successfully run `session.prompt()` (not just `LanguageModel.availability()`)

---

## Executive Summary

The `UnknownError: Other generic failures occurred.` error from `session.prompt()` is almost certainly a **TFLite/LiteRT-LM inference backend failure** caused by Chrome selecting a GPU backend in an environment with no GPU. The model downloads and reports `'available'` because the download-and-register path is separate from the inference execution path. When inference is actually attempted, the GPU backend fails because Docker containers on `ubuntu-latest` have no GPU access.

**Chrome 140+ added CPU-only inference support for Gemini Nano** (announced October 2025). Chrome Beta 147 (currently used in CI) includes this. However, there is a documented bug where Chrome incorrectly selects the GPU backend even on no-GPU machines, causing "generic error" failures. The Chromium team's fix: **do not manually set chrome://flags** -- let Chrome auto-detect the backend. This directly conflicts with the current CI setup, which seeds flags via Local State.

The most viable path forward is:

1. **Try bare `ubuntu-latest` runner (no Docker)** with Chrome 147 Beta, letting Chrome auto-detect the CPU backend. The runner has 4 vCPU and 16 GB RAM, meeting the CPU inference minimums exactly.
2. If that fails, **try `ubuntu-24.04-arm`** (free ARM64 runner, 4 vCPU, 16 GB RAM) which avoids any AVX2-related XNNPACK issues.
3. If that fails, **use a larger runner** (8-core, 32 GB RAM, paid) for headroom.

---

## 1. Why `availability()` Succeeds but `prompt()` Fails

**Confidence:** HIGH

The LanguageModel API separates two concerns:

1. **Model availability** (`LanguageModel.availability()`): Checks whether the model component is registered and files are present on disk. This is a filesystem/component-updater check. It returns `'available'` when the model files exist in the profile's `OptGuideOnDeviceModel` directory.

2. **Model inference** (`session.prompt()`): Actually loads the model into the inference backend (GPU or CPU via LiteRT-LM/XNNPACK), allocates memory, and runs the forward pass. This is where hardware requirements matter.

The error `UnknownError: Other generic failures occurred.` maps to a TFLite/LiteRT execution failure. Known causes from the [Chrome AI developer discussion group](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I):

| Cause                                    | Symptoms                                           | Fix                                                |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| GPU out of memory                        | `UnknownError` when `BypassPerfRequirement` is set | Need adequate GPU or use CPU backend               |
| Invalid `responseConstraint` JSON schema | `UnknownError` on `prompt()`                       | Fix schema                                         |
| Backend type mismatch                    | Chrome selects GPU backend on no-GPU machine       | Let Chrome auto-detect (do not set flags manually) |
| OS incompatibility                       | Older macOS versions fail                          | Update OS                                          |

**In the Docker container scenario:** The container has no GPU. Chrome's Optimization Guide runs a GPU performance shader at startup. When it detects no GPU (or an inadequate one), it should fall back to CPU. But if chrome://flags are manually set (as the bootstrap script does), Chrome may override its auto-detection and attempt GPU inference, which then fails with the generic error.

**Source:** [Chrome AI dev group: UnknownError discussion](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I), [Chrome AI dev group: Backend Type mismatch](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE)

---

## 2. Gemini Nano Hardware Requirements for Inference

**Confidence:** HIGH (official Chrome documentation)

### Documented Requirements

| Resource       | GPU Path                                  | CPU Path               | Source                                                                    |
| -------------- | ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| Chrome version | 138+                                      | 140+                   | [Chrome AI get-started](https://developer.chrome.com/docs/ai/get-started) |
| GPU VRAM       | > 4 GB (strict)                           | N/A                    | Official docs                                                             |
| RAM            | Not specified                             | 16 GB minimum          | Official docs                                                             |
| CPU cores      | Not specified                             | 4 minimum              | Official docs                                                             |
| Disk free      | 22 GB minimum                             | 22 GB minimum          | Official docs                                                             |
| Network        | Unmetered for download                    | Unmetered for download | Official docs                                                             |
| OS             | Windows 10/11, macOS 13+, Linux, ChromeOS | Same                   | Official docs                                                             |

### CPU Inference (Chrome 140+)

[Announced October 2025](https://developer.chrome.com/blog/gemini-nano-cpu-support), CPU inference support was a direct response to developer feedback requesting broader device compatibility. Key details:

- **No code changes required** -- existing `LanguageModel.create()` and `session.prompt()` calls work identically on CPU and GPU.
- **Automatic backend selection** -- Chrome decides GPU vs CPU based on hardware detection. Developers do not (and should not) control this.
- **Performance difference** -- GPU inference is near-instant; CPU inference for complex prompts can take 60+ seconds.
- **Model variant selection** -- Chrome downloads a larger (4B parameter) or smaller (2B parameter) model variant based on the device's performance class, or falls back to CPU if the device meets the CPU-only static requirements.

### The `BypassPerfRequirement` Flag and Backend Selection

**This is critical for understanding the CI failure.** The `optimization-guide-on-device-model@2` flag in the bootstrap script sets `BypassPerfRequirement`. This tells Chrome to skip the GPU performance shader test. However, it may also skip the automatic fallback to CPU, causing Chrome to attempt GPU inference on a machine with no GPU.

A developer on the Chrome AI discussion group reported exactly this behavior: on a no-GPU PC, Chrome incorrectly set Backend Type to "GPU (highest quality)" instead of "CPU". The Chromium team's response: **re-run without manually setting flags** and let Chrome auto-detect. It worked -- the backend was correctly set to CPU.

**Implication for CI:** The bootstrap script's flag seeding (`optimization-guide-on-device-model@2`) may be the root cause of the inference failure. By forcing `BypassPerfRequirement`, it may be overriding the automatic CPU fallback.

**Source:** [Chrome AI dev group: Backend Type bug](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE)

### CPU Instruction Set Requirements

**Confidence:** MEDIUM (inferred from LiteRT/XNNPACK documentation, not stated by Chrome)

Chrome does not explicitly require AVX2 or any specific SIMD instruction set. However, the underlying inference engine is LiteRT-LM, which uses XNNPACK for CPU inference. XNNPACK includes optimized codepaths for:

| Instruction Set | Supported | Era                | Notes            |
| --------------- | --------- | ------------------ | ---------------- |
| SSE2            | Yes       | 2001+ (all x86_64) | Minimum baseline |
| SSE4.1/4.2      | Yes       | 2008+              | Widely available |
| AVX             | Yes       | 2011+              | Sandy Bridge+    |
| AVX2            | Yes       | 2013+              | Haswell+         |
| AVX-512         | Yes       | 2017+              | Server CPUs      |

**XNNPACK does not require AVX2** -- it has fallback codepaths for SSE2-only CPUs. However, inference performance is significantly better with AVX2. The GitHub Actions `ubuntu-latest` runner uses Intel Xeon Platinum 8272CL (Cascade Lake), which supports AVX2 and AVX-512. This is not a concern.

**One important caveat:** For FP16 (half-precision) models on x86_64, AVX2 is required for FP16 emulation. If the Gemini Nano model uses FP16 weights, AVX2 is a hard requirement. The model appears to use INT8 quantization, which does not require AVX2. But this is unverified for the specific model variant downloaded in CI.

**Source:** [TensorFlow Blog: XNNPACK Integration](https://blog.tensorflow.org/2020/07/accelerating-tensorflow-lite-xnnpack-integration.html), [XNNPACK README](https://github.com/google/XNNPACK), [desmoteo/tflite-inference Docker image](https://github.com/desmoteo/tflite-inference)

---

## 3. GitHub Actions Runner Hardware

**Confidence:** HIGH (official GitHub documentation)

### Standard Runners (Free for Public Repositories)

| Runner Label                            | Arch        | vCPU | RAM   | Storage   | GPU           | AVX2               |
| --------------------------------------- | ----------- | ---- | ----- | --------- | ------------- | ------------------ |
| `ubuntu-latest` / `ubuntu-24.04`        | x64         | 4    | 16 GB | 14 GB SSD | None          | Yes (Xeon 8272CL)  |
| `ubuntu-22.04`                          | x64         | 4    | 16 GB | 14 GB SSD | None          | Yes                |
| `ubuntu-24.04-arm` / `ubuntu-22.04-arm` | ARM64       | 4    | 16 GB | 14 GB SSD | None          | N/A (ARM has NEON) |
| `windows-latest` / `windows-2025`       | x64         | 4    | 16 GB | 14 GB SSD | None          | Yes                |
| `windows-11-arm`                        | ARM64       | 4    | 16 GB | 14 GB SSD | None          | N/A                |
| `macos-latest` / `macos-15`             | ARM64 (M1)  | 3    | 7 GB  | 14 GB SSD | ~1 GB MPS cap | N/A                |
| `macos-13`                              | x64 (Intel) | 4    | 14 GB | 14 GB SSD | Unknown       | Yes                |
| `macos-15-intel` / `macos-26-intel`     | x64 (Intel) | 4    | 14 GB | 14 GB SSD | Unknown       | Yes                |

### Compatibility with Gemini Nano CPU Requirements (16 GB RAM, 4 cores)

| Runner                     | Meets RAM?            | Meets Cores?  | Meets Disk?          | Chrome on Linux?     | Verdict               |
| -------------------------- | --------------------- | ------------- | -------------------- | -------------------- | --------------------- |
| `ubuntu-latest` (x64)      | 16 GB = 16 GB (exact) | 4 = 4 (exact) | 14 GB < 22 GB (FAIL) | Yes                  | MAYBE (disk is tight) |
| `ubuntu-24.04-arm` (ARM64) | 16 GB = 16 GB (exact) | 4 = 4 (exact) | 14 GB < 22 GB (FAIL) | No Chrome arm64 .deb | BLOCKED               |
| `windows-latest` (x64)     | 16 GB = 16 GB (exact) | 4 = 4 (exact) | 14 GB < 22 GB (FAIL) | N/A (Windows)        | MAYBE (disk tight)    |
| `macos-latest` (M1)        | 7 GB < 16 GB (FAIL)   | 3 < 4 (FAIL)  | 14 GB < 22 GB (FAIL) | N/A (macOS)          | NO                    |
| `macos-26-intel`           | 14 GB < 16 GB (FAIL)  | 4 = 4 (exact) | 14 GB < 22 GB (FAIL) | N/A (macOS)          | NO                    |

### The Disk Space Problem

All standard runners report 14 GB SSD storage. The 22 GB free disk requirement is a pre-flight check Chrome performs before downloading the model. In practice:

- The model on disk is ~4 GB (verified locally: `v3Nano 2025.06.30.1229` = 4,072 MiB).
- The 22 GB check is Chrome's safety margin, not actual usage.
- With `actions/cache`, the model is restored into the profile directory. Chrome may re-check free space when loading the model, but if the files are already present, it may skip the check.
- On `ubuntu-latest`, free space after OS + preinstalled tools is ~29 GB (or ~50-60 GB after removing Android SDK and .NET). The 14 GB figure is the runner's SSD size, but the actual usable space is larger.

**Important correction from earlier research:** The 14 GB SSD figure from GitHub docs refers to the guaranteed storage, but `ubuntu-latest` runners actually have ~84 GB total with ~29 GB free by default. With disk cleanup, ~50-60 GB is available. Disk space is NOT the blocker.

### Larger Runners (Paid, GitHub Team/Enterprise)

| Runner        | vCPU | RAM   | GPU     | Cost/min | Gemini Nano CPU?   |
| ------------- | ---- | ----- | ------- | -------- | ------------------ |
| 4-core Linux  | 4    | 16 GB | None    | $0.012   | Exact match        |
| 8-core Linux  | 8    | 32 GB | None    | $0.022   | Yes, with headroom |
| 16-core Linux | 16   | 64 GB | None    | $0.042   | Yes, ample         |
| GPU T4 Linux  | 4    | 28 GB | T4 16GB | $0.052   | GPU path available |

**Source:** [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners), [GitHub blog: Double the power for open source](https://github.blog/news-insights/product-news/github-hosted-runners-double-the-power-for-open-source/)

---

## 4. Docker Container vs Bare Runner

**Confidence:** HIGH

### Docker Container Issues for Model Inference

Running Chrome inside a Docker container on `ubuntu-latest` creates several problems for Gemini Nano inference:

| Factor                   | Docker Container                          | Bare Runner             |
| ------------------------ | ----------------------------------------- | ----------------------- |
| GPU access               | None (no passthrough on GH Actions)       | None (same hardware)    |
| GPU detection            | Chrome may detect "no GPU" differently    | Chrome detects no GPU   |
| `/dev/shm` size          | Default 64 MB (fixable with `--ipc=host`) | System default (larger) |
| `--no-sandbox`           | Often needed in containers                | Not needed              |
| Chrome process isolation | Container adds another layer              | Native                  |
| Memory overhead          | Container runtime uses some RAM           | No overhead             |
| Available RAM for Chrome | ~15.5 GB (after container overhead)       | ~15.5 GB (after OS)     |

**The Docker container itself does not block TFLite CPU inference.** TFLite with XNNPACK is a pure CPU library that runs in userspace -- it does not need special kernel access or GPU. A Docker container for CPU-only TFLite inference is a well-tested pattern (see [desmoteo/tflite-inference](https://github.com/desmoteo/tflite-inference)).

**However, Docker may affect Chrome's GPU detection heuristic.** Chrome runs a GPU performance shader at startup to determine the backend type. In a Docker container with no GPU and no display, Chrome may:

1. Correctly detect "no GPU" and select CPU backend (desired behavior)
2. Incorrectly detect something and select GPU backend (bug, documented)
3. Fail the GPU test but not fall back to CPU due to flag overrides

### Recommendation: Try Bare Runner First

Running on a bare `ubuntu-latest` runner (no Docker container) eliminates one variable. Chrome runs directly on the runner's Ubuntu 24.04, with:

- Direct access to the runner's GPU detection (even if it returns "no GPU")
- No Docker-layer memory overhead
- No `/dev/shm` issues
- System `xvfb-run` available directly

If bare runner works but Docker does not, the container's GPU detection environment is the issue. If both fail, the problem is Chrome's backend selection logic or hardware requirements.

---

## 5. The Inference Backend Chain

**Confidence:** HIGH

Chrome's on-device model inference uses this stack:

```
LanguageModel.create() / session.prompt()
        |
        v
Chrome Optimization Guide (C++)
        |
        v
LiteRT-LM (inference pipeline)
        |
        v
LiteRT (model execution runtime, formerly TFLite)
        |
        v
[GPU Backend: WebGPU/Vulkan/OpenCL/Metal]  OR  [CPU Backend: XNNPACK]
```

### Backend Selection Logic (Chrome 140+)

1. Chrome runs a GPU performance shader test.
2. If GPU VRAM > 4 GB: select GPU backend, download larger model variant (4B params).
3. If GPU VRAM <= 4 GB but > 0: select GPU backend, download smaller model variant (2B params).
4. If no GPU or GPU test fails, AND RAM >= 16 GB and cores >= 4: select CPU backend via XNNPACK.
5. If neither GPU nor CPU requirements met: do not download model, return `'unavailable'`.

### What `BypassPerfRequirement` Does

The `BypassPerfRequirement` flag (set by `optimization-guide-on-device-model@2` in chrome://flags) was originally designed to skip the GPU performance class check so that developers could test on underpowered hardware. It was created **before CPU inference existed** (Chrome 140).

On Chrome 147 (which has CPU inference), `BypassPerfRequirement` may:

- Bypass the GPU performance check (intended)
- Also bypass the CPU fallback logic (unintended side effect)
- Cause Chrome to attempt GPU inference on a no-GPU machine (observed bug)

**This is the most likely root cause of the `UnknownError` in CI.**

**Source:** [Chrome AI model management docs](https://developer.chrome.com/docs/ai/understand-built-in-model-management), [Chrome CPU inference blog](https://developer.chrome.com/blog/gemini-nano-cpu-support), [LiteRT-LM framework](https://developers.googleblog.com/on-device-genai-in-chrome-chromebook-plus-and-pixel-watch-with-litert-lm/)

---

## 6. Specific Configuration Recommendations

### Configuration A: Bare `ubuntu-latest` Without BypassPerfRequirement (Recommended First Try)

**Rationale:** Let Chrome 147's automatic backend detection select CPU inference. Remove the `BypassPerfRequirement` flag that may be forcing GPU.

```yaml
jobs:
  test-chrome-ai:
    runs-on: ubuntu-latest # No container
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version-file: '.node-version'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps chrome-beta

      - name: Restore AI model cache
        uses: actions/cache/restore@v5
        id: model-cache
        with:
          path: .playwright-profiles/chrome-beta
          key: chrome-beta-ai-model-v2 # New key to force fresh profile

      - name: Bootstrap AI model (modified flags)
        if: steps.model-cache.outputs.cache-hit != 'true'
        run: xvfb-run --auto-servernum node scripts/bootstrap-ai-model.mjs --browser chrome-beta --profile .playwright-profiles/chrome-beta --timeout 600000

      - name: Run tests
        run: xvfb-run --auto-servernum npm exec nx -- e2e in-browser-ai-coding-agent-e2e -- --project=chrome-gemini-nano
```

**Bootstrap script changes needed:**

1. Change `optimization-guide-on-device-model@2` to `optimization-guide-on-device-model@1` (Enabled, without BypassPerfRequirement).
2. OR remove it entirely and rely on `--enable-features=OptimizationGuideOnDeviceModel` command-line flag without the `:compatible_on_device_performance_classes/*` parameter.
3. Verify that `chrome://on-device-internals` shows Backend Type = "CPU" in the CI logs.

### Configuration B: Bare `ubuntu-latest` With Explicit CPU Backend (If A Fails)

If Chrome still selects GPU despite auto-detection, try explicitly disabling GPU:

```typescript
args: [
  '--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano',
  '--disable-gpu',
  DISABLE_FEATURES_WITHOUT_OPT_HINTS,
],
```

The `--disable-gpu` flag tells Chrome to not use GPU for any rendering or compute. This should force the LiteRT backend to select CPU/XNNPACK.

### Configuration C: Larger Runner (If 16 GB Is Not Enough)

The 16 GB RAM on `ubuntu-latest` is the exact minimum. After OS, browser, Playwright, and test overhead, there may not be enough for the model. An 8-core larger runner with 32 GB provides ample headroom.

```yaml
runs-on: ubuntu-latest-8-cores # Requires GitHub Team/Enterprise
```

Cost: ~$0.022/min. A 5-minute test run costs ~$0.11.

### Configuration D: Docker Container With `--disable-gpu` (If Container Is Preferred)

If the Docker approach is required for other reasons, add `--disable-gpu` to the Chrome launch args and use the `--ipc=host` and `--shm-size=1g` container options:

```yaml
container:
  image: ghcr.io/layzeedk/in-browser-ai-coding-agent/playwright-chrome-beta:latest
  options: --ipc=host --shm-size=1g --user 1001
```

---

## 7. Known Issues and Blockers

### Known Issue: Backend Type Mismatch

**Severity:** HIGH
**Status:** Acknowledged by Chromium team, fix is "don't manually set flags"
**Impact:** Chrome selects GPU backend on no-GPU machine, causing inference failure
**Workaround:** Do not set `optimization-guide-on-device-model@2` (BypassPerfRequirement). Use `@1` (Enabled) or omit entirely.
**Source:** [Chrome AI dev group](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE)

### Known Issue: 16 GB RAM Is Exact Minimum

**Severity:** MEDIUM
**Impact:** With OS, browser, and test framework overhead, available RAM may be <16 GB, causing Chrome to reject CPU inference
**Workaround:** Use larger runner (32 GB), or reduce test framework memory footprint

### Known Issue: No Headless Mode Confirmation

**Severity:** MEDIUM
**Impact:** No official documentation confirms Gemini Nano works in headless Chrome. All known working examples use headed mode (with xvfb).
**Workaround:** Continue using `xvfb-run` for headed mode on Linux

### Known Issue: Model Download Requires Network

**Severity:** LOW (mitigated by caching)
**Impact:** First run requires downloading ~4 GB model from Google's servers
**Workaround:** `actions/cache` for the profile directory (already implemented)

### Potential Issue: AVX2 in VMs

**Severity:** LOW
**Impact:** Some users reported AVX2 flags not exposed in certain VM configurations
**Evidence:** The Intel Xeon 8272CL supports AVX2/AVX-512, and a CMake cpuinfo tool on GitHub Actions confirmed x86-64-v4 architecture level
**Workaround:** Add `cat /proc/cpuinfo | grep -o 'avx[^ ]*'` diagnostic step to verify

### Non-Issue: Docker Blocking TFLite CPU

**Severity:** None
**Impact:** Docker containers do NOT block TFLite/XNNPACK CPU inference. CPU-only TFLite in Docker is a well-established pattern.

---

## 8. Debugging Steps for CI

Add these diagnostic steps to the CI workflow to identify the exact failure point:

```yaml
- name: Diagnostic - CPU features
  run: cat /proc/cpuinfo | grep -oE '(sse|avx|fma)[^ ]*' | sort -u

- name: Diagnostic - System resources
  run: |
    echo "=== Memory ==="
    free -h
    echo "=== Disk ==="
    df -h /
    echo "=== CPU ==="
    nproc
    lscpu | grep -E 'Model name|CPU\(s\)|Thread'
```

After the bootstrap, add a step to check the backend type:

```yaml
- name: Diagnostic - Chrome on-device internals
  run: |
    xvfb-run --auto-servernum node -e "
      const { chromium } = require('playwright');
      (async () => {
        const ctx = await chromium.launchPersistentContext('.playwright-profiles/chrome-beta', {
          channel: 'chrome-beta',
          headless: false,
          ignoreDefaultArgs: ['--disable-field-trial-config', '--disable-background-networking', '--disable-component-update', '$PLAYWRIGHT_DISABLE_FEATURES'],
          args: ['--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano', '$DISABLE_FEATURES_WITHOUT_OPT_HINTS'],
        });
        const page = ctx.pages()[0] || await ctx.newPage();
        await page.goto('chrome://on-device-internals');
        await page.waitForTimeout(3000);
        const content = await page.content();
        console.log('=== on-device-internals HTML (first 5000 chars) ===');
        console.log(content.substring(0, 5000));
        await ctx.close();
      })();
    "
```

---

## 9. Recommended Action Plan

### Phase 1: Quick Fix (Try Today)

1. **Change the flag from `@2` to `@1`** in the bootstrap script's `browserConfig['chrome-beta'].flags`:
   - From: `'optimization-guide-on-device-model@2'` (Enabled BypassPerfRequirement)
   - To: `'optimization-guide-on-device-model@1'` (Enabled, normal performance detection)
2. **Invalidate the model cache** by changing the cache key (e.g., `chrome-beta-ai-model-v2`).
3. **Add diagnostic steps** (CPU features, memory, chrome://on-device-internals backend type).
4. **Test on bare `ubuntu-latest`** (no Docker container) to eliminate container as a variable.

### Phase 2: If Phase 1 Fails

1. **Add `--disable-gpu`** to Chrome launch args to force CPU backend.
2. **Remove ALL flag seeding** from the bootstrap script. Use only `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano` as command-line args, without `BypassPerfRequirement`.
3. **Try `ubuntu-24.04-arm`** runner (if Chrome Beta has an ARM64 .deb; Playwright may handle this via `npx playwright install chrome-beta`).

### Phase 3: If RAM Is the Bottleneck

1. **Use an 8-core larger runner** with 32 GB RAM ($0.022/min, requires GitHub Team plan or Enterprise).
2. **Or** accept that Gemini Nano CPU inference in CI is not feasible on free runners and fall back to mocking for standard CI, with real model tests on a nightly/manual schedule using paid runners.

---

## 10. Runner Comparison for Gemini Nano Inference

| Runner               | Free? | RAM   | Cores | GPU       | CPU Inference?                | GPU Inference?   | Notes                          |
| -------------------- | ----- | ----- | ----- | --------- | ----------------------------- | ---------------- | ------------------------------ |
| `ubuntu-latest`      | Yes   | 16 GB | 4     | None      | MAYBE (exact min)             | No               | Best free option               |
| `ubuntu-24.04-arm`   | Yes   | 16 GB | 4     | None      | MAYBE (if Chrome arm64 works) | No               | No Chrome Beta arm64 confirmed |
| `windows-latest`     | Yes   | 16 GB | 4     | None      | MAYBE (exact min)             | No               | Different platform             |
| `windows-11-arm`     | Yes   | 16 GB | 4     | None      | MAYBE                         | No               | Already used for Edge          |
| `macos-latest` (M1)  | Yes   | 7 GB  | 3     | ~1 GB MPS | No (7 GB < 16 GB)             | No (1 GB < 4 GB) | Not viable                     |
| `macos-26-intel`     | Yes   | 14 GB | 4     | Unknown   | No (14 GB < 16 GB)            | No               | 2 GB short                     |
| 8-core larger (paid) | No    | 32 GB | 8     | None      | YES                           | No               | Best paid option               |
| GPU T4 (paid)        | No    | 28 GB | 4     | 16 GB T4  | YES                           | MAYBE            | T4 may work via Vulkan         |

---

## 11. Key Insight: The Problem May Not Be Hardware

The existing research assumed the `UnknownError` was a hardware limitation. But given that:

1. Chrome 147 Beta supports CPU inference (shipped in Chrome 140).
2. `ubuntu-latest` meets the CPU minimum requirements (4 cores, 16 GB RAM).
3. The Docker container does NOT block TFLite CPU inference.
4. There is a documented bug where `BypassPerfRequirement` causes Chrome to select GPU backend on no-GPU machines.

**The most likely fix is a configuration change, not a hardware upgrade.** Specifically, changing the `optimization-guide-on-device-model` flag from `@2` (BypassPerfRequirement) to `@1` (Enabled) -- or removing it entirely and letting Chrome auto-detect -- should cause Chrome to correctly select the CPU backend.

This should be tested before pursuing paid larger runners or other infrastructure changes.

---

## Sources

### Official Chrome Documentation (HIGH confidence)

- [Chrome AI: Get Started](https://developer.chrome.com/docs/ai/get-started) -- Hardware requirements table
- [Chrome AI: Built-in Model Management](https://developer.chrome.com/docs/ai/understand-built-in-model-management) -- Backend selection logic
- [Chrome AI: Debug Gemini Nano](https://developer.chrome.com/docs/ai/debug-gemini-nano) -- Debugging guide
- [Expanding built-in AI to more devices with Chrome](https://developer.chrome.com/blog/gemini-nano-cpu-support) -- CPU support announcement (Chrome 140)

### Google Developer Blog (HIGH confidence)

- [On-device GenAI with LiteRT-LM](https://developers.googleblog.com/on-device-genai-in-chrome-chromebook-plus-and-pixel-watch-with-litert-lm/) -- Inference engine architecture

### Chrome AI Developer Discussion Group (HIGH confidence)

- [UnknownError: Other generic failures](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I) -- Error causes: GPU OOM, schema validation
- [Uncaught UnknownError](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/sAtcHSpZ08U) -- Error on older macOS, fixed by OS update
- [Backend Type mismatch](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE) -- GPU selected on no-GPU machine, fix: don't set flags manually

### GitHub Documentation (HIGH confidence)

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- Runner specs
- [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners) -- Paid runner specs
- [GitHub Actions: Double the power for open source](https://github.blog/news-insights/product-news/github-hosted-runners-double-the-power-for-open-source/) -- 4-vCPU upgrade for public repos

### TFLite / LiteRT / XNNPACK (MEDIUM confidence)

- [TensorFlow Blog: XNNPACK Integration](https://blog.tensorflow.org/2020/07/accelerating-tensorflow-lite-xnnpack-integration.html) -- SIMD instruction support
- [XNNPACK GitHub](https://github.com/google/XNNPACK) -- CPU inference library
- [desmoteo/tflite-inference Docker image](https://github.com/desmoteo/tflite-inference) -- TFLite CPU inference in Docker (proves it works)
- [LiteRT-LM GitHub](https://github.com/google-ai-edge/LiteRT-LM) -- Open-source inference framework

### Chromium Source References (MEDIUM confidence)

- [Chromium Optimization Guide README](https://chromium.googlesource.com/chromium/src/+/HEAD/components/optimization_guide/README.md) -- Component architecture
- [CEF Issue #3982](https://github.com/chromiumembedded/cef/issues/3982) -- Google-internal dependency confirmation

### Community Discussion (LOW-MEDIUM confidence)

- [GitHub Community: AVX2 on Actions runners](https://github.com/orgs/community/discussions/65535) -- AVX2 availability varies
- [actions/runner#1069: AVX-512 support request](https://github.com/actions/runner/issues/1069) -- CPU feature availability
- [Gemini Nano production experience](https://sendcheckit.com/blog/ai-powered-subject-line-alternatives) -- 41% eligibility, 6x slower, real-world data
- [SWyx Gemini Nano notes](https://www.swyx.io/gemini-nano) -- Community research, hardware requirements
