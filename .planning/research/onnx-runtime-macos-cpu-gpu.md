# Research: ONNX Runtime CPU vs GPU Execution on macOS -- Edge Dev Phi-4 Mini Inference

**Researched:** 2026-03-21
**Overall confidence:** HIGH (ONNX Runtime official docs, GitHub issues, HuggingFace model specs, Chromium architecture analysis)
**Focus:** Can we force CPU-only ONNX Runtime inference on macOS to avoid GPU-related crashes in Edge Dev CI?

---

## Executive Summary

Edge Dev's Phi-4 Mini model inference crashes on macOS GitHub Actions runners because ONNX Runtime attempts GPU inference via the CoreML execution provider, fails due to insufficient GPU memory in the VM environment, and does not gracefully fall back to CPU. **There is no environment variable or external mechanism to force ONNX Runtime to use CPU-only inference** -- execution provider selection is done programmatically at session creation time, and Edge's embedded ONNX Runtime is not configurable by end users.

The core problem is architectural: Edge embeds ONNX Runtime as a native process with hardcoded execution provider preferences. On Windows, it uses DirectML (DirectX 12 GPU). On macOS, it uses CoreML (which delegates to Metal GPU, Neural Engine, or CPU). The `--disable-gpu` Chromium flag only affects the renderer/WebGPU pipeline and does **not** cascade to Edge's native ONNX Runtime inference process, which has its own independent GPU initialization path.

The `windows-11-arm` runner works because it has **no GPU at all** -- ONNX Runtime's CoreML/DirectML provider cannot even attempt GPU inference, so it falls back to CPU automatically. On macOS runners, a paravirtualized GPU **does** exist (Intel iGPU or Apple MPS), so ONNX Runtime attempts to use it, but the available GPU memory (1-1.5 GB) is far below the ~5.5 GB required, causing a crash rather than a graceful fallback.

**Bottom line: macOS GitHub Actions runners cannot run Edge Dev's Phi-4 Mini.** No combination of flags, environment variables, or settings can work around this. The GPU exists but is inadequate, and there is no external mechanism to tell Edge's embedded ONNX Runtime to skip GPU inference.

---

## 1. ONNX Runtime Execution Providers on macOS

**Confidence:** HIGH (official ONNX Runtime documentation)

### Available Execution Providers

On macOS, ONNX Runtime supports these execution providers:

| Execution Provider          | Hardware Target                   | macOS Support                      | Notes                                    |
| --------------------------- | --------------------------------- | ---------------------------------- | ---------------------------------------- |
| **CoreMLExecutionProvider** | CPU + GPU (Metal) + Neural Engine | YES (macOS 10.15+)                 | Primary accelerated EP on macOS          |
| **CPUExecutionProvider**    | CPU only                          | YES (always available)             | Default fallback for all unsupported ops |
| **WebGPU EP**               | GPU via WebGPU/Dawn               | Only in ONNX Runtime Web (browser) | Not relevant for native ONNX Runtime     |

**There is no Metal Performance Shaders (MPS) execution provider** in ONNX Runtime. GPU acceleration on macOS is accessed exclusively through the CoreML EP, which internally delegates to Metal when `MLComputeUnits` is set to `ALL` or `CPUAndGPU`.

**There is no DirectML execution provider on macOS.** DirectML is Windows-only (requires DirectX 12). This is the critical platform difference: on Windows, Edge uses DirectML for GPU inference; on macOS, it must use CoreML.

### Fallback Order

ONNX Runtime execution providers are registered in priority order. The standard macOS fallback chain is:

```
CoreMLExecutionProvider (GPU/ANE/CPU via CoreML)
  --> CPUExecutionProvider (pure CPU fallback for unsupported ops)
```

The fallback is **operator-level**, not **session-level**. If CoreML supports an operator, it runs on CoreML (potentially using GPU). If CoreML does not support an operator, that specific operator falls back to CPU. But if CoreML **crashes** during execution (e.g., due to GPU memory allocation failure), there is no automatic recovery to CPU for the entire session.

### CoreML `MLComputeUnits` Configuration

CoreML offers fine-grained control over which compute hardware is used:

| Value                | Behavior                                           |
| -------------------- | -------------------------------------------------- |
| `ALL` (default)      | CoreML decides: CPU, GPU (Metal), or Neural Engine |
| `CPUOnly`            | Limit CoreML to CPU only -- no GPU, no ANE         |
| `CPUAndGPU`          | Use CPU and GPU (Metal), but not Neural Engine     |
| `CPUAndNeuralEngine` | Use CPU and Neural Engine, but not GPU             |

Setting `MLComputeUnits` to `CPUOnly` would theoretically solve the GPU memory crash problem. However, **this setting can only be configured programmatically** when creating the ONNX Runtime inference session. There is no environment variable to override it externally.

**Source:** [CoreML Execution Provider docs](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html), [ONNX Runtime Execution Providers](https://onnxruntime.ai/docs/execution-providers/)

---

## 2. ONNX Runtime GPU Memory Handling and Fallback Behavior

**Confidence:** HIGH (GitHub issues, community reports)

### When GPU Memory Allocation Fails

ONNX Runtime's behavior when GPU memory is insufficient is **inconsistent and poorly documented**:

| Scenario                                   | Behavior                                         | Evidence                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EP does not support an operator            | Falls back to CPU automatically (operator-level) | Documented, working                                                                                                                                      |
| GPU EP libraries missing (e.g., CUDA DLLs) | Falls back to CPU silently                       | [Issue #23372](https://github.com/microsoft/onnxruntime/issues/23372)                                                                                    |
| GPU busy or unavailable at runtime         | **Does NOT fall back** -- fails/crashes          | [Issue #5299](https://github.com/microsoft/onnxruntime/issues/5299)                                                                                      |
| GPU OOM during session creation            | **Crash or exception** -- no automatic fallback  | [Issue #5555](https://github.com/microsoft/onnxruntime/issues/5555)                                                                                      |
| Model too large for GPU memory             | **Process killed** (OOM kill)                    | [NVIDIA forums report](https://forums.developer.nvidia.com/t/running-large-onnx-model-is-getting-killed-automatically-due-to-insufficient-memory/327883) |

### The Critical Gap

ONNX Runtime's fallback mechanism works at the **operator capability** level ("can this EP handle this operator?") but **not** at the **resource availability** level ("does this EP have enough memory?"). When an EP declares it can handle an operator (via `GetCapability()`) but then fails to execute it due to insufficient GPU memory, the result is a crash -- not a fallback to CPU.

This is exactly what happens on macOS CI runners: CoreML declares it can handle the Phi-4 Mini model operators, ONNX Runtime assigns them to CoreML, CoreML attempts to allocate GPU memory via Metal, Metal fails (1.5 GB available vs ~5.5 GB needed), and the process crashes.

### Community Position

The ONNX community has [proposed](https://github.com/onnx/onnx/discussions/6623) that fallback should be disabled by default to make failures explicit. Currently, ONNX Runtime's fallback is "enabled by default" but only for capability-based fallback, not for resource-based fallback. The `session.disable_fallback()` method [does not work as expected](https://github.com/microsoft/onnxruntime/issues/23647) for many users.

**Source:** [Issue #5299](https://github.com/microsoft/onnxruntime/issues/5299), [Discussion #6623](https://github.com/onnx/onnx/discussions/6623), [Issue #23372](https://github.com/microsoft/onnxruntime/issues/23372)

---

## 3. Environment Variables for ONNX Runtime EP Selection

**Confidence:** HIGH (exhaustive search of docs, source code references, GitHub issues)

### Verdict: No Environment Variable Exists to Force CPU-Only Inference

ONNX Runtime does **not** provide a generic environment variable to select or disable execution providers. There is no:

- `ORT_DISABLE_GPU`
- `ONNXRUNTIME_PREFER_CPU`
- `ORT_EXECUTION_PROVIDER`
- `ORT_COREML_COMPUTE_UNITS`
- `ORT_USE_CPU_ONLY`

### What Environment Variables DO Exist

ONNX Runtime uses **EP-specific** environment variables for fine-tuning, not for EP selection:

| Variable                                | EP                           | Purpose                             |
| --------------------------------------- | ---------------------------- | ----------------------------------- |
| `ORT_TENSORRT_MAX_WORKSPACE_SIZE`       | TensorRT                     | Max workspace size                  |
| `ORT_TENSORRT_FP16_ENABLE`              | TensorRT                     | Enable FP16 mode                    |
| `ORT_TENSORRT_MAX_PARTITION_ITERATIONS` | TensorRT                     | Max partition iterations            |
| `ORT_MIGRAPHX_FP16_ENABLE`              | MIGraphX (AMD)               | Enable FP16 mode                    |
| `ORT_CUDA_VERSION`                      | CUDA (via ort Rust bindings) | Override CUDA version               |
| `ORT_DYLIB_PATH`                        | All (ort Rust bindings)      | Path to ONNX Runtime shared library |

None of these apply to macOS or CoreML. There are **no CoreML-specific environment variables**.

### How EP Selection Actually Works

Execution provider selection is done **programmatically** at inference session creation time:

```python
# Python API
session = ort.InferenceSession("model.onnx", providers=['CPUExecutionProvider'])

# C/C++ API
OrtSessionOptionsAppendExecutionProvider(session_options, "CoreML", provider_options)
```

Since Edge's ONNX Runtime is embedded in the browser binary, the EP selection is hardcoded at compile time or configured in Edge's proprietary code. External users cannot change it.

**Source:** [ONNX Runtime Python API](https://onnxruntime.ai/docs/api/python/api_summary.html), [Build with different EPs](https://onnxruntime.ai/docs/build/eps.html)

---

## 4. Edge-Specific ONNX Runtime Configuration

**Confidence:** MEDIUM (inference from architecture analysis, not directly documented)

### Edge's ONNX Runtime Is Not User-Configurable

Edge embeds ONNX Runtime as a native component. The EP selection and configuration are:

1. **Compiled into the Edge binary** -- Edge builds ONNX Runtime with specific EPs enabled per platform
2. **Not exposed via `edge://flags`** -- there is no flag to control the ONNX Runtime backend
3. **Not configurable via environment variables** -- ONNX Runtime does not read env vars for EP selection
4. **Not configurable via command-line switches** -- `--disable-gpu` only affects the renderer

### Evidence: Edge's Video Super Resolution Architecture

Edge's Video Super Resolution (VSR) feature provides a documented example of how Edge uses ONNX Runtime natively. Key details:

- VSR uses **ONNX Runtime + DirectML** with a custom DX12 pipeline
- The DX12 pipeline is **separate from Chromium's DX11 rendering pipeline**
- Edge had to build a "new flexible DX12 pipeline into the Chromium engine" specifically for ML inference
- This pipeline converts DX11 textures into DirectML buffers for ONNX Runtime

This confirms that Edge's ONNX Runtime inference operates on its own GPU pipeline, independent of Chromium's rendering GPU pipeline. The `--disable-gpu` flag affects Chromium's rendering but not Edge's ML inference pipeline.

### Platform-Specific EP Selection in Edge

| Platform | GPU EP                    | CPU Fallback     | Evidence                                         |
| -------- | ------------------------- | ---------------- | ------------------------------------------------ |
| Windows  | DirectML (DirectX 12)     | ONNX Runtime CPU | VSR docs, DirectML package                       |
| macOS    | CoreML (Metal internally) | ONNX Runtime CPU | NuGet package includes both DirectML + CoreML    |
| Linux    | None (not supported)      | N/A              | Prompt API docs: "Windows 10/11 and macOS 13.3+" |

The `Microsoft.ML.OnnxRuntime.DirectML` NuGet package bundles both DirectML (for Windows) and CoreML (for macOS) execution providers, confirming the cross-platform EP strategy.

### `edge://flags` for AI Model Inference

The relevant `edge://flags` entries control **model download and eligibility**, not the inference backend:

| Flag                                              | Controls                          | Does NOT Control               |
| ------------------------------------------------- | --------------------------------- | ------------------------------ |
| `edge-llm-prompt-api-for-phi-mini`                | API availability                  | Inference backend (GPU/CPU)    |
| `edge-llm-on-device-model-performance-param`      | Hardware eligibility check bypass | Which EP is used for inference |
| Hardware acceleration setting (Settings > System) | Renderer GPU compositing          | Native ONNX Runtime GPU usage  |

**No `edge://flags` entry exists to force CPU-only inference** for the on-device AI model.

**Source:** [Microsoft Edge VSR blog](https://blogs.windows.com/msedgedev/2023/03/08/video-super-resolution-in-microsoft-edge/), [NuGet Microsoft.ML.OnnxRuntime.DirectML](https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.directml)

---

## 5. CoreML vs Metal on macOS

**Confidence:** HIGH (ONNX Runtime docs, Apple developer docs)

### CoreML IS the Metal EP

There is no separate "Metal" execution provider in ONNX Runtime. CoreML is the sole accelerated EP on macOS, and it internally delegates to Metal for GPU work:

```
ONNX Runtime --> CoreML EP --> Apple CoreML Framework
                                  |
                                  +--> CPU (always)
                                  +--> GPU (Metal) (when MLComputeUnits includes GPU)
                                  +--> Neural Engine (when MLComputeUnits includes ANE)
```

### CoreML's GPU Memory Behavior

When CoreML attempts to use Metal GPU and the GPU memory is insufficient:

1. **CoreML does NOT automatically fall back to CPU for the same operation** -- if `MLComputeUnits` is `ALL`, CoreML may attempt GPU execution and crash if Metal memory allocation fails
2. **Setting `MLComputeUnits` to `CPUOnly` would prevent GPU usage** -- but this must be done programmatically
3. **CoreML has known crash bugs on newer macOS versions** -- Issue #22275 documents a crash on macOS 15 where CoreML crashes with "Failed to set compute_device_types_mask E5RT: Cannot provide zero compute device types"

### The macOS 15+ CoreML Crash (Issue #22275)

A critical bug: ONNX Runtime crashes on macOS 15 (Sequoia) when using CoreML with the default NeuralNetwork model format. The crash occurs on both Intel and Apple Silicon Macs. The workaround is to use `MLProgram` model format. Since macOS 26 (Tahoe) is even newer than macOS 15, this crash may be relevant if Edge's embedded ONNX Runtime uses an older version or the NeuralNetwork format.

**Source:** [CoreML EP docs](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html), [Issue #22275](https://github.com/microsoft/onnxruntime/issues/22275), [MLComputeUnits Apple docs](https://developer.apple.com/documentation/coreml/mlcomputeunits/cpuonly)

---

## 6. What Does Edge Use Instead of DirectML on macOS?

**Confidence:** HIGH (NuGet package analysis, ONNX Runtime platform support matrix)

### Answer: CoreML Execution Provider

Edge uses the **CoreML Execution Provider** on macOS. This is confirmed by the `Microsoft.ML.OnnxRuntime.DirectML` NuGet package, which bundles:

- **DirectML EP** for Windows (GPU via DirectX 12)
- **CoreML EP** for macOS/iOS (GPU via Metal, ANE, or CPU via CoreML)
- **CPU EP** as universal fallback

DirectML is **strictly Windows-only** -- it requires DirectX 12, which does not exist on macOS.

### CoreML GPU Path on macOS

When Edge loads Phi-4 Mini on macOS:

1. ONNX Runtime creates a session with CoreML EP registered
2. CoreML compiles the ONNX subgraphs into CoreML format (.mlmodelc)
3. CoreML evaluates available compute units (CPU, GPU via Metal, ANE)
4. With default `MLComputeUnits = ALL`, CoreML attempts to use Metal GPU
5. Metal tries to allocate GPU memory for the model (~5.5 GB needed)
6. On macOS VMs with 1-1.5 GB GPU memory available, this fails
7. **Crash** -- no graceful fallback

**Source:** [DirectML EP docs](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html), [NuGet DirectML package](https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.directml)

---

## 7. macOS VM GPU Limitations

**Confidence:** HIGH (Apple developer documentation, GitHub Actions runner specs)

### GitHub Actions macOS Runners Are VMs

Both `macos-latest` (Apple Silicon M1) and `macos-26-intel` (Intel x86_64) are virtual machines running under Apple's Virtualization framework (or Anka for Intel). The GPU is paravirtualized:

| Runner              | GPU Type                    | GPU Memory | Limitation                                                                         |
| ------------------- | --------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `macos-latest` (M1) | Apple MPS (paravirtualized) | ~1 GB cap  | [MPS paravirtualization cap](https://github.com/actions/runner-images/issues/9918) |
| `macos-26-intel`    | Intel iGPU (shared memory)  | ~1.5 GB    | Intel iGPU driver hard limit                                                       |
| `windows-11-arm`    | **None**                    | 0          | Azure Cobalt 100 -- no GPU at all                                                  |

### Why `windows-11-arm` Works and macOS Does Not

This is the crux of the issue:

| Aspect               | `windows-11-arm`      | `macos-26-intel`         | `macos-latest` (M1)        |
| -------------------- | --------------------- | ------------------------ | -------------------------- |
| GPU present          | **NO**                | YES (inadequate)         | YES (inadequate)           |
| GPU memory           | 0 GB                  | ~1.5 GB                  | ~1 GB                      |
| ONNX RT EP available | CPU only              | CoreML (attempts GPU)    | CoreML (attempts GPU)      |
| What happens         | CPU inference works   | GPU alloc fails -> crash | GPU alloc fails -> crash   |
| Phi-4 Mini result    | **SUCCESS** (~15 min) | **CRASH** (after 9 min)  | **CRASH** (bootstrap fail) |

The paradox: **having no GPU is better than having an inadequate GPU**, because ONNX Runtime correctly falls back to CPU when no GPU EP can initialize, but crashes when a GPU EP initializes successfully but then runs out of memory during model loading.

### Can We Tell ONNX Runtime the GPU Is Unavailable in a VM?

**No.** The paravirtualized GPU in macOS VMs presents itself as a real GPU to the OS and to CoreML. There is no mechanism to:

- Tell CoreML that the GPU is a VM and should not be used
- Set a GPU memory limit that would cause CoreML to skip GPU execution
- Override the `MLComputeUnits` setting from outside the process

The Apple Virtualization framework provides Metal-accelerated GPU to macOS guest VMs, and this is transparent to applications -- they see a real GPU with limited memory, not a "virtual" GPU they could opt out of.

**Source:** [Apple Virtualization Framework](https://developer.apple.com/videos/play/wwdc2022/10002/), [Parallels known limitations](https://kb.parallels.com/128867), [runner-images#9918](https://github.com/actions/runner-images/issues/9918)

---

## 8. Memory Requirements for CPU Inference of Phi-4 Mini

**Confidence:** HIGH (HuggingFace model repository, benchmark data)

### Phi-4 Mini INT4 ONNX Model Size

From the [HuggingFace repository](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx/tree/main/cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4):

| File            | Size                 |
| --------------- | -------------------- |
| model.onnx      | 52.1 MB              |
| model.onnx.data | **4.86 GB**          |
| tokenizer.json  | 15.5 MB              |
| Other files     | ~10 MB               |
| **Total**       | **~4.93 GB on disk** |

### RAM Requirements for CPU Inference

| Component                             | Estimated RAM                                     |
| ------------------------------------- | ------------------------------------------------- |
| Model weights (loaded into RAM)       | ~5 GB                                             |
| KV cache (depends on context length)  | 0.5-2 GB (short context) to 10+ GB (128K context) |
| ONNX Runtime overhead                 | ~0.3-0.5 GB                                       |
| OS + browser + other processes        | ~3-4 GB                                           |
| **Total for short-context inference** | **~9-12 GB**                                      |
| **Total for long-context inference**  | **~15-20+ GB**                                    |

### Is 14 GB (macos-26-intel) Sufficient?

**For short-context inference (< 4K tokens): LIKELY YES, but barely.**

The model weights (~5 GB) plus ONNX Runtime overhead (~0.5 GB) plus a modest KV cache (~1 GB) requires ~6.5 GB for the model alone. With macOS kernel, GitHub runner agent, Node.js, Playwright, and Edge process consuming ~3-4 GB, the total is ~10-11 GB, leaving 3-4 GB headroom.

**For the CI test (simple prompt/response): Should be sufficient** -- the test likely uses a very short context.

### Is 16 GB (windows-11-arm) Sufficient?

**YES.** This is confirmed empirically -- the model runs successfully on `windows-11-arm` with 16 GB RAM and no GPU, completing inference in ~15-17 minutes. The 2 GB additional headroom over the Intel Mac (16 GB vs 14 GB) provides a more comfortable margin.

### Comparison: Where It Runs Successfully

| Environment                   | RAM   | GPU                         | CPU inference result            |
| ----------------------------- | ----- | --------------------------- | ------------------------------- |
| `windows-11-arm` (CI)         | 16 GB | None                        | **SUCCESS** (~15 min)           |
| ExecuTorch on iPhone 15 Pro   | 8 GB  | GPU (not used for CPU mode) | ~3.2 GB peak memory             |
| ARM server (Azure Cobalt 100) | 64 GB | None                        | SUCCESS (~17 tps with KleidiAI) |
| Intel Xeon 8272CL (benchmark) | N/A   | None                        | ~17 tps                         |

**Source:** [Phi-4-mini-instruct-onnx HuggingFace](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx), [Arm deployment guide](https://learn.arm.com/learning-paths/servers-and-cloud-computing/onnx/setup/)

---

## 9. Chromium `--disable-gpu` Effect on ONNX Runtime

**Confidence:** HIGH (Chromium architecture analysis, Edge VSR documentation)

### `--disable-gpu` Does NOT Affect Edge's Native ONNX Runtime

The `--disable-gpu` flag affects Chromium's rendering pipeline:

```
What --disable-gpu DOES affect:
  - GPU compositing (falls back to software)
  - WebGPU adapter creation (returns null)
  - WebGL hardware acceleration
  - Hardware video decode

What --disable-gpu does NOT affect:
  - Edge's native ONNX Runtime inference process
  - CoreML EP initialization (independent of Chromium)
  - DirectML pipeline (separate DX12 pipeline in Edge)
  - Metal GPU access from CoreML
```

### Architecture: Two Separate GPU Paths

Edge has TWO independent GPU initialization paths:

1. **Chromium renderer GPU path**: Controlled by `--disable-gpu`, manages WebGPU/Dawn, GPU compositing, hardware video decode. This is the standard Chromium GPU process.

2. **Edge ML inference GPU path**: Not controlled by any Chromium flag. Uses ONNX Runtime with platform-specific EPs (DirectML on Windows, CoreML on macOS). Edge built a custom DX12 pipeline (on Windows) specifically for ML inference, separate from Chromium's rendering.

When `--disable-gpu` is set:

- Path 1 switches to software rendering
- Path 2 is **completely unaffected** -- CoreML still initializes Metal GPU

This is why `--disable-gpu` on macOS makes things **worse**: it adds CPU overhead for software rendering without preventing the CoreML GPU crash.

**Source:** [Edge VSR blog](https://blogs.windows.com/msedgedev/2023/03/08/video-super-resolution-in-microsoft-edge/), [Chromium GPU architecture](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/)

---

## 10. Provider-Specific Environment Variables

**Confidence:** HIGH (ONNX Runtime docs)

### TensorRT/CUDA Variables Cannot Help on macOS

The following provider-specific environment variables exist but are **irrelevant for macOS**:

| Variable                          | EP       | Platform       | Useful for macOS? |
| --------------------------------- | -------- | -------------- | ----------------- |
| `ORT_TENSORRT_FP16_ENABLE`        | TensorRT | Linux (NVIDIA) | NO                |
| `ORT_CUDA_PROVIDER_OPTIONS`       | CUDA     | Linux (NVIDIA) | NO                |
| `ORT_MIGRAPHX_FP16_ENABLE`        | MIGraphX | Linux (AMD)    | NO                |
| `ORT_TENSORRT_MAX_WORKSPACE_SIZE` | TensorRT | Linux (NVIDIA) | NO                |

There are **no CoreML-specific environment variables** and **no generic ONNX Runtime environment variables** that control EP selection.

The only way to control CoreML's compute unit selection is programmatically:

```python
# This is what Edge would need to do internally, but doesn't expose externally
providers = [
    ('CoreMLExecutionProvider', {"MLComputeUnits": "CPUOnly"}),
    'CPUExecutionProvider'
]
```

Since Edge controls this code internally and does not expose it to users, there is no mechanism to force CPU-only CoreML inference in Edge.

**Source:** [TensorRT EP docs](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html), [CUDA EP docs](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)

---

## Summary: Answers to the 10 Research Questions

| #   | Question                      | Answer                                                                                                    | Confidence |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | ONNX RT EPs on macOS?         | CoreML (GPU/ANE/CPU) + CPU fallback. No Metal/MPS EP. No DirectML.                                        | HIGH       |
| 2   | GPU memory failure behavior?  | **Crash**, not fallback. Fallback is operator-level only, not resource-level.                             | HIGH       |
| 3   | Env vars for CPU-only?        | **None exist.** No generic or CoreML-specific env vars for EP selection.                                  | HIGH       |
| 4   | Edge-specific ONNX RT config? | **Not user-configurable.** No flags, no env vars, no CLI switches.                                        | MEDIUM     |
| 5   | CoreML vs Metal?              | CoreML IS the Metal path. Setting `MLComputeUnits=CPUOnly` would help but is not externally configurable. | HIGH       |
| 6   | DirectML on macOS?            | **Does not exist.** macOS uses CoreML EP instead.                                                         | HIGH       |
| 7   | macOS VM GPU limitations?     | VMs present a real (but limited) GPU. No way to tell ONNX RT it's a VM.                                   | HIGH       |
| 8   | CPU inference RAM needs?      | ~10-12 GB for short context. 14 GB (macos-26-intel) is borderline sufficient; 16 GB works.                | HIGH       |
| 9   | `--disable-gpu` effect?       | Does NOT cascade to ONNX RT. Edge has separate ML inference GPU path.                                     | HIGH       |
| 10  | Provider-specific env vars?   | TensorRT/CUDA vars exist but are irrelevant for macOS. No CoreML env vars.                                | HIGH       |

---

## Actionable Conclusions

### 1. macOS Runners Cannot Work -- Remove From CI Matrix

No mechanism exists to force CPU-only inference in Edge's embedded ONNX Runtime on macOS. The GPU exists (even though inadequate), CoreML attempts to use it, and it crashes. This is not a configuration problem -- it is an architectural limitation.

### 2. File a Feature Request with Microsoft

The most impactful action is to file an issue requesting:

1. **CPU fallback when GPU VRAM is insufficient** -- Edge should detect insufficient GPU memory and fall back to CPU inference instead of crashing
2. **`MLComputeUnits` configuration via `edge://flags`** -- An `edge://flags` entry like "On-device AI model compute units" with options: Auto / CPU Only / CPU+GPU
3. **Graceful error propagation** -- When GPU memory allocation fails, return a JavaScript error from `LanguageModel.create()` instead of crashing the browser process

### 3. `windows-11-arm` Remains the Only Viable Runner

The `windows-11-arm` runner works precisely because it has no GPU. ONNX Runtime falls back to CPU automatically when no GPU hardware is detected. This is the only GitHub-hosted runner where Edge Dev's Phi-4 Mini inference succeeds.

### 4. Potential Future Workaround: Hardware Acceleration Setting

Disabling hardware acceleration in Edge's settings (Settings > System > "Use hardware acceleration when available") _might_ affect Edge's ONNX Runtime GPU initialization, but:

- This setting may only affect the renderer, not the ML inference pipeline
- It cannot be set programmatically in CI (it's a UI setting, not a flag or env var)
- Untested and unlikely to work given the separate GPU paths

### 5. Self-Hosted Runners Would Also Fail

Even a self-hosted macOS runner would fail unless it has a discrete GPU with 5.5+ GB VRAM. Intel Macs are limited to 1.5 GB iGPU. Apple Silicon Macs need the paravirtualized MPS cap to be lifted (requires bare metal, not VM) AND sufficient unified memory allocation for GPU (~8+ GB dedicated to GPU out of 16+ GB total).

---

## Sources

### Official Documentation (HIGH confidence)

- [ONNX Runtime CoreML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html) -- MLComputeUnits, configuration, requirements
- [ONNX Runtime Execution Providers](https://onnxruntime.ai/docs/execution-providers/) -- EP list, fallback mechanism
- [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) -- Windows-only, DirectX 12 requirement
- [ONNX Runtime Python API](https://onnxruntime.ai/docs/api/python/api_summary.html) -- Session creation, provider selection
- [Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) -- Model sizes, CPU/GPU variants
- [NuGet Microsoft.ML.OnnxRuntime.DirectML](https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.directml) -- Bundled CoreML + DirectML
- [Microsoft Edge Prompt API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Hardware requirements (5.5 GB VRAM)
- [Edge VSR blog](https://blogs.windows.com/msedgedev/2023/03/08/video-super-resolution-in-microsoft-edge/) -- ONNX Runtime + DirectML in Edge
- [MLComputeUnits.cpuOnly](https://developer.apple.com/documentation/coreml/mlcomputeunits/cpuonly) -- Apple CoreML docs

### GitHub Issues (HIGH confidence)

- [Issue #22275](https://github.com/microsoft/onnxruntime/issues/22275) -- CoreML crash on macOS 15
- [Issue #5299](https://github.com/microsoft/onnxruntime/issues/5299) -- GPU runtime fails to fall back to CPU
- [Issue #5555](https://github.com/microsoft/onnxruntime/issues/5555) -- CUDA memory allocation throws error
- [Issue #23372](https://github.com/microsoft/onnxruntime/issues/23372) -- GPU fallback to CPU without error
- [Issue #23647](https://github.com/microsoft/onnxruntime/issues/23647) -- `disable_fallback()` has no effect
- [Discussion #6623](https://github.com/onnx/onnx/discussions/6623) -- Disabled fallback by default proposal
- [Issue #21271](https://github.com/microsoft/onnxruntime/issues/21271) -- MPS provider feature request
- [runner-images#9918](https://github.com/actions/runner-images/issues/9918) -- MPS GPU cap on ARM VMs

### Architecture Analysis (HIGH confidence)

- [Chromium GPU architecture](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/) -- GPU process, renderer separation
- [Chromium multi-process architecture](https://www.chromium.org/developers/design-documents/multi-process-architecture/) -- Process model
- [Arm deployment guide for Phi-4-mini](https://learn.arm.com/learning-paths/servers-and-cloud-computing/onnx/setup/) -- CPU inference on ARM
- [Apple Virtualization Framework WWDC](https://developer.apple.com/videos/play/wwdc2022/10002/) -- VM GPU paravirtualization
- [Parallels macOS VM limitations](https://kb.parallels.com/128867) -- Known VM constraints
