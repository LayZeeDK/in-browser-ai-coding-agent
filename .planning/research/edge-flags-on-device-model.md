# Edge Dev Flags for On-Device AI Model Performance (Phi-4 Mini)

**Researched:** 2026-03-22
**Overall confidence:** MEDIUM -- Edge's Phi-4 Mini integration is experimental and proprietary. Flag internals are not publicly documented. Findings are compiled from official Microsoft docs, the AskVG flag guide, zoicware/RemoveWindowsAI issue #88, Chromium source code analysis, and ONNX Runtime documentation. Edge-specific flag semantics are partially inferred.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Complete List of edge-llm Flags](#2-complete-list-of-edge-llm-flags)
3. [The Performance Parameter Flag In Depth](#3-the-performance-parameter-flag-in-depth)
4. [ONNX Runtime Execution Provider Control](#4-onnx-runtime-execution-provider-control)
5. [Model Quantization and Variant Control](#5-model-quantization-and-variant-control)
6. [Model Compilation and Optimization Phase](#6-model-compilation-and-optimization-phase)
7. [Model Download and Caching Behavior](#7-model-download-and-caching-behavior)
8. [WebNN Flags and CPU Backend](#8-webnn-flags-and-cpu-backend)
9. [GPU Blocked Performance Class](#9-gpu-blocked-performance-class)
10. [Debug Logging Flag](#10-debug-logging-flag)
11. [Flags vs Command-Line Features](#11-flags-vs-command-line-features)
12. [Recommendations for This Project](#12-recommendations-for-this-project)
13. [Open Questions](#13-open-questions)

---

## 1. Executive Summary

Microsoft Edge Dev exposes a set of `edge-llm-*` flags in `edge://flags` to control the on-device Phi-4 Mini integration. These flags are **completely separate** from Chrome's `optimization-guide-*` flags -- they control a different model, different inference runtime (ONNX Runtime vs LiteRT), and different model delivery system.

**Key findings:**

1. **There are exactly 6 known `edge-llm-*` flags** plus one additional "debug logs" flag. No hidden flags exist for controlling ONNX Runtime execution provider selection, quantization level, or compilation behavior.

2. **`edge-llm-on-device-model-performance-param` has at least 4 dropdown options** (`@0` through `@3`). The exact semantics of each value are not publicly documented. The `@3` value used in this project bypasses performance requirements. Changing this value **will not speed up inference** -- it only controls the hardware eligibility check.

3. **There are NO flags to control ONNX Runtime EP selection.** Edge's ONNX Runtime is embedded as a black box. The CPU/DirectML EP selection happens automatically based on hardware detection. No flag, environment variable, or command-line switch can force a specific EP.

4. **There are NO flags to control model quantization.** Edge downloads a single model variant. The quantization level (INT4) is fixed by Microsoft's model delivery pipeline.

5. **The "GPU blocked" performance class on the CI runner is expected and harmless.** It means DirectML cannot initialize (no DirectX 12 GPU), so ONNX Runtime cleanly falls back to CPU. This is the desired behavior.

6. **The 23+ minute first inference is not flag-fixable.** It is caused by ONNX Runtime graph optimization and model compilation on weak hardware (4 vCPU ARM64, 16 GB RAM). Only profile caching (preserving `adapter_cache.bin` and `encoder_cache.bin`) can mitigate this.

---

## 2. Complete List of edge-llm Flags

**Confidence:** HIGH (confirmed via AskVG article, zoicware/RemoveWindowsAI#88, and official Microsoft Edge Prompt API docs)

These are all the `edge-llm-*` flags available in `edge://flags`, verified in Edge 139+:

### API Flags

| Flag ID in edge://flags                    | Flag ID in Local State                    | UI Name                            | Description                                                                                                                         | Default State           |
| ------------------------------------------ | ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `#edge-llm-prompt-api-for-phi-mini`        | `edge-llm-prompt-api-for-phi-mini`        | **Prompt API for Phi mini**        | Enables the exploratory Prompt API, allowing you to run natural language processing tasks by prompting the Phi-mini language model. | Enabled (from Edge 139) |
| `#edge-llm-summarization-api-for-phi-mini` | `edge-llm-summarization-api-for-phi-mini` | **Summarization API for Phi mini** | Enables the Summarization API, allowing you to summarize text with Phi-mini.                                                        | Enabled (from Edge 139) |
| `#edge-llm-writer-api-for-phi-mini`        | `edge-llm-writer-api-for-phi-mini`        | **Writer API for Phi mini**        | Enables the Writer API, allowing you to write text with Phi-mini.                                                                   | Default                 |
| `#edge-llm-rewriter-api-for-phi-mini`      | `edge-llm-rewriter-api-for-phi-mini`      | **Rewriter API for Phi mini**      | Enables the Rewriter API, allowing you to rewrite text with Phi-mini.                                                               | Default                 |

### Configuration Flags

| Flag ID in edge://flags                       | Flag ID in Local State                       | UI Name                                                       | Description                                                         | Default State |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------- |
| `#edge-llm-on-device-model-performance-param` | `edge-llm-on-device-model-performance-param` | **Enable on device AI model performance parameters override** | Bypasses hardware performance requirements for the on-device model. | Default       |

### Debug Flag

| Flag ID in edge://flags | Flag ID in Local State | UI Name                                  | Description                                              | Default State |
| ----------------------- | ---------------------- | ---------------------------------------- | -------------------------------------------------------- | ------------- |
| (name not confirmed)    | (name not confirmed)   | **Enable on device AI model debug logs** | Enables debug logging for on-device AI model operations. | Default       |

### Dropdown Options for Standard API Flags

All API flags have 3 options:

| Suffix | Meaning  | Local State                          |
| ------ | -------- | ------------------------------------ |
| `@0`   | Default  | `edge-llm-prompt-api-for-phi-mini@0` |
| `@1`   | Enabled  | `edge-llm-prompt-api-for-phi-mini@1` |
| `@2`   | Disabled | `edge-llm-prompt-api-for-phi-mini@2` |

### Platform Support Label

All flags show "Mac, Windows, Linux" as supported platforms in the edge://flags UI. However, the actual model download and inference only works on **Windows 10/11 and macOS 13.3+**. Linux shows the flag but the model delivery system does not function.

**Sources:**

- [AskVG: Disable Phi-4-Mini in Edge](https://www.askvg.com/tip-disable-phi-4-mini-and-new-web-ai-apis-in-microsoft-edge/)
- [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88)
- [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

---

## 3. The Performance Parameter Flag In Depth

**Confidence:** MEDIUM -- the dropdown options are not publicly documented. Semantics are inferred from behavior, Chromium naming conventions, and community reports.

### Flag: `edge-llm-on-device-model-performance-param`

**UI Name:** "Enable on device AI model performance parameters override"

### Dropdown Options

The flag has **4 or more** dropdown options (at least `@0` through `@3`). The exact number can only be verified by inspecting the flag UI in Edge Dev.

| Suffix | Inferred Meaning                                                                          | Evidence                                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@0`   | **Default** -- Standard hardware checks apply                                             | Standard Chromium flag convention: `@0` is always Default                                                                                                                  |
| `@1`   | **Enabled (relaxed)** -- Possibly reduces performance threshold but still checks hardware | Chrome's equivalent `optimization-guide-on-device-model@1` means "Enabled" (standard mode with performance checks). Edge likely follows a similar pattern                  |
| `@2`   | **Disabled** -- Explicitly disable override (same as Default)                             | Standard Chromium convention: `@2` is often Disabled for 3-option flags. However, for flags with 4+ options, `@2` may be a named variant                                   |
| `@3`   | **Enabled (bypass all)** -- Bypasses ALL performance requirements                         | Used in this project. The zoicware/RemoveWindowsAI#88 uses `@3` to "disable performance check." Community reports confirm it bypasses hardware eligibility checks entirely |

### What the Performance Override Actually Controls

The performance parameter override controls **whether Edge performs a hardware eligibility check** before allowing the model to be used. It does NOT control:

- ONNX Runtime session options
- Graph optimization level
- Thread count or parallelism
- Execution provider selection (CPU vs DirectML)
- Model variant or quantization
- Inference speed or cold-start time

When the performance check is bypassed (`@3`):

1. Edge skips the GPU VRAM check (normally requires 5.5 GB)
2. Edge skips the device performance class validation
3. The model becomes "available" regardless of hardware capability
4. If the hardware is truly insufficient, inference may fail at runtime (e.g., OOM crash, extremely slow performance)

### The `--disable-features=OnDeviceModelPerformanceParams` Complement

The project also uses `--disable-features=OnDeviceModelPerformanceParams` as a command-line argument. This is a **separate mechanism** from the flag:

| Mechanism                                           | What It Does                                                                                                  | Scope                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| `edge-llm-on-device-model-performance-param@3`      | Bypasses Edge's performance eligibility check via Local State                                                 | Persisted in profile |
| `--disable-features=OnDeviceModelPerformanceParams` | Disables the server-delivered performance parameters feature entirely, forcing Edge to use hardcoded defaults | Per-launch only      |

Using both simultaneously (as this project does) is a belt-and-suspenders approach. The flag in Local State ensures the check is bypassed even if the command-line argument is missing. The command-line argument ensures the server-delivered parameters (which may define GPU blocklists, VRAM thresholds, etc.) do not interfere.

### Could a Different @N Value Speed Up Inference?

**No.** The performance parameter flag only controls the eligibility gate -- "is this device allowed to use the model?" Once the model is accessible, the inference performance depends on:

1. Hardware (CPU cores, memory bandwidth, storage I/O)
2. ONNX Runtime internal session options (not configurable)
3. Cached inference artifacts (adapter_cache.bin, encoder_cache.bin)

None of these are affected by the performance parameter flag value.

**Source:** [edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md) (prior research), [Chromium flags documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/configuration.md)

---

## 4. ONNX Runtime Execution Provider Control

**Confidence:** HIGH -- confirmed by Chromium source analysis and empirical testing on the windows-11-arm runner.

### Answer: There Are NO Flags to Control EP Selection in Edge

Edge's embedded ONNX Runtime (downloaded as `onnxruntime.dll` + `onnxruntime-genai.dll` into the profile) manages execution provider selection internally. There is no:

- Edge flag to force CPU EP
- Edge flag to force DirectML EP
- Environment variable (no `ORT_DISABLE_GPU`, `ORT_USE_CPU_ONLY`, `ORT_COREML_COMPUTE_UNITS`)
- Command-line switch
- Registry key
- `genai_config.json` setting (this file is not user-accessible in Edge's profile)

### How EP Selection Works in Edge

```
Edge LLM Service starts
    |
    v
ONNX Runtime initializes with configured EPs
    |
    +-> DirectML EP: Attempts to initialize DirectX 12
    |   |
    |   +-> GPU found with DX12 support? -> Use DirectML EP
    |   +-> No GPU / No DX12? -> Fail, fall back to next EP
    |
    +-> CPU EP: Always available as fallback
        |
        +-> Use MLAS backend (NEON/SVE2 on ARM64)
```

### On the windows-11-arm CI Runner

The runner has **no GPU hardware at all** (Azure Cobalt 100 ARM64 VM). DirectML EP fails to initialize because there is no DirectX 12 device. ONNX Runtime cleanly falls back to the CPU EP with MLAS backend.

This is the **desired behavior** for this project. The clean GPU absence means:

- No risk of partial GPU initialization (unlike macOS where an inadequate GPU exists)
- No risk of incorrect EP selection
- No need for `--disable-gpu` (it has no effect since there is no GPU path in Edge's ONNX Runtime)

### The `--disable-gpu` Flag Does NOT Help

As documented in [edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md):

`--disable-gpu` affects Chromium's **renderer GPU pipeline** (compositing, WebGPU, WebGL). It does NOT affect Edge's ONNX Runtime, which uses a completely separate DX12/DirectML pipeline for ML inference. The two GPU paths are architecturally independent:

1. **Chromium renderer GPU path:** Controlled by `--disable-gpu`
2. **Edge ML inference GPU path:** NOT controlled by any Chromium flag

**Source:** [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md), [edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md)

---

## 5. Model Quantization and Variant Control

**Confidence:** HIGH -- official Phi-4-mini-instruct-onnx model card + Edge Prompt API documentation.

### Answer: There Is No Flag to Control Quantization Level

Edge downloads a **single model variant** through its proprietary model delivery system. The model is:

| Property        | Value               | Source                                                                              |
| --------------- | ------------------- | ----------------------------------------------------------------------------------- |
| Model           | Phi-4-mini-instruct | [HuggingFace model card](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) |
| Format          | ONNX                | Profile directory inspection                                                        |
| Quantization    | INT4 (RTN block-32) | Consistent with the `cpu-int4-rtn-block-32-acc-level-4` variant in the ONNX repo    |
| Model data size | ~4.86 GB            | Profile directory inspection                                                        |
| Tokenizer size  | ~15.5 MB            | Profile directory inspection                                                        |
| Parameters      | 3.8 billion         | Official Microsoft documentation                                                    |

### Available ONNX Variants (Not User-Selectable in Edge)

The public [microsoft/Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) repository offers multiple variants:

| Variant                             | Target         | Quantization | Model Size | Performance                 |
| ----------------------------------- | -------------- | ------------ | ---------- | --------------------------- |
| `cpu-int4-rtn-block-32-acc-level-4` | CPU & Mobile   | INT4         | ~4.86 GB   | Optimized for CPU inference |
| `gpu-int4-rtn-block-32`             | GPU (CUDA/DML) | INT4         | ~4.86 GB   | Optimized for GPU inference |
| Full precision                      | Any            | FP16/FP32    | ~7.6 GB    | Highest quality, slowest    |

A smaller quantized variant (e.g., INT4 with more aggressive quantization, or a distilled model like Phi-4-mini-flash-reasoning) **could** be faster on weak hardware. However:

1. Edge does not expose a model selection mechanism
2. The model is delivered by Edge's component updater, not user-configurable
3. You cannot replace the model in the profile directory -- Edge verifies model integrity

### Would a Different Quantization Be Faster?

In theory, yes. The INT8-INT4 hybrid variant used by ExecuTorch achieves 17.3 tokens/sec on iPhone 15 Pro with ~3.2 GB memory. A more aggressively quantized or distilled model could reduce cold-start time by reducing the model size to deserialize and the computation required for graph optimization.

But this is not actionable -- Edge controls the model variant selection entirely.

**Source:** [microsoft/Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx), [pytorch/Phi-4-mini-instruct-INT8-INT4](https://huggingface.co/pytorch/Phi-4-mini-instruct-INT8-INT4)

---

## 6. Model Compilation and Optimization Phase

**Confidence:** HIGH -- ONNX Runtime documentation + empirical observation.

### Answer: There Is No Flag to Enable/Disable the Compilation Phase

Edge's embedded ONNX Runtime applies graph optimizations during session creation. This is the "online mode" described in [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html). The compilation includes:

1. **Constant folding** -- pre-compute parts of the graph with known inputs
2. **Redundant node elimination** -- remove duplicate computations
3. **Operator fusion** -- merge multiple operators into single optimized kernels (attention fusion, GELU fusion, LayerNorm fusion)
4. **Layout transformation** -- optimize memory layout for the target EP (NCHW to NCHWc, weight pre-packing)
5. **MLAS kernel dispatch** -- select appropriate INT4 dequantization kernels for ARM64 (NEON/SVE2)

### The Compilation Is the Primary Cold-Start Bottleneck

Based on the detailed analysis in [phi4-mini-arm64-cold-start.md](phi4-mini-arm64-cold-start.md), the graph optimization phase (Steps 1-4 above) accounts for an estimated 10-15 minutes of the 23+ minute cold-start on the 4-core CI runner. This is:

- **Predominantly single-threaded** -- graph traversal and pattern matching cannot be parallelized
- **Hardware-dependent** -- the Neoverse N2 core has ~40-50% lower single-thread performance than the Snapdragon X Elite's Oryon cores
- **Model-size dependent** -- a 3.8B parameter model has thousands of graph nodes

### How Edge Caches Compilation Results

After the first successful inference, Edge writes `adapter_cache.bin` and `encoder_cache.bin` to the profile directory. These files likely contain:

- Serialized optimized graph fragments
- Pre-compiled MLAS kernel configurations
- Pre-computed weight projections for INT4 dequantization
- EP-specific execution plans

On subsequent runs, Edge loads these cache files instead of re-running the optimization passes. This reduces session creation from 10-15 minutes to seconds.

### No External Control Over Optimization Level

In the ONNX Runtime programmatic API, you can control graph optimization via `SessionOptions.graph_optimization_level`:

| Level | Name                  | Effect                                                          |
| ----- | --------------------- | --------------------------------------------------------------- |
| 0     | `ORT_DISABLE_ALL`     | No optimizations -- fastest session creation, slowest inference |
| 1     | `ORT_ENABLE_BASIC`    | Constant folding, redundant node elimination only               |
| 2     | `ORT_ENABLE_EXTENDED` | Add complex node fusions (attention, GELU, etc.)                |
| 3     | `ORT_ENABLE_ALL`      | Full optimizations including layout transforms                  |

Edge likely uses Level 3 (ORT_ENABLE_ALL). There is no way to override this. Setting it to Level 0 would make session creation instant but inference 2-5x slower.

**Source:** [onnx-runtime-arm64-cold-start.md](onnx-runtime-arm64-cold-start.md), [phi4-mini-arm64-cold-start.md](phi4-mini-arm64-cold-start.md), [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)

---

## 7. Model Download and Caching Behavior

**Confidence:** MEDIUM-HIGH

### Model Delivery Mechanism

Edge uses a proprietary model delivery system (not Chrome's Optimization Guide Component Updater):

1. **First API call triggers download.** The model is not pre-installed with Edge. The first time any built-in AI API is called (`LanguageModel.create()`, Summarizer, Writer, Rewriter), Edge downloads the model.

2. **Shared across all domains.** Once downloaded, the model is shared across all websites and extensions using the LanguageModel API.

3. **Storage requirements.** At least 20 GB free on the Edge profile volume. If free space drops below 10 GB, Edge deletes the model automatically.

4. **Metered connection check.** The model is NOT downloaded on metered connections. CI runners typically have unmetered connections, so this is not an issue.

### What Gets Downloaded

| Component               | Destination             | Size        | Purpose                        |
| ----------------------- | ----------------------- | ----------- | ------------------------------ |
| `onnxruntime.dll`       | `EdgeLLMOnDeviceModel/` | ~100-200 MB | ONNX Runtime inference library |
| `onnxruntime-genai.dll` | `EdgeLLMOnDeviceModel/` | ~20-50 MB   | GenAI extension library        |
| `model.onnx.data`       | `EdgeLLMOnDeviceModel/` | ~4.86 GB    | Model weights                  |
| Tokenizer files         | `EdgeLLMOnDeviceModel/` | ~15.5 MB    | Vocabulary and configuration   |
| Model metadata          | `EdgeLLMOnDeviceModel/` | Small       | Version info, configuration    |

### Can We Force a Specific Model Variant?

**No.** There is no:

- Flag to select between model variants (INT4 CPU, INT4 GPU, FP16, etc.)
- Command-line argument to specify a model path
- Environment variable to override the model URL
- `genai_config.json` that is user-accessible

The model variant is determined by Edge's delivery system based on:

- Edge version
- Platform (Windows/macOS)
- Possibly hardware profile (GPU VRAM, performance class)

### Enterprise Policy Control

The `GenAILocalFoundationalModelSettings` policy (registry DWORD) controls model availability:

| Value          | Effect                                             |
| -------------- | -------------------------------------------------- |
| 0 (or not set) | Model downloads automatically when API is used     |
| 1              | Model is NOT downloaded; existing model is deleted |

Registry paths:

- Per-machine: `HKLM\SOFTWARE\Policies\Microsoft\Edge\GenAILocalFoundationalModelSettings`
- Per-user: `HKCU\SOFTWARE\Policies\Microsoft\Edge\GenAILocalFoundationalModelSettings`

### Profile Caching Strategy for CI

The correct caching strategy (already implemented in this project):

1. **Cache the entire profile directory** (`EdgeLLMOnDeviceModel/`) including runtime DLLs, model weights, tokenizer, AND inference artifacts
2. **Save cache post-test** (not post-bootstrap) to capture `adapter_cache.bin` and `encoder_cache.bin`
3. **Use a version-aware cache key** to invalidate when Edge Dev updates the runtime or model

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api), [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md)

---

## 8. WebNN Flags and CPU Backend

**Confidence:** MEDIUM-HIGH

### WebNN Is a Separate API from the LanguageModel API

WebNN (Web Neural Network API) is a general-purpose neural network inference API that runs through the browser. The LanguageModel API (Prompt API) is a higher-level API that wraps a specific built-in model. They are **architecturally independent**:

```
LanguageModel API (Prompt API)         WebNN API
    |                                      |
    v                                      v
Edge LLM Service (proprietary)         WebNN implementation
    |                                      |
    v                                      v
ONNX Runtime (onnxruntime.dll)         DirectML / CPU backend
    |
    v
CPU EP or DirectML EP
```

Enabling WebNN flags **will NOT affect** the LanguageModel API's inference path. They are completely separate stacks.

### Available WebNN Flags

| Flag                                              | Description                                   | Relevance to Phi-4 Mini                                               |
| ------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `#enable-web-machine-learning-neural-network-api` | Enables the WebNN API                         | **None** -- does not affect LanguageModel API                         |
| `--disable_webnn_for_npu=0`                       | Enables WebNN NPU backend (command-line only) | **None** -- NPU is not used by LanguageModel API even on Copilot+ PCs |

### WebNN CPU Backend

WebNN supports `deviceType: 'cpu'`, `'gpu'`, and `'npu'` when creating an `MLContext`. The CPU backend would allow running custom ONNX models in the browser via WebNN. However:

1. The LanguageModel API does NOT use WebNN internally
2. WebNN is for custom models deployed by web developers, not for the built-in Phi-4 Mini
3. Enabling WebNN flags has no effect on the built-in model's performance

### Could WebNN Be Used as an Alternative?

In theory, a web developer could use ONNX Runtime Web + WebNN to run their own Phi-4 Mini model in the browser, bypassing Edge's built-in model. This would give full control over:

- Execution provider selection (CPU, GPU, NPU)
- Model variant and quantization
- Session options and graph optimization level

However, this would mean downloading and managing the model independently, losing the benefits of Edge's shared model cache.

**Source:** [WebNN Overview (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/ai/directml/webnn-overview), [ONNX Runtime WebNN EP docs](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)

---

## 9. GPU Blocked Performance Class

**Confidence:** HIGH -- confirmed by Chromium source code analysis and empirical CI observation.

### What "GPU Blocked" Means on the CI Runner

The `edge://on-device-internals` page shows "Device performance class" information. On the `windows-11-arm` CI runner, this reports something equivalent to "GPU blocked" because:

1. No DirectX 12 GPU hardware exists on the Azure Cobalt 100 VM
2. DirectML EP cannot initialize
3. Edge's performance classification system detects this as a "GPU blocked" state

### Chromium's Performance Class System

From Chromium source (`services/on_device_model/public/cpp/service_client.h`), the `ServiceDisconnectReason` enum includes:

| Value | Name                   | Meaning                                   |
| ----- | ---------------------- | ----------------------------------------- |
| 0     | `kUnspecified`         | Unknown reason (service crash)            |
| 1     | `kGpuBlocked`          | The device's GPU is unsupported           |
| 2     | `kFailedToLoadLibrary` | The chrome_ml library could not be loaded |

Additionally, the `GpuBlockedReason` enum in `gpu_blocklist.cc` (Chrome-specific, may differ in Edge):

| Value                       | Name                | Meaning                                                        |
| --------------------------- | ------------------- | -------------------------------------------------------------- |
| `kNotBlocked`               | GPU is available    | GPU inference can proceed                                      |
| `kBlocklisted`              | GPU is on blocklist | Known-bad GPU/driver combination                               |
| `kBlocklistedForCpuAdapter` | CPU adapter type    | SwiftShader or software renderer detected                      |
| `kGpuConfigError`           | GPU config error    | GPU subsystem failed to initialize (includes no-GPU scenarios) |

### Does "GPU Blocked" Prevent Optimizations?

**No.** "GPU blocked" does not prevent the model from working. It only means:

1. DirectML EP is unavailable (expected -- no GPU)
2. ONNX Runtime falls back to CPU EP (desired behavior)
3. Edge classifies the device as potentially below the performance threshold

The `edge-llm-on-device-model-performance-param@3` flag overrides the performance class check, allowing the model to be used despite the "GPU blocked" classification. This is why the model works on the CI runner.

### Can the "GPU Blocked" State Be Overridden?

The performance class (the hardware assessment) itself **cannot be overridden** -- Edge will always detect that no GPU exists. What CAN be overridden is the **eligibility decision based on the performance class**. That is exactly what `@3` does: it says "use the model regardless of what the performance class reports."

### The Performance Class Does NOT Affect Inference Speed

Once the eligibility check is bypassed and the model is available, the performance class has no runtime effect. It does not:

- Change thread count
- Change graph optimization level
- Disable/enable any optimization pass
- Select a different model variant
- Change ONNX Runtime session options

**Source:** [Chromium gpu_blocklist.cc](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc), [Chromium commit 66ea717c](https://chromium.googlesource.com/chromium/src/+/66ea717c10bd41b8aeb2c0197561e33b55e0e7d6%5E!/)

---

## 10. Debug Logging Flag

**Confidence:** MEDIUM -- the flag exists but its exact output format and log location are not documented.

### Flag: "Enable on device AI model debug logs"

This flag appears in `edge://flags` when searching for "debug logs" or "on device AI." Per the official Microsoft Edge Prompt API documentation:

> "Optionally, to log information locally that may be useful for debugging issues, also enable the Enable on device AI model debug logs flag."

### What It May Log

Based on ONNX Runtime's debugging capabilities and the flag description, it likely logs:

- Model loading status and timings
- EP selection decisions (which EP was chosen and why)
- Graph optimization progress
- Session creation events
- Inference request/response timings
- Cache hit/miss information for adapter_cache.bin and encoder_cache.bin
- Error details for model failures

### How to Access Logs

The log location is not documented. Possibilities:

- Browser console (`edge://inspect`) -- unlikely for native ONNX Runtime logs
- Windows Event Log
- A log file in the Edge profile directory
- Debug output visible via `--enable-logging --v=1` command-line flags

### Recommendation for CI

**Enable this flag in the bootstrap script** to capture diagnostics during the warm-up phase. Add the flag to the Local State seeding:

```javascript
flags: [
  'edge-llm-prompt-api-for-phi-mini@1',
  'edge-llm-on-device-model-performance-param@3',
  // Add debug logging flag (exact Local State ID needs verification)
  // 'edge-llm-on-device-model-debug-logs@1',  // verify this ID first
],
```

The exact Local State flag ID needs to be verified by inspecting `edge://flags` -- it may not follow the `edge-llm-*` naming convention.

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

---

## 11. Flags vs Command-Line Features

**Confidence:** MEDIUM -- the PascalCase feature names for Edge's `--enable-features` are partially undocumented.

### How Flags and Features Relate

There are two mechanisms to control Edge's AI features:

1. **Local State flags** (`browser.enabled_labs_experiments` in `Local State` JSON) -- persisted, survive browser restarts, equivalent to toggling in `edge://flags` UI
2. **Command-line features** (`--enable-features=FeatureName`) -- per-launch, not persisted, use PascalCase names

### Known Command-Line Feature Names

| Feature                          | Purpose                                 | Status                                                                |
| -------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `AIPromptAPI`                    | Enable the Prompt API                   | **Confirmed working** (used in this project's bootstrap and fixtures) |
| `OnDeviceModelPerformanceParams` | Server-delivered performance parameters | **Confirmed** (disabled via `--disable-features` in this project)     |

### Unknown Feature Names

The PascalCase `--enable-features` names for Edge's `edge-llm-*` flags are **not publicly documented**. Unlike Chrome where feature names are in the open-source Chromium tree, Edge's feature definitions are proprietary. This project uses:

- `--enable-features=AIPromptAPI` -- discovered by the community
- `--disable-features=OnDeviceModelPerformanceParams` -- inferred from Chromium naming

The correct `--enable-features` names for other flags (Summarizer, Writer, Rewriter APIs) are unknown. The Local State flag seeding is the reliable mechanism.

### Current Project Configuration

The project uses a dual approach (Local State + command-line):

```javascript
// Local State flags (persisted)
flags: [
  'edge-llm-prompt-api-for-phi-mini@1',
  'edge-llm-on-device-model-performance-param@3',
],
// Command-line args (per-launch)
args: [
  '--enable-features=AIPromptAPI',
  '--disable-features=OnDeviceModelPerformanceParams',
],
```

This dual approach is correct and maximizes reliability. The Local State flags ensure the settings survive browser restarts, while the command-line args provide immediate effect without waiting for Local State to be processed.

---

## 12. Recommendations for This Project

### Keep Current Configuration (No Changes Needed)

The current flag configuration is optimal for the CI environment:

| Setting                                             | Value       | Why                                                 |
| --------------------------------------------------- | ----------- | --------------------------------------------------- |
| `edge-llm-prompt-api-for-phi-mini@1`                | Enabled     | Required for LanguageModel API                      |
| `edge-llm-on-device-model-performance-param@3`      | Bypass perf | Required because CI has no GPU and low perf class   |
| `--enable-features=AIPromptAPI`                     | Enabled     | Belt-and-suspenders with Local State                |
| `--disable-features=OnDeviceModelPerformanceParams` | Disabled    | Prevents server-side params from blocking the model |

### Potential Improvements

#### 1. Enable Debug Logging (LOW effort, HIGH diagnostic value)

Add the debug logging flag to the bootstrap script to capture ONNX Runtime session creation diagnostics during warm-up. First verify the exact Local State flag ID by inspecting `edge://flags` on a local Edge Dev installation.

#### 2. Log ONNX Runtime DLL Version in CI (LOW effort, MEDIUM value)

Add a diagnostic step that checks the version of `onnxruntime.dll` in the profile:

```powershell
$dll = Get-ChildItem -Path ".playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/onnxruntime.dll" -ErrorAction SilentlyContinue
if ($dll) {
  $version = $dll.VersionInfo.FileVersion
  Write-Output "[DIAG] ONNX Runtime version: $version"
}
```

This would reveal whether Edge ships a version with KleidiAI optimizations (v1.22+).

#### 3. Do NOT Add WebNN Flags (No benefit)

WebNN is architecturally separate from the LanguageModel API. Adding WebNN flags would not affect Phi-4 Mini inference.

#### 4. Do NOT Remove the Performance Override (Required for CI)

Without `edge-llm-on-device-model-performance-param@3`, Edge would reject the CI runner as ineligible (no GPU, low performance class). The flag is essential.

#### 5. Do NOT Experiment with @1 or @2 Values

The `@1` and `@2` values for the performance parameter flag likely provide weaker or no overrides. The `@3` value is confirmed to bypass all requirements, which is what the CI needs. Changing to `@1` or `@2` risks the model becoming unavailable on the GPU-less CI runner.

### What Cannot Be Improved via Flags

| Problem                               | Why Flags Cannot Help                                                   |
| ------------------------------------- | ----------------------------------------------------------------------- |
| 23+ min cold-start on first inference | ONNX Runtime graph optimization is hardware-bound, not flag-controlled  |
| Slow inference speed on ARM64 CI      | 4 vCPU Neoverse N2 is inherently slower than 12-core Snapdragon X Elite |
| Large model download (~5 GB)          | Model variant is controlled by Edge, not user-selectable                |
| Memory pressure on 16 GB runner       | ONNX Runtime memory options are not exposed                             |

---

## 13. Open Questions

### HIGH Priority

1. **What is the exact Local State flag ID for the debug logging flag?** Need to inspect `edge://flags` on a local Edge Dev installation to find the ID (may or may not follow the `edge-llm-*` pattern).

2. **What does the debug logging flag actually output and where?** Enable it locally and run a LanguageModel session to see what logs are produced.

3. **Are there more than 4 options for `edge-llm-on-device-model-performance-param`?** The flag may have additional values beyond `@0`-`@3`. Check the dropdown in `edge://flags` on the latest Edge Dev build.

### MEDIUM Priority

4. **What version of ONNX Runtime does Edge Dev currently ship?** Check `onnxruntime.dll` in the profile after model download. If < 1.22, KleidiAI optimizations are missing.

5. **Does Edge use different model variants for GPU vs CPU?** When a GPU is present, does Edge download a different ONNX model file optimized for DirectML? If so, the CPU variant on the CI runner might be a less-optimized fallback.

6. **Does the performance parameter flag affect which model variant is downloaded?** `@1` might download a variant sized for less capable hardware, while `@3` might download the full variant. This is speculative.

### LOW Priority

7. **Will Phi-4-mini-flash-reasoning replace Phi-4 Mini in Edge?** Microsoft released this distilled variant that is reportedly 10x faster. If adopted, cold-start times could decrease dramatically.

8. **Will Edge expose ONNX Runtime session options in the future?** As the Prompt API matures from "developer preview" to production, Microsoft might add configuration options for power users.

---

## Sources

### Official Documentation (HIGH confidence)

- [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Hardware requirements, flag names, setup instructions, debug logging
- [Phi-4-mini-instruct-onnx (HuggingFace)](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) -- Model variants, quantization, sizes
- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) -- Online/offline mode, optimization levels
- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) -- Pre-compiled EP caching
- [WebNN Overview (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/ai/directml/webnn-overview) -- WebNN architecture, device types
- [ONNX Runtime WebNN EP](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html) -- WebNN execution provider usage
- [ONNX Runtime Execution Providers](https://onnxruntime.ai/docs/execution-providers/) -- EP selection, fallback behavior
- [Deploy Phi-4-mini on Azure Cobalt 100 (Arm Learning Path)](https://learn.arm.com/learning-paths/servers-and-cloud-computing/onnx/setup/) -- INT4 quantization, KleidiAI

### Chromium Source Code (HIGH confidence)

- [services/on_device_model/ml/gpu_blocklist.cc](https://github.com/chromium/chromium/blob/main/services/on_device_model/ml/gpu_blocklist.cc) -- GpuBlockedReason enum, GPU detection
- [Commit 66ea717c: Simplify model disconnect/error handling](https://chromium.googlesource.com/chromium/src/+/66ea717c10bd41b8aeb2c0197561e33b55e0e7d6%5E!/) -- ServiceDisconnectReason enum (kGpuBlocked)
- [chrome/browser/resources/on_device_internals/](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/on_device_internals/) -- Debug UI source

### Community Sources (MEDIUM confidence)

- [AskVG: Disable Phi-4-Mini in Edge](https://www.askvg.com/tip-disable-phi-4-mini-and-new-web-ai-apis-in-microsoft-edge/) -- Complete flag list with Local State IDs and descriptions
- [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88) -- Complete list of edge-llm flags with @N values
- [WindowsLatest: Edge Phi-4 mini](https://www.windowslatest.com/2025/05/19/microsoft-edge-could-integrate-phi-4-mini-to-enable-on-device-ai-on-windows-11/) -- Flag discovery in Canary 138
- [WindowsForum: Edge On-Device AI](https://windowsforum.com/threads/microsoft-edges-on-device-ai-with-phi-4-mini-a-new-era-of-privacy-and-performance.366704/) -- Performance override description

### Prior Project Research (HIGH confidence)

- [edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md) -- GPU vs CPU inference paths
- [edge-dev-phi4-mini-languagemodel-api.md](edge-dev-phi4-mini-languagemodel-api.md) -- Edge flag names, platform support
- [phi4-mini-arm64-cold-start.md](phi4-mini-arm64-cold-start.md) -- Cold-start analysis, hardware comparison
- [onnx-runtime-arm64-cold-start.md](onnx-runtime-arm64-cold-start.md) -- ONNX Runtime session creation, cache files
- [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md) -- Runner hardware, inference stack comparison
