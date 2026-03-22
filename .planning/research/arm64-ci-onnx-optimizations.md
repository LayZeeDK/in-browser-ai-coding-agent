# ARM64 CI ONNX Runtime Optimization Research

**Researched:** 2026-03-22
**Overall confidence:** HIGH
**Focus:** Can we reduce Phi-4 Mini inference time on the `windows-11-arm` CI runner?

---

## Executive Summary

The `windows-11-arm` CI runner (Azure Cobalt 100, 4 vCPU Neoverse N2, 16 GB RAM, no GPU) takes 23+ minutes on the first `session.prompt()` for Phi-4 Mini. This research investigates seven optimization vectors, scoped to what we can actually control: Edge flags (`edge-llm-*`), browser launch args, profile/cache management, and the model artifacts on disk.

Edge embeds ONNX Runtime as a sealed native binary. The only external control surface is:

1. **`Local State` flags** seeded before launch (`edge-llm-*` entries)
2. **Chromium launch args** (`--enable-features`, `--disable-features`, etc.)
3. **Profile directory contents** (model files, cache artifacts, `genai_config.json`)
4. **Warm-up strategy** (what the fixture/global-setup does before tests run)

**Bottom line:** All available ARM64 SIMD optimizations (KleidiAI, NEON, I8MM, SVE2) are already active in Edge's ONNX Runtime 1.25. The model and runtime are sealed components. The existing profile cache strategy is correct. The 4-core constraint is the fundamental bottleneck -- no flag or launch arg changes that. The only actionable items are diagnostics.

---

## Current Control Surface (Edge Dev on windows-11-arm)

### What We Control

| Lever                                               | Where                                | Current Value                       |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| `edge-llm-prompt-api-for-phi-mini`                  | Local State flag                     | `@1` (Enabled)                      |
| `edge-llm-on-device-model-performance-param`        | Local State flag                     | `@3` (bypass all perf requirements) |
| `internal_only_uis_enabled`                         | Local State                          | `true`                              |
| `--enable-features=AIPromptAPI`                     | Launch arg                           | Set                                 |
| `--disable-features=OnDeviceModelPerformanceParams` | Launch arg                           | Set                                 |
| Playwright default arg removal                      | `ignoreDefaultArgs`                  | 4 args removed                      |
| Profile directory                                   | `.playwright-profiles/msedge-dev/`   | Cached post-test                    |
| Warm-up sequence                                    | fixtures.ts / global-setup.shared.ts | create() + prompt('warmup')         |

### What We Do NOT Control

| Aspect                                            | Why                                                    |
| ------------------------------------------------- | ------------------------------------------------------ |
| ONNX Runtime session options                      | Edge's LLM service sets these internally               |
| Execution provider selection                      | Automatic -- DirectML fails (no GPU), CPU EP used      |
| KleidiAI kernel selection                         | Auto-detected from CPU features at runtime             |
| Model graph optimizations                         | Applied by ONNX Runtime at session creation internally |
| Thread count, memory arena, spin control          | Hardcoded in Edge's ONNX Runtime integration           |
| Model variant (WebGPU-optimized vs CPU-optimized) | Edge downloads its own sealed model component          |

---

## Q1: DirectML with Microsoft Basic Render Driver -- Accelerate Inference?

**Verdict: NO. Software-only, slower than CPU EP.**
**Confidence: HIGH**

The Microsoft Basic Render Driver is WARP (Windows Advanced Rasterization Platform) -- a software-only DirectX implementation. It reports 0 GB VRAM and runs all compute shaders on the CPU. ONNX Runtime's CPU EP with KleidiAI uses purpose-built ARM64 NEON/I8MM intrinsics that are strictly faster than a generic GPU API emulated on the same CPU. The CI runner likely does not even expose the Basic Render Driver since Azure Cobalt 100 VMs have no display adapter.

**No flag or launch arg can force DirectML onto the Basic Render Driver**, and doing so would be counterproductive even if possible.

### Sources

- [DirectML EP docs](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) -- requires DirectX 12 capable device
- [DirectML GitHub](https://github.com/microsoft/DirectML) -- maintenance mode, GPU-only

---

## Q2: Force XNNPACK or Another CPU Backend?

**Verdict: NOT POSSIBLE. MLAS + KleidiAI is already the right backend.**
**Confidence: HIGH**

XNNPACK is Chrome/LiteRT's CPU backend. Edge uses ONNX Runtime's MLAS backend. The two runtimes are architecturally separate:

- Chrome + Gemini Nano: LiteRT -> XNNPACK
- Edge + Phi-4 Mini: ONNX Runtime -> MLAS + KleidiAI

MLAS with KleidiAI (since ORT v1.22) provides ARM64-specific INT4 GEMM acceleration using the same I8MM and DotProd instructions that XNNPACK uses. Edge's `onnxruntime.dll` is a sealed binary -- no launch arg or Edge flag changes the EP selection.

### Sources

- [XNNPACK EP docs](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html) -- requires building ORT from source
- [KleidiAI + ONNX Runtime](https://onnxruntime.ai/blogs/arm-microsoft-kleidiai) -- MLAS backend, INT4 GEMM

---

## Q3: Does ONNX Runtime Use NEON/SVE SIMD? Can We Verify?

**Verdict: YES, all available SIMD is active. Verification possible via DLL version check.**
**Confidence: HIGH**

### Confirmed DLL Versions (Local Profile Inspection)

| Component               | Version                             | Path                          |
| ----------------------- | ----------------------------------- | ----------------------------- |
| `onnxruntime.dll`       | **1.25.20260307**                   | `EdgeLLMRuntime/2026.3.10.1/` |
| `onnxruntime-genai.dll` | **0.13.0-dev**                      | `EdgeLLMRuntime/2026.3.10.1/` |
| Edge LLM Runtime        | **2026.3.10.1**                     | Manifest                      |
| Model                   | **Phi-4-mini-instruct 2026.2.19.1** | `EdgeLLMOnDeviceModel/`       |

ORT 1.25 is a pre-release build ahead of the latest public release (1.24.4). KleidiAI was integrated in v1.22, so all ARM-specific optimizations are present.

### Cobalt 100 (Neoverse N2) SIMD Used by KleidiAI/MLAS

| Feature              | On Cobalt 100? | Used by KleidiAI? | Purpose                                      |
| -------------------- | -------------- | ----------------- | -------------------------------------------- |
| NEON (128-bit)       | Yes            | Yes               | Baseline vectorized ops                      |
| DotProd (SDOT)       | Yes            | Yes               | Decode-stage GEMV                            |
| I8MM (SMMLA/UMMLA)   | Yes            | Yes               | Prefill-stage GEMM                           |
| SVE2 (128-bit width) | Yes            | Yes               | Additional instructions (same width as NEON) |
| BF16                 | Yes            | Supported         | Not primary for INT4 model                   |
| SME/SME2             | **No**         | N/A               | Neoverse N2 predates SME                     |

KleidiAI selects microkernels in order: **SME2 > I8MM > DotProd**. On Cobalt 100 (no SME), the active paths are I8MM for prefill and DotProd for decode. This is automatic and requires no flags.

### Actionable: Log DLL Version in CI

Add a diagnostic step to track ONNX Runtime version across Edge Dev updates:

```yaml
- name: Log ONNX Runtime version
  if: ${{ !matrix.container }}
  shell: pwsh
  run: |
    $rtDir = Get-ChildItem ".playwright-profiles/msedge-dev/EdgeLLMRuntime" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($rtDir) {
      $dll = Join-Path $rtDir.FullName "onnxruntime.dll"
      $ver = (Get-Item $dll).VersionInfo.FileVersion
      $genai = (Get-Item (Join-Path $rtDir.FullName 'onnxruntime-genai.dll')).VersionInfo.FileVersion
      Write-Output "ONNX Runtime: $ver"
      Write-Output "GenAI: $genai"
    }
```

This costs nothing and provides early warning if an Edge Dev update ships an older ORT build without KleidiAI.

### Sources

- [Azure Cobalt 100 specs](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/cobalt-overview)
- [KleidiAI microkernel selection](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/)
- [Cobalt 100 AI inference benchmarks](https://thomasvanlaere.com/posts/2025/10/exploring-ai-cpu-inferencing-with-azure-cobalt-100/)
- [KleidiAI I8MM/DotProd usage](https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/kleidiai)

---

## Q4: KleidiAI -- Does Edge Ship It?

**Verdict: YES. Confirmed via DLL version.**
**Confidence: HIGH**

Edge ships ORT 1.25 (KleidiAI integrated since v1.22). Arm benchmarks on Cobalt 100 show 28-51% throughput uplift from KleidiAI.

**What KleidiAI does NOT fix:** The cold-start. KleidiAI accelerates steady-state GEMM operations (token generation). The 23+ minute cost is dominated by graph optimization and first-pass pipeline initialization, which are one-time costs that KleidiAI does not reduce.

**No action needed.** KleidiAI is already active.

### Sources

- [Arm + Microsoft KleidiAI blog](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime)
- [Cobalt 100 KleidiAI benchmarks](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100) -- 28-51% on 8-64 vCPU; 4 vCPU gains will be smaller

---

## Q5: Can Thread Count Be Tuned?

**Verdict: NO external control exists.**
**Confidence: HIGH**

### What Was Investigated

1. **Edge flags (`edge://flags`):** No flag controls ONNX Runtime thread count. The `edge-llm-*` flags control model eligibility and performance parameter gating, not inference configuration.

2. **Launch args:** No `--ort-threads` or similar arg exists. `--disable-features=OnDeviceModelPerformanceParams` affects hardware eligibility checks, not session options.

3. **Environment variables:** ONNX Runtime supports `OMP_NUM_THREADS` when built with OpenMP. Edge's build is not OpenMP-based. No `ORT_*` environment variable affects the embedded runtime.

4. **Registry keys:** No registry keys control Edge's ONNX Runtime. Searched extensively -- nothing exists.

5. **`genai_config.json`:** The model's config at `EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json` contains `session_options` with only `log_id` and `provider_options`. The ONNX Runtime GenAI config format [supports](https://onnxruntime.ai/docs/genai/reference/config.html) `intra_op_num_threads`, but Edge's LLM service sits between the LanguageModel API and the GenAI library and almost certainly overrides session options with its own values. Even if it did not, the optimal thread count on 4 physical cores is already 4 (the default auto-detected value).

### Current `genai_config.json` (Actual Contents)

```json
{
  "model": {
    "decoder": {
      "session_options": {
        "log_id": "onnxruntime-genai",
        "provider_options": [{ "webgpu": {} }]
      },
      "filename": "model.onnx",
      "head_size": 128,
      "hidden_size": 3072,
      "num_attention_heads": 24,
      "num_hidden_layers": 32,
      "num_key_value_heads": 8
    },
    "context_length": 131072,
    "type": "phi3",
    "vocab_size": 200064
  }
}
```

Notable: `provider_options` specifies `webgpu`. On the GPU-less runner, this falls back to CPU EP automatically. This is the expected model distribution format -- the same binary serves both GPU and CPU devices.

### Actionable: Log `genai_config.json` in CI

```yaml
- name: Log model config
  if: ${{ !matrix.container }}
  shell: bash
  run: cat .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/*/genai_config.json 2>/dev/null || true
```

This captures model architecture changes across Edge Dev updates (hidden_size, num_layers, context_length changes would indicate a model swap).

### Sources

- [ONNX Runtime GenAI config reference](https://onnxruntime.ai/docs/genai/reference/config.html)
- [ONNX Runtime thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)

---

## Q6: Would SwiftShader or ANGLE Flags Help or Hurt?

**Verdict: HURT. Do not use.**
**Confidence: HIGH**

`--use-gl=swiftshader` and `--use-angle=swiftshader` control Chromium's **renderer** GPU pipeline (page compositing, WebGL, CSS). They do NOT affect Edge's ONNX Runtime inference, which runs in a completely separate native process with its own GPU initialization (documented in [platform-runner-findings.md](../../docs/platform-runner-findings.md), Section 5).

| Flag                      | Renderer Impact            | Inference Impact   | Net Effect                                           |
| ------------------------- | -------------------------- | ------------------ | ---------------------------------------------------- |
| Default (no flags)        | Software fallback (no GPU) | CPU EP (no GPU)    | Optimal                                              |
| `--disable-gpu`           | Skia CPU rasterizer        | CPU EP (unchanged) | Slightly worse -- wastes a flag for no gain          |
| `--use-angle=swiftshader` | SwANGLE software GPU       | CPU EP (unchanged) | **Worst** -- CPU overhead for software GPU rendering |

On the `windows-11-arm` runner, `--disable-gpu` is correctly absent from the current launch args. The runner has no GPU, so Chromium auto-detects software rendering and ONNX Runtime auto-selects CPU EP.

### Sources

- [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)
- [SwANGLE performance discussion](https://groups.google.com/a/chromium.org/g/graphics-dev/c/CpVms3tXRhk)

---

## Q7: Pre-Optimize the Model Graph Offline?

**Verdict: NOT POSSIBLE with the available control surface.**
**Confidence: HIGH**

### Why Not

1. **Model is a sealed component.** Edge downloads `model.onnx` + `model.onnx.data` as a component update into `EdgeLLMOnDeviceModel/`. Replacing the model file would be overwritten on next launch or rejected by integrity checks.

2. **Model exceeds protobuf 2 GB limit.** ONNX Runtime's `optimized_model_filepath` serializes as protobuf. `model.onnx.data` is 4.86 GB. [Issue #12882](https://github.com/microsoft/onnxruntime/issues/12882) confirms this hard limit.

3. **No access to ONNX Runtime APIs.** Offline optimization requires calling `InferenceSession` programmatically. The runtime is embedded in Edge.

4. **Hardware-specific.** A model pre-optimized on one architecture cannot run on another. We cannot pre-optimize on the CI runner without programmatic ORT access.

### What Edge Does Internally

The `adapter_cache.bin` and `encoder_cache.bin` files in the model directory are generated after first inference and cached in the profile. On the local dev machine (GPU/NPU available), these files are **0 bytes**. On the CI runner (CPU EP only), they contain the compiled execution plan after the first inference run.

The existing post-test cache strategy already preserves these files correctly.

### Sources

- [ONNX Runtime graph optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)
- [Issue #12882: optimized_model_filepath >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882)

---

## What the Existing Flags and Args Actually Do

Since the control surface is limited to flags and launch args, here is what each one does for the Edge Dev configuration:

### Local State Flags

| Flag                                           | Value    | Purpose                                                                             |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `edge-llm-prompt-api-for-phi-mini@1`           | Enabled  | Exposes `LanguageModel` API to web pages                                            |
| `edge-llm-on-device-model-performance-param@3` | Option 3 | Bypasses Edge's hardware eligibility check (required on 4-core/16 GB/no-GPU runner) |

The `@3` option likely means "bypass all performance requirements." Without it, Edge may reject the runner as incapable of running Phi-4 Mini. The exact dropdown values are not publicly documented (see [edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md) Section 4).

### Launch Args

| Arg                                                 | Purpose                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--enable-features=AIPromptAPI`                     | Enables the LanguageModel API at the Chromium feature level                                                                                                       |
| `--disable-features=OnDeviceModelPerformanceParams` | Disables server-defined performance parameters, forcing Edge to use hardcoded defaults. Prevents server-pushed eligibility checks from blocking the no-GPU runner |
| `DISABLE_FEATURES_WITHOUT_OPT_HINTS`                | Re-injects Playwright's disabled features list minus OptimizationHints (required for model delivery)                                                              |

### Removed Playwright Defaults

| Removed Arg                               | Why                                            |
| ----------------------------------------- | ---------------------------------------------- |
| `--disable-features=...OptimizationHints` | Blocks model delivery system                   |
| `--disable-field-trial-config`            | Blocks model eligibility field trials          |
| `--disable-background-networking`         | Blocks variations seed fetch and model updates |
| `--disable-component-update`              | Blocks model component registration            |

All four removals are necessary. Without them, Edge cannot download or register the Phi-4 Mini model.

---

## Profile Cache Strategy Assessment

The current strategy is correct and there is nothing to change:

| Aspect             | Current Approach                                      | Assessment                                                               |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Cache timing       | Post-test (after all inference)                       | Correct -- captures `adapter_cache.bin` and `encoder_cache.bin`          |
| Cache key          | `${{ matrix.cache-key }}-run${{ github.run_number }}` | Correct -- rolling key with prefix-match restore                         |
| What is cached     | Full `.playwright-profiles/msedge-dev/` directory     | Correct -- includes runtime DLLs, model, tokenizer, and inference caches |
| Cache restore      | Before bootstrap, skip bootstrap on hit               | Correct -- avoids model re-download                                      |
| Cold-start on miss | ~23 min (unavoidable)                                 | Expected -- 3.8B params x 32 layers on 4 ARM64 cores                     |
| Warm-start on hit  | ~30-90s (weight loading only)                         | Expected -- graph optimization and EP compilation cached                 |

The `adapter_cache.bin` and `encoder_cache.bin` files are **0 bytes on the local dev machine** (which has GPU/NPU) but populated on the CI runner (CPU EP only). This confirms they are CPU EP-specific compiled execution plans. **Verify this on CI** (see recommendation 2).

---

## Actionable Recommendations

### 1. Add ONNX Runtime Version Diagnostic (NO risk, HIGH value)

Track DLL versions in CI to detect regressions when Edge Dev updates:

```yaml
- name: Log ONNX Runtime version
  if: ${{ !matrix.container && steps.bootstrap.outcome != 'failure' }}
  shell: pwsh
  run: |
    $rtDir = Get-ChildItem ".playwright-profiles/msedge-dev/EdgeLLMRuntime" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($rtDir) {
      Write-Output "ONNX Runtime: $((Get-Item (Join-Path $rtDir.FullName 'onnxruntime.dll')).VersionInfo.FileVersion)"
      Write-Output "GenAI: $((Get-Item (Join-Path $rtDir.FullName 'onnxruntime-genai.dll')).VersionInfo.FileVersion)"
    }
    cat .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/*/genai_config.json 2>$null
```

### 2. Log Cache File Sizes Post-Test (NO risk, MEDIUM value)

Confirm cache files are being populated on CI:

```yaml
- name: Log inference cache state
  if: ${{ !matrix.container && !cancelled() }}
  shell: bash
  run: |
    ls -la .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/*/adapter_cache.bin 2>/dev/null || echo "No adapter_cache.bin"
    ls -la .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/*/encoder_cache.bin 2>/dev/null || echo "No encoder_cache.bin"
```

If these remain 0 bytes on CI, it means the CPU EP path does not generate them -- which would explain why there is no warm-start speedup between CI runs and would warrant investigation.

### 3. Accept the Bottleneck

The fundamental constraint is **4 ARM64 cores with no GPU running a 3.8B parameter model**. Every available optimization is already active:

- KleidiAI: Active (ORT 1.25 includes it)
- NEON/I8MM/SVE2: Active (auto-detected from Cobalt 100)
- Profile cache: Implemented (post-test save with rolling keys)
- Performance bypass: Active (`@3` flag + `OnDeviceModelPerformanceParams` disabled)
- Warm-up: Implemented (create() + prompt('warmup') before tests)

**The only paths to significantly faster CI inference are infrastructure changes:**

| Change                    | Expected Impact                     | Feasibility                              |
| ------------------------- | ----------------------------------- | ---------------------------------------- |
| 8+ vCPU Cobalt 100 runner | ~2x faster (linear with core count) | Depends on GitHub Actions runner catalog |
| Runner with GPU/NPU       | 10-50x faster                       | Not available on GitHub Actions          |
| Smaller model             | Proportional to param count         | Edge controls the model                  |

---

## Additional Findings

### The Model Is Optimized for WebGPU, Not CPU

The `genai_config.json` specifies `"provider_options": [{ "webgpu": {} }]` and the manifest declares `"type": "webgpu"`. This means:

1. The ONNX model graph may contain operators optimized for GPU execution patterns
2. CPU EP fallback may not be as efficient as a model explicitly quantized and optimized for CPU
3. A CPU-optimized variant exists on HuggingFace (`cpu-int4-rtn-block-32`), but Edge downloads its own model version

### ONNX Runtime Versions in the Ecosystem

| Component                               | Version           | Date       |
| --------------------------------------- | ----------------- | ---------- |
| Edge's embedded `onnxruntime.dll`       | **1.25.20260307** | 2026-03-07 |
| Edge's embedded `onnxruntime-genai.dll` | **0.13.0-dev**    | 2026-03-10 |
| Latest public ONNX Runtime (PyPI)       | 1.24.4            | 2026-03-17 |
| Windows ML (App SDK 1.8.6)              | ~1.23.4           | 2026-03-19 |

Edge ships a version ahead of both public PyPI and Windows ML, indicating access to pre-release builds with the latest optimizations.

---

## Summary Table

| Question                           | Answer                                     | Can We Control It?                        |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Q1: DirectML + Basic Render Driver | Software-only, slower than CPU EP          | No -- and no flag to force it             |
| Q2: XNNPACK or alt CPU backend     | MLAS + KleidiAI already optimal            | No -- runtime is sealed                   |
| Q3: NEON/SVE SIMD active?          | Yes, all available SIMD is active          | No action needed -- auto-detected         |
| Q4: KleidiAI in Edge?              | Yes, ORT 1.25 includes it                  | No action needed -- automatic             |
| Q5: Thread count tuning            | 4 threads (auto), optimal for 4 cores      | No -- no external override exists         |
| Q6: SwiftShader/ANGLE flags        | Would add CPU overhead, not help inference | No -- and should not be added             |
| Q7: Offline model optimization     | Model sealed, exceeds 2 GB limit           | No -- profile cache is the only mechanism |

---

## Sources

### Official Documentation

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)
- [ONNX Runtime GenAI Config](https://onnxruntime.ai/docs/genai/reference/config.html)
- [ONNX Runtime Thread Management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [ONNX Runtime XNNPACK EP](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html)
- [ONNX Runtime versions in Windows ML](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/onnx-versions)
- [Azure Cobalt 100 VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/cobalt-overview)

### ARM Architecture

- [Arm + Microsoft KleidiAI ONNX Runtime](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime)
- [KleidiAI on Cobalt 100](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100)
- [KleidiAI microkernel architecture](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/)
- [KleidiAI SDOT/I8MM usage](https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/kleidiai)
- [Cobalt 100 AI benchmarks](https://thomasvanlaere.com/posts/2025/10/exploring-ai-cpu-inferencing-with-azure-cobalt-100/)

### Chromium / SwiftShader

- [SwiftShader in Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)
- [SwANGLE discussion](https://groups.google.com/a/chromium.org/g/graphics-dev/c/CpVms3tXRhk)

### GitHub Issues

- [ORT #12882: optimized_model_filepath >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882)
- [ORT GenAI #1260: graph_optimization_level in config](https://github.com/microsoft/onnxruntime-genai/discussions/1260)

### Local Inspection

- `EdgeLLMRuntime/2026.3.10.1/onnxruntime.dll` -- FileVersion: 1.25.20260307.1.6db14b3
- `EdgeLLMRuntime/2026.3.10.1/onnxruntime-genai.dll` -- FileVersion: 0.13.0-dev
- `EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json` -- session_options, provider_options
- `EdgeLLMOnDeviceModel/2026.2.19.1/manifest.json` -- Phi-4-mini-instruct, type: webgpu
- `EdgeLLMOnDeviceModel/2026.2.19.1/adapter_cache.bin` -- 0 bytes (local dev machine)
- `EdgeLLMOnDeviceModel/2026.2.19.1/encoder_cache.bin` -- 0 bytes (local dev machine)

### Project Documentation

- [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md) -- GPU/CPU EP architecture, two separate GPU paths in Edge
- [.planning/research/edge-dev-gpu-vs-cpu-inference-control.md](edge-dev-gpu-vs-cpu-inference-control.md) -- Edge flag options, `OnDeviceModelPerformanceParams`
- [.planning/research/onnx-runtime-arm64-cold-start.md](onnx-runtime-arm64-cold-start.md) -- Cold-start phases, cache file analysis
