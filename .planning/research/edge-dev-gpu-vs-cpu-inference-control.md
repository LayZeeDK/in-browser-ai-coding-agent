# Research: GPU vs CPU Inference Control for Edge Dev Phi-4-mini and Chrome Gemini Nano

**Researched:** 2026-03-21
**Overall confidence:** HIGH (Chromium source code analysis, official Chrome/Edge docs, community sources)
**Focus:** Does `--disable-gpu` affect AI model inference? How to actually control the inference backend.

---

## Executive Summary

The `--disable-gpu` Chromium flag **does affect the AI model inference backend**, but through an indirect mechanism -- not the way one might expect. The flag disables GPU compositing and crucially **prevents WebGPU adapter creation**, which is the mechanism Chrome/Edge's on-device model service uses to access the GPU for inference. When `--disable-gpu` is set, `requestAdapter()` returns `null`, and the on-device model service falls back to CPU inference via XNNPACK (for Chrome/LiteRT-LM) or potentially ONNX Runtime CPU (for Edge).

However, **the fact that both GPU and CPU runs show identical ~15-17 minute timings on `windows-11-arm` runners** is expected and explained by a critical finding: **GitHub Actions `windows-11-arm` runners have no GPU at all**. They are CPU-only Azure VMs. This means `--disable-gpu` has no effect because there is no GPU to disable -- both configurations are already running CPU inference.

The performance parity is not evidence that `--disable-gpu` "doesn't work." It is evidence that both configurations were always using CPU inference because the runner has no GPU hardware.

---

## 1. Does `--disable-gpu` Affect AI Model Inference?

**Confidence:** HIGH (Chromium source code analysis)

### Answer: Yes, but indirectly

The `--disable-gpu` flag is primarily a **rendering pipeline flag** that disables GPU compositing, rasterization, and hardware-accelerated rendering. However, it has a cascading effect on AI model inference because:

1. **Chrome/Edge's on-device model service uses WebGPU (Dawn) for GPU inference.** The inference stack is:

   ```
   LanguageModel API -> Optimization Guide (Chrome) / Edge LLM Service (Edge)
       -> LiteRT-LM (Chrome) / ONNX Runtime (Edge)
       -> [GPU: WebGPU/Dawn/Vulkan/Metal/D3D12] OR [CPU: XNNPACK/ONNX CPU]
   ```

2. **`--disable-gpu` prevents WebGPU adapter creation.** When this flag is set, `navigator.gpu.requestAdapter()` returns `null`. Chrome still exposes the `navigator.gpu` object, but adapter creation fails because Dawn cannot initialize any GPU backend.

3. **The on-device model service checks GPU availability via `gpu_blocklist.cc`.** The Chromium source at `services/on_device_model/ml/gpu_blocklist.cc` uses `gpu::CollectBasicGraphicsInfo()` and `api.QueryGPUAdapter()` to determine GPU availability. When the adapter cannot be created (including when `--disable-gpu` is set), the service receives `GpuBlockedReason::kGpuConfigError` and falls back to CPU inference.

### The GPU blocklist mechanism (Chromium source)

From `services/on_device_model/ml/gpu_blocklist.cc` and `gpu_blocklist.h`:

```cpp
enum class GpuBlockedReason {
  kGpuConfigError = 0,      // GPU info collection failed (includes --disable-gpu)
  kBlocklisted = 1,          // GPU is on the blocklist
  kBlocklistedForCpuAdapter = 2,  // Adapter is CPU-type (SwiftShader)
  kNotBlocked = 3,           // GPU is available
};

struct DeviceInfo {
  GpuBlockedReason gpu_blocked_reason = GpuBlockedReason::kGpuConfigError;
  int32_t vendor_id = 0;
  int32_t device_id = 0;
  std::string driver_version;
  bool supports_fp16 = false;
};
```

The `QueryDeviceInfoInternal` function performs two-stage checking:

- **Stage 1:** Collects basic GPU info via `gpu::CollectBasicGraphicsInfo()` to avoid crashes during adapter creation. Checks for software renderers.
- **Stage 2:** Creates a `wgpu::Adapter` via `api.QueryGPUAdapter()` and checks it against the blocklist using `gpu::IsWebGPUAdapterBlocklisted()`.

When `--disable-gpu` is set, Stage 2 fails because the WebGPU adapter cannot be created. The `DeviceInfo` retains its default `kGpuConfigError` state, and the system falls back to CPU.

### Important: `--disable-gpu` is NOT checked explicitly

The `gpu_blocklist.cc` file does **not** contain any explicit check for the `--disable-gpu` command-line switch. Instead, the flag's effect propagates through the GPU subsystem -- it prevents GPU initialization, which prevents WebGPU adapter creation, which causes the on-device model service to detect "no GPU available" and fall back to CPU.

**Source:** [chromium/services/on_device_model/ml/gpu_blocklist.cc](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc)

---

## 2. Why Both Runs Show Identical Performance on `windows-11-arm`

**Confidence:** HIGH (GitHub Actions documentation)

### The `windows-11-arm` runner has no GPU

GitHub Actions `windows-11-arm` runners are **CPU-only Azure virtual machines**:

| Runner           | vCPU | RAM   | GPU  | DirectX 12 | DirectML |
| ---------------- | ---- | ----- | ---- | ---------- | -------- |
| `windows-11-arm` | 4    | 16 GB | None | No         | No       |

These runners are hosted on Azure Cobalt ARM64 processors (Ampere Altra). They have no GPU hardware, no DirectX 12 support, and cannot use DirectML or WebGPU for inference.

**Consequence:** Both the "GPU" and "CPU" (`--disable-gpu`) CI jobs are running CPU-only inference. The `--disable-gpu` flag has no observable effect because there is no GPU to disable. The ~15-17 minute timing is the CPU inference speed for Phi-4-mini on a 4-core ARM64 CPU.

**Source:** [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Windows ARM64 runners announcement](https://github.blog/changelog/2025-04-14-windows-arm64-hosted-runners-now-available-in-public-preview/)

---

## 3. Edge-Specific Inference Backend: ONNX Runtime, Not LiteRT-LM

**Confidence:** MEDIUM (inferred from available evidence, not officially documented)

### Critical distinction: Chrome uses LiteRT-LM, Edge uses ONNX Runtime

Chrome and Edge use **different inference runtimes** despite sharing the Chromium codebase:

| Aspect            | Chrome (Gemini Nano)                 | Edge (Phi-4-mini)       |
| ----------------- | ------------------------------------ | ----------------------- |
| Inference runtime | LiteRT-LM (TFLite)                   | ONNX Runtime (likely)   |
| GPU backend       | WebGPU via Dawn                      | DirectML (likely)       |
| CPU backend       | XNNPACK                              | ONNX Runtime CPU        |
| Model format      | LiteRT/TFLite                        | ONNX                    |
| Model delivery    | Optimization Guide Component Updater | Edge-proprietary system |
| Flag prefix       | `optimization-guide-*`               | `edge-llm-*`            |

**Evidence for ONNX Runtime in Edge:**

- Microsoft ships official [Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) models optimized for ONNX Runtime
- ONNX Runtime supports DirectML (GPU) and CPU backends on Windows ARM64
- Edge's model delivery is proprietary (not using Chrome's Optimization Guide)
- Microsoft's broader AI stack (Windows Copilot, Office) uses ONNX Runtime + DirectML
- The `edge-llm-*` flag prefix suggests an entirely separate implementation from Chrome's `optimization-guide-*` infrastructure

**Implication:** The GPU blocklist mechanism in `services/on_device_model/ml/gpu_blocklist.cc` is Chrome-specific code using LiteRT-LM/Dawn/WebGPU. Edge's Phi-4-mini inference likely uses a different code path through ONNX Runtime + DirectML. The `--disable-gpu` flag may affect Edge's inference through a different mechanism (preventing DirectML/DirectX initialization rather than WebGPU adapter creation).

---

## 4. `edge-llm-on-device-model-performance-param` Flag Options

**Confidence:** MEDIUM (partially documented)

### What the flag does

The `edge://flags` entry "Enable on device AI model performance parameters override" controls whether Edge bypasses hardware performance requirements for the on-device AI model. This is the Edge equivalent of Chrome's `optimization-guide-on-device-model@2` (BypassPerfRequirement).

### Option values

The flag ID in Local State is `edge-llm-on-device-model-performance-param@N` where `@N` is a zero-based index into the dropdown options:

| Suffix | Meaning            | Effect                                                                    |
| ------ | ------------------ | ------------------------------------------------------------------------- |
| `@0`   | Default            | Standard hardware checks apply                                            |
| `@1`   | Enabled (option 1) | Unknown specific effect                                                   |
| `@2`   | Disabled           | Explicitly disable override                                               |
| `@3`   | Enabled (option 3) | **Used in our bootstrap** -- likely "bypass all performance requirements" |

The exact meaning of `@1` vs `@3` is **not publicly documented**. The flag likely has more than the standard 3 options (Default/Enabled/Disabled), which is why `@3` is used instead of `@1`. Based on the Chrome parallel where `@2` means "Enabled BypassPerfRequirement" (a specific sub-option), `@3` in Edge likely corresponds to a specific performance override mode.

### How to discover the exact options

Navigate to `edge://flags/` in Edge Dev, search for "on device AI model performance parameters override", and inspect the dropdown. Each option corresponds to an `@N` index starting at 0.

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api), [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88)

---

## 5. `--disable-features=OnDeviceModelPerformanceParams`

**Confidence:** MEDIUM (inferred from Chromium source naming conventions)

### What it does

The `OnDeviceModelPerformanceParams` feature flag (referenced as `kOnDeviceModelPerformanceParams` in Chromium source) controls the **parameters used for device performance benchmarking and classification**. This is the server-side experimentation system that defines:

- GPU VRAM thresholds
- Performance class cutoffs
- GPU blocklist entries (the `"on_device_model_gpu_block_list"` is a parameter of this feature)
- Other hardware requirement thresholds

### Effect of disabling it

`--disable-features=OnDeviceModelPerformanceParams` disables the field trial parameters that gate performance requirements. This is **separate from `BypassPerfRequirement`**:

| Mechanism                                           | What it does                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `BypassPerfRequirement` (flag)                      | Skips the performance check entirely                                                  |
| `--disable-features=OnDeviceModelPerformanceParams` | Disables the server-defined parameters, causing Chrome/Edge to use hardcoded defaults |

In practice, both may result in the model being downloadable on hardware that would otherwise be rejected, but they work through different mechanisms. The `--disable-features` approach is more likely to allow correct automatic backend selection (GPU vs CPU) because it only removes server-side parameter overrides rather than bypassing the check entirely.

**Source:** [Chromium source: gpu_blocklist.cc references kOnDeviceModelPerformanceParams](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc)

---

## 6. Verification: How to Check Which Backend Is Active

**Confidence:** HIGH (official documentation)

### Chrome: `chrome://on-device-internals`

Navigate to `chrome://on-device-internals` and select the **Model Status** tab. This page shows:

- Model download status and version
- Device performance class
- Backend type information (GPU vs CPU)
- Model size

Chrome's backend decision follows this logic (Chrome 140+):

1. Run GPU performance shader test
2. If GPU VRAM > 4 GB: use GPU backend
3. If GPU fails but RAM >= 16 GB and cores >= 4: use CPU backend (XNNPACK)
4. Otherwise: model not available

### Edge: `edge://on-device-internals`

Navigate to `edge://on-device-internals`. This page shows:

- **Device performance class** -- values like "High", "Medium", "Low"
- Model download and readiness status
- Model version information

If the device performance class is **"High" or greater**, the Prompt API should be supported. The performance class is derived from hardware capabilities including GPU VRAM.

### Programmatic verification in CI

Neither Chrome nor Edge exposes the backend type via JavaScript. However, you can scrape the internal pages via Playwright:

```javascript
// For Chrome
await page.goto('chrome://on-device-internals');
await page.waitForTimeout(3000);
const content = await page.content();
console.log('=== on-device-internals ===');
console.log(content.substring(0, 10000));

// For Edge
await page.goto('edge://on-device-internals');
await page.waitForTimeout(3000);
const content = await page.content();
console.log('=== on-device-internals ===');
console.log(content.substring(0, 10000));
```

### GPU status pages

Additionally, `chrome://gpu` and `edge://gpu` show:

- WebGPU status (Hardware accelerated / Software only / Disabled)
- GPU driver information
- Feature status for GPU compositing, rasterization, video decode, etc.

When `--disable-gpu` is active, all GPU features will show "Disabled" or "Software only".

### Debug logging

Enable "Enable on device AI model debug logs" flag to get verbose logging about backend selection and inference. For Edge, this is the `edge://flags` entry "Enable on device AI model debug logs".

**Source:** [Chrome AI: Understand built-in model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management), [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

---

## 7. The `kOnDeviceModelAllowGpuForTesting` Feature Flag

**Confidence:** HIGH (Chromium source code)

### What it does

This Chromium feature flag (`BASE_FEATURE(kOnDeviceModelAllowGpuForTesting, base::FEATURE_DISABLED_BY_DEFAULT)`) is a **testing override** that bypasses the GPU blocklist entirely for Chrome's on-device model service.

When enabled, `QueryDeviceInfo` returns:

- `gpu_blocked_reason = GpuBlockedReason::kNotBlocked`
- `supports_fp16 = true`

This tells the inference engine that a capable GPU is available regardless of actual hardware. **This is dangerous in a no-GPU environment** -- it would cause the inference engine to attempt GPU execution and crash.

### How to enable

```
--enable-features=OnDeviceModelAllowGpuForTesting
```

### Relevance to CI

This flag is **not useful for forcing CPU inference**. It does the opposite -- it forces the system to believe GPU is available. It exists for Chromium's own test infrastructure where GPU is available but might be blocklisted.

**Source:** [chromium/services/on_device_model/ml/gpu_blocklist.cc](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc)

---

## 8. LiteRT-LM Backend Selection (Open Source)

**Confidence:** HIGH (official LiteRT-LM documentation)

### Command-line backend selection

The open-source LiteRT-LM framework provides explicit backend control:

```bash
# Force CPU backend
litert_lm_main --backend=cpu --model_path=$MODEL_PATH --input_prompt="test"

# Force GPU backend
litert_lm_main --backend=gpu --model_path=$MODEL_PATH --input_prompt="test"

# Using the lit CLI
lit run gemma3-1b --backend=cpu
```

### Automatic selection

When no `--backend` flag is provided, LiteRT-LM uses automatic hardware selection via the CompiledModel API. Priority order: NPU > GPU > CPU, with built-in fallback.

### Chrome does NOT expose this control

Chrome's embedded LiteRT-LM runtime does **not** expose the `--backend` flag to users. The backend selection is automatic and controlled by Chrome's GPU performance shader test and the device performance class system. There is no command-line flag to force CPU inference through the LiteRT-LM layer.

The only way to force CPU inference in Chrome is:

1. Remove the GPU (not applicable in CI)
2. Use `--disable-gpu` to prevent WebGPU adapter creation (indirect)
3. Let Chrome auto-detect no-GPU and select CPU (recommended by Chromium team)
4. Use `BypassPerfRequirement` carefully (may cause incorrect backend selection)

**Source:** [LiteRT-LM CLI documentation](https://deepwiki.com/google-ai-edge/LiteRT-LM/2.1-cli-usage-and-examples), [LiteRT-LM GitHub](https://github.com/google-ai-edge/LiteRT-LM)

---

## 9. Concrete Recommendations for This Project

### For `windows-11-arm` runners (Edge Dev)

**Problem:** No GPU exists on the runner. Both GPU and CPU configurations run identical CPU inference.

**Recommendations:**

1. **Remove the `disable-gpu: true` matrix variant.** It adds no value since both variants use CPU inference. The `--disable-gpu` flag only adds risk (it may prevent Edge from properly initializing its rendering pipeline, which could affect model loading).

2. **Remove `CI_DISABLE_GPU` environment variable and related `extraArgs` logic** from `vitest.config.mts` and `fixtures.ts`. It is dead code on GPU-less runners.

3. **Add a diagnostic step** to the CI workflow that navigates to `edge://on-device-internals` and captures the Device Performance Class and any backend information:

   ```yaml
   - name: Diagnostic - Edge on-device internals
     run: |
       node -e "
         const { chromium } = require('playwright');
         (async () => {
           const ctx = await chromium.launchPersistentContext(
             '.playwright-profiles/msedge-dev',
             { channel: 'msedge-dev', headless: false,
               args: ['--enable-features=AIPromptAPI', '--disable-features=OnDeviceModelPerformanceParams'],
               ignoreDefaultArgs: ['--disable-field-trial-config', '--disable-background-networking', '--disable-component-update'] }
           );
           const page = ctx.pages()[0] || await ctx.newPage();
           await page.goto('edge://on-device-internals');
           await page.waitForTimeout(5000);
           console.log(await page.content());
           await page.goto('edge://gpu');
           await page.waitForTimeout(3000);
           console.log(await page.content());
           await ctx.close();
         })();
       "
   ```

4. **Keep the performance override flag** (`edge-llm-on-device-model-performance-param@3`) in the Local State. Since the runner has no GPU and only 16 GB RAM, this override is needed to convince Edge the device is capable enough for CPU-only inference.

### For Chrome on `ubuntu-latest` (Docker container)

**Problem:** The `BypassPerfRequirement` flag may cause Chrome to select GPU backend on a no-GPU machine.

**Recommendations:**

1. **Change `optimization-guide-on-device-model@2` to `@1`** (Enabled, without BypassPerfRequirement). Let Chrome's auto-detection select CPU.

2. If `@1` still causes download eligibility issues, keep `@2` but add `--disable-gpu` to ensure the WebGPU adapter cannot be created, forcing CPU fallback.

3. Add a diagnostic step to capture `chrome://on-device-internals` content showing the backend type.

### For both browsers

**Add `edge://gpu` / `chrome://gpu` diagnostic step** early in CI to confirm GPU status. This is the definitive way to verify whether GPU acceleration is available:

```yaml
- name: Diagnostic - GPU status
  run: |
    # Script that navigates to chrome://gpu or edge://gpu and logs WebGPU status
```

---

## 10. Summary: What Controls What

| Mechanism                                           | Scope                       | Effect on AI Inference                                            | Confidence |
| --------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- | ---------- |
| `--disable-gpu`                                     | Chromium rendering + WebGPU | **YES** -- prevents WebGPU adapter creation, forces CPU fallback  | HIGH       |
| `optimization-guide-on-device-model@2`              | Chrome flag                 | Bypasses perf check; may incorrectly select GPU on no-GPU machine | HIGH       |
| `edge-llm-on-device-model-performance-param@3`      | Edge flag                   | Bypasses Edge's hardware requirements                             | MEDIUM     |
| `--disable-features=OnDeviceModelPerformanceParams` | Feature flag                | Disables server-defined perf params, uses defaults                | MEDIUM     |
| `--enable-features=OnDeviceModelAllowGpuForTesting` | Chromium testing flag       | Forces "GPU available" -- **dangerous on no-GPU machines**        | HIGH       |
| `--use-webgpu-adapter=swiftshader`                  | WebGPU flag                 | Forces software GPU rendering (slow but functional)               | HIGH       |
| No GPU hardware on runner                           | Hardware                    | Forces CPU inference automatically (no flag needed)               | HIGH       |

---

## Sources

### Official Documentation (HIGH confidence)

- [Chrome AI: Understand built-in model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management) -- Backend selection logic, performance classes
- [Chrome AI: Get Started](https://developer.chrome.com/docs/ai/get-started) -- Hardware requirements (GPU/CPU)
- [Chrome AI: CPU support blog](https://developer.chrome.com/blog/gemini-nano-cpu-support) -- CPU inference announcement (Chrome 140)
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Edge hardware requirements, `edge://on-device-internals`
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- Runner specs (no GPU on standard runners)
- [Windows ARM64 runners announcement](https://github.blog/changelog/2025-04-14-windows-arm64-hosted-runners-now-available-in-public-preview/)

### Chromium Source Code (HIGH confidence)

- [services/on_device_model/ml/gpu_blocklist.cc](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc) -- GPU blocklist, `kOnDeviceModelAllowGpuForTesting`, `DeviceInfo`, `GpuBlockedReason`
- [chrome/browser/resources/on_device_internals](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/on_device_internals/) -- on-device-internals page source

### LiteRT-LM / ONNX Runtime (HIGH confidence)

- [LiteRT-LM GitHub](https://github.com/google-ai-edge/LiteRT-LM) -- Open-source inference framework, `--backend` flag
- [LiteRT-LM CLI docs](https://deepwiki.com/google-ai-edge/LiteRT-LM/2.1-cli-usage-and-examples) -- Backend selection examples
- [Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) -- ONNX model for Edge
- [ONNX Runtime blogs](https://onnxruntime.ai/blogs.html) -- DirectML, CPU backends

### Community / Discussion (MEDIUM confidence)

- [Chrome AI dev group: Backend Type mismatch](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE) -- GPU selected on no-GPU machine
- [Chrome AI dev group: UnknownError](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I) -- Generic error causes
- [Chromium discuss: GPU process with --disable-gpu](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/IIQeveVRLVE) -- GPU process still runs
- [WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) -- WebGPU disabled scenarios
- [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88) -- Edge flag identifiers
- [WindowsLatest: Edge Phi-4 mini](https://www.windowslatest.com/2025/05/19/microsoft-edge-could-integrate-phi-4-mini-to-enable-on-device-ai-on-windows-11/) -- Edge flag names
