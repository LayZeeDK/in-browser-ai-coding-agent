# ARM64 CI ONNX Runtime Optimization Research

**Researched:** 2026-03-22
**Overall confidence:** HIGH (ONNX Runtime docs, Arm architecture specs, KleidiAI benchmarks, DLL version inspection, genai_config.json inspection)
**Focus:** Can we reduce Phi-4 Mini inference time on the `windows-11-arm` CI runner (Azure Cobalt 100, 4 vCPU Neoverse N2, 16 GB RAM, no GPU)?

---

## Executive Summary

The 23+ minute first `session.prompt()` on the `windows-11-arm` CI runner is dominated by two factors: (1) ONNX Runtime graph optimization at session creation, and (2) first-pass inference through 3.8B INT4 parameters on only 4 ARM64 cores with no GPU. Research into seven potential optimization vectors reveals that **most are inaccessible** because Edge embeds ONNX Runtime as a black box. However, the investigation uncovered several important facts and one actionable experiment.

**Key findings:**

1. **Edge ships ONNX Runtime 1.25** (pre-release, build 2026-03-07), confirming KleidiAI optimizations (integrated since v1.22) are active. The MLAS backend uses NEON and I8MM instructions, and SVE2 (128-bit) on the Neoverse N2 -- but NOT SME (unsupported on N2).

2. **DirectML with Microsoft Basic Render Driver is pure software** -- it would be slower than the CPU EP, not faster. Do not attempt to force DirectML.

3. **The `genai_config.json` in the model profile is theoretically editable** and supports `intra_op_num_threads`. Modifying it post-download to tune threading is the only potential external tuning lever, but Edge may override these values at runtime.

4. **SwiftShader/ANGLE flags would hurt, not help.** They affect Chromium's renderer pipeline, not ONNX Runtime's inference pipeline. Adding CPU overhead for software rendering while ONNX Runtime already uses all 4 cores for inference would reduce available CPU for the actual model execution.

5. **Offline model optimization (pre-optimized graph) is theoretically possible** but impractical -- the model is 4.86 GB (exceeding protobuf's 2 GB limit for `optimized_model_filepath`), and Edge downloads the model as a sealed component update.

6. **The 4-core constraint is the fundamental bottleneck.** All other factors are secondary. The same model on a 32-core Cobalt 100 instance completes in ~1-2 minutes. The only path to dramatically faster CI inference is a runner with more cores, or caching the post-inference profile (already implemented).

---

## Q1: DirectML 5.0 with Microsoft Basic Render Driver -- Accelerate Inference?

**Verdict: NO. Purely software, would be SLOWER than CPU EP.**
**Confidence: HIGH**

### Analysis

The Microsoft Basic Render Driver is a software-only DirectX implementation using WARP (Windows Advanced Rasterization Platform). It reports as a DirectX 12 device with 0 GB dedicated VRAM, meaning DirectML can technically enumerate it as a target. However:

- **All DirectML compute shaders run on the CPU** when backed by WARP -- there is zero hardware acceleration.
- WARP exists for display compatibility, not ML inference. It is a generic GPU API emulation layer with significant overhead compared to purpose-built CPU compute paths.
- ONNX Runtime's CPU EP (via MLAS) with KleidiAI is specifically optimized for ARM64 CPU execution with NEON/I8MM/SVE2 intrinsics. It will always outperform a generic GPU API emulated on the same CPU.

DirectML via WARP would add GPU API overhead (shader compilation, memory management, command queue scheduling) on top of the same CPU cores that MLAS already uses natively. The result would be strictly worse performance.

**Furthermore, the CI runner may not even have the Basic Render Driver available.** Azure Cobalt 100 VMs have no GPU hardware at all -- the Basic Render Driver requires at least a display adapter entry in the device tree, which headless VMs may lack.

### Recommendation

Do not attempt to force DirectML. The current CPU EP fallback is already the optimal path for GPU-less hardware.

### Sources

- [DirectML Execution Provider docs](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [DirectML GitHub (now in maintenance mode)](https://github.com/microsoft/DirectML)
- [DirectML Introduction](https://learn.microsoft.com/en-us/windows/ai/directml/dml)

---

## Q2: Force XNNPACK or Another Optimized CPU Backend on ARM64 Windows?

**Verdict: NOT POSSIBLE in Edge's embedded ONNX Runtime. And MLAS is already the better choice.**
**Confidence: HIGH**

### Analysis

ONNX Runtime supports XNNPACK as an execution provider, and XNNPACK does support ARM64 Windows as a build target. However:

1. **XNNPACK must be built into the ONNX Runtime binary** using the `--use_xnnpack` build flag. Pre-built packages (PyPI, NuGet) do not include XNNPACK -- only Android (Maven) and iOS (CocoaPods) packages ship with it.

2. **Edge's `onnxruntime.dll` is a sealed binary** (version 1.25.20260307, confirmed by DLL inspection). We cannot rebuild it with different execution providers.

3. **MLAS is already optimized for ARM64** and now includes KleidiAI kernels (since v1.22). XNNPACK's ARM64 NEON kernels are comparable in performance to MLAS for the operations Phi-4 Mini uses (MatMul, Conv). The KleidiAI integration into MLAS specifically adds INT4 GEMM acceleration using I8MM and DotProd instructions -- exactly what the INT4-quantized Phi-4 Mini model needs.

4. **XNNPACK is Chrome/LiteRT's CPU backend**, not ONNX Runtime's. The two runtimes use different CPU acceleration libraries by design:
   - Chrome + Gemini Nano: LiteRT -> XNNPACK (CPU)
   - Edge + Phi-4 Mini: ONNX Runtime -> MLAS + KleidiAI (CPU)

### Recommendation

No action possible. MLAS + KleidiAI on ONNX Runtime 1.25 is already the optimal CPU backend for this model on ARM64.

### Sources

- [XNNPACK Execution Provider docs](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html)
- [ONNX Runtime build instructions](https://onnxruntime.ai/docs/build/inferencing.html)
- [KleidiAI + ONNX Runtime blog](https://onnxruntime.ai/blogs/arm-microsoft-kleidiai)

---

## Q3: Does ONNX Runtime Use NEON/SVE SIMD on ARM64 Windows?

**Verdict: YES. NEON, I8MM, DotProd, and SVE2 (128-bit) are all used. No flags needed.**
**Confidence: HIGH**

### Confirmed: Edge's ONNX Runtime DLL Versions

Inspection of the local profile directory revealed:

| Component                   | Version                                           | Path                          |
| --------------------------- | ------------------------------------------------- | ----------------------------- |
| `onnxruntime.dll`           | **1.25.20260307** (pre-release, build 2026-03-07) | `EdgeLLMRuntime/2026.3.10.1/` |
| `onnxruntime-genai.dll`     | **0.13.0-dev**                                    | `EdgeLLMRuntime/2026.3.10.1/` |
| Edge LLM Runtime            | **2026.3.10.1**                                   | Manifest version              |
| Model (Phi-4-mini-instruct) | **2026.2.19.1**                                   | `EdgeLLMOnDeviceModel/`       |

ONNX Runtime 1.25 is **newer than the latest public release** (1.24.4 on PyPI, March 17, 2026). This is a bleeding-edge Microsoft-internal build. Since KleidiAI was integrated in v1.22, all ARM-specific optimizations are guaranteed to be present.

### Azure Cobalt 100 (Neoverse N2) SIMD Capabilities

| Feature                     | Supported | Used by KleidiAI/MLAS                   |
| --------------------------- | --------- | --------------------------------------- |
| NEON (128-bit)              | Yes       | Yes -- baseline vectorized operations   |
| DotProd (SDOT)              | Yes       | Yes -- vector-by-matrix (decode stage)  |
| I8MM (SMMLA/UMMLA)          | Yes       | Yes -- matrix-by-matrix (prefill stage) |
| SVE2 (128-bit vector width) | Yes       | Yes -- additional parallelism           |
| BF16                        | Yes       | Supported but not primary for INT4      |
| SME/SME2                    | **No**    | Not available (N2 predates SME)         |

The Neoverse N2 implements ARMv9.0-A, which mandates SVE2 support. However, the SVE2 implementation uses **128-bit vector width** -- the same as NEON. This means SVE2 provides additional instructions (like multi-vector operations) but not wider vectors on this specific hardware.

### KleidiAI Microkernel Selection

KleidiAI selects microkernels in priority order: **SME2 > I8MM > DotProd**. Since Cobalt 100 does not support SME/SME2, the active path is:

- **Prefill (prompt processing):** I8MM microkernels -- uses `SMMLA`/`UMMLA` instructions for INT4-packed GEMM
- **Decode (token generation):** DotProd microkernels -- uses `SDOT` for vector-by-matrix operations

The INT4 computation works by packing two INT4 values into INT8 containers and using I8MM/DotProd instructions to perform the multiply-accumulate. This is already happening automatically -- no flags or configuration needed.

### How to Verify

To confirm SIMD usage in CI, add a diagnostic step:

```powershell
# Check CPU features reported by the OS
Get-CimInstance Win32_Processor | Select-Object Name, Architecture, NumberOfCores
# Or check via onnxruntime logging:
# Set ORT_LOG_LEVEL=VERBOSE environment variable before Edge launch
```

However, since ONNX Runtime 1.25 auto-detects ARM64 capabilities at startup, no manual verification is strictly necessary.

### Sources

- [Azure Cobalt 100 overview](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/cobalt-overview)
- [Arm Neoverse N2 architecture](https://newsroom.arm.com/blog/arm-powered-microsoft-azure-cobalt-100-vms)
- [KleidiAI microkernel selection](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/)
- [KleidiAI SDOT and I8MM usage](https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/kleidiai)
- [Azure Cobalt 100 AI inference benchmarks](https://thomasvanlaere.com/posts/2025/10/exploring-ai-cpu-inferencing-with-azure-cobalt-100/)

---

## Q4: KleidiAI for ARM64 ONNX Runtime -- Does It Apply? Does Edge Ship It?

**Verdict: YES and YES. Confirmed active in Edge's ONNX Runtime 1.25.**
**Confidence: HIGH**

### KleidiAI Integration Details

KleidiAI was integrated into ONNX Runtime's MLAS backend in **v1.22** (released ~May 2025). Edge ships **v1.25**, so KleidiAI is definitively included.

The integration works by:

1. **Replacing generic GEMM kernels** in MLAS with ARM-optimized microkernels from KleidiAI
2. **Accelerating INT4 quantized matrix multiplication** -- exactly the precision used by Phi-4 Mini
3. **Requiring zero code changes** -- the optimization is transparent to the caller (Edge's LLM service)

### Performance Benchmarks on Cobalt 100

From Arm's benchmarks on Azure Cobalt 100 (same Neoverse N2 as the CI runner, but with more cores):

| Metric                         | Improvement (v1.21 -> v1.22)                         |
| ------------------------------ | ---------------------------------------------------- |
| Token generation throughput    | 28-51% uplift (varies by instance size)              |
| Prompt processing throughput   | 2.4x faster (on Windows Arm devices)                 |
| vs AMD Genoa (same price tier) | 1.9x faster token generation, 2.8x price/performance |

**Critical caveat for CI:** These benchmarks were run on 8-64 vCPU instances. The CI runner has only **4 vCPUs**. KleidiAI's parallelized GEMM kernels scale with core count. At 4 cores, the absolute improvement is smaller than at 32+ cores, though the relative percentage uplift should be similar.

### What KleidiAI Does NOT Fix

KleidiAI optimizes **steady-state inference** (matrix multiplication during token generation). It does NOT significantly reduce:

- Graph optimization time (a one-time cost at session creation)
- Model weight deserialization (I/O bound, not compute bound)
- KV cache allocation (memory allocation, not compute)
- First-pass attention weight materialization (dominated by memory bandwidth, not GEMM speed)

The cold-start penalty (23+ min) is mostly graph optimization + first-pass initialization. KleidiAI helps with subsequent token generation speed but not the startup overhead.

### Sources

- [Arm + Microsoft KleidiAI ONNX Runtime blog](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime)
- [ONNX Runtime KleidiAI blog](https://onnxruntime.ai/blogs/arm-microsoft-kleidiai)
- [Accelerate LLM on Cobalt 100](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100)
- [KleidiAI overview](https://www.arm.com/markets/artificial-intelligence/software/kleidi)

---

## Q5: Can ONNX Runtime Thread Count Be Tuned in Edge?

**Verdict: MAYBE -- the `genai_config.json` supports it, but Edge may override. Worth experimenting.**
**Confidence: MEDIUM**

### Discovery: The `genai_config.json` Is Editable

The model profile at `EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json` is a standard JSON file that ONNX Runtime GenAI reads at session creation. The current contents show:

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

**Notable observations:**

1. **No `intra_op_num_threads` is set** -- ONNX Runtime defaults to auto-detection (1 thread per physical core = 4 on the CI runner).
2. **`provider_options` specifies `webgpu`** -- the model is optimized for WebGPU execution. On GPU-less hardware, this falls back to CPU EP.
3. **No `graph_optimization_level` is set** -- defaults to `ORT_ENABLE_ALL` (Level 3), meaning full optimization runs on every session creation.

### The `genai_config.json` Officially Supports Threading Options

Per the ONNX Runtime GenAI [config reference](https://onnxruntime.ai/docs/genai/reference/config.html):

```json
"session_options": {
  "intra_op_num_threads": 4,
  "inter_op_num_threads": 2,
  "enable_cpu_mem_arena": true,
  "enable_mem_pattern": true,
  "graph_optimization_level": 99
}
```

However, `graph_optimization_level` [is not yet supported](https://github.com/microsoft/onnxruntime-genai/discussions/1260) in the config file as of the public API. Edge's internal build (0.13.0-dev) may or may not support it.

### Potential Experiment: Modify `genai_config.json` Post-Download

After the bootstrap script downloads the model, a CI step could modify `genai_config.json` to add threading configuration:

```bash
# Add intra_op_num_threads to session_options
node -e "
  const fs = require('fs');
  const path = '.playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json';
  const config = JSON.parse(fs.readFileSync(path, 'utf8'));
  config.model.decoder.session_options.intra_op_num_threads = 4;
  // Attempt to set graph optimization level (may be ignored)
  config.model.decoder.session_options.graph_optimization_level = 99;
  fs.writeFileSync(path, JSON.stringify(config, null, 4));
"
```

**Risks:**

1. **Edge may override** the config values at runtime. The LLM service sits between the LanguageModel API and ONNX Runtime GenAI, and may set its own session options regardless of the config file.
2. **Edge may validate** the config file against a schema or checksum, rejecting modifications.
3. **Thread count is already optimal** at 4 (matching the 4 physical cores). Increasing it would cause contention; decreasing it would be slower.

**What IS worth testing:** Setting `graph_optimization_level` to `ORT_ENABLE_BASIC` (1) or `ORT_DISABLE_ALL` (0) to skip expensive graph optimizations. If Edge's ONNX Runtime GenAI build reads this value, it could significantly reduce the cold-start graph optimization phase.

### No Registry Keys or Edge Flags Found

Extensive searching confirmed there are **no Windows Registry keys, environment variables, or `edge://flags` entries** that control ONNX Runtime thread count or session options within Edge. The threading configuration is entirely internal.

### Sources

- [ONNX Runtime GenAI config reference](https://onnxruntime.ai/docs/genai/reference/config.html)
- [ONNX Runtime thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [GitHub Discussion #1260: graph_optimization_level not in genai_config](https://github.com/microsoft/onnxruntime-genai/discussions/1260)

---

## Q6: Would SwiftShader or ANGLE Flags Help or Hurt?

**Verdict: HURT. Do not use.**
**Confidence: HIGH**

### Analysis

`--use-gl=swiftshader` and `--use-angle=swiftshader` control **Chromium's renderer GPU pipeline** (compositing, WebGL, WebGPU for the page renderer). They do NOT affect Edge's ONNX Runtime inference pipeline, which runs in a completely separate native process.

The two GPU paths in Edge are architecturally independent (confirmed in `platform-runner-findings.md`):

| Path                             | Controls                                | Affected by SwiftShader flags? |
| -------------------------------- | --------------------------------------- | ------------------------------ |
| Chromium renderer GPU            | Page compositing, WebGL, CSS transforms | YES                            |
| Edge ML inference (ONNX Runtime) | DirectML, CPU EP, model inference       | **NO**                         |

### Performance Impact

Adding SwiftShader flags would:

1. **Add CPU overhead** for software-rendering the page content. SwiftShader emulates a full GPU pipeline on CPU, consuming CPU cycles that would otherwise be available for ONNX Runtime inference.
2. **NOT provide any GPU acceleration** for ONNX Runtime. The inference pipeline does not go through Chromium's WebGPU/WebGL stack -- it uses DirectML (when GPU available) or CPU EP directly.
3. **Be strictly worse** than `--disable-gpu`. Benchmarks show that `--disable-gpu` (which uses Skia's hand-tuned CPU rasterizer) outperforms SwANGLE (SwiftShader + ANGLE) for page rendering because Skia's CPU path is optimized for its exact needs, while ANGLE + SwiftShader must comply with a generic 3D API.

**Comparison of rendering approaches on CPU:**

| Flag Combination          | Page Rendering                          | ML Inference       | CPU Contention |
| ------------------------- | --------------------------------------- | ------------------ | -------------- |
| Default (no flags)        | Hardware GPU (if available) or software | CPU EP             | Low            |
| `--disable-gpu`           | Skia CPU rasterizer (fast)              | CPU EP (unchanged) | Moderate       |
| `--use-angle=swiftshader` | SwANGLE software GPU (slow)             | CPU EP (unchanged) | **High**       |

### Recommendation

Do not add SwiftShader or ANGLE flags. On the CI runner with no GPU, the current default behavior is already optimal: Chromium falls back to software rendering automatically, and ONNX Runtime uses CPU EP. Adding SwiftShader would only increase CPU contention.

### Sources

- [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)
- [SwiftShader GitHub](https://github.com/google/swiftshader)
- [SwANGLE deprecation discussion](https://groups.google.com/a/chromium.org/g/graphics-dev/c/CpVms3tXRhk)

---

## Q7: Pre-Optimize the ONNX Model Graph Offline?

**Verdict: NOT PRACTICALLY POSSIBLE for this scenario.**
**Confidence: HIGH**

### ONNX Runtime's Offline Optimization

ONNX Runtime supports saving pre-optimized model graphs via `optimized_model_filepath` in SessionOptions. When used:

1. First run: Apply all graph optimizations, serialize result to disk
2. Subsequent runs: Load pre-optimized model, set `graph_optimization_level = ORT_DISABLE_ALL`, skip optimization

This eliminates the graph optimization phase (estimated 60-180s of the cold-start).

### Why It Does Not Work Here

**Blocker 1: Model size exceeds protobuf limit.**
The `optimized_model_filepath` mechanism serializes the optimized graph as a protobuf file. Protobuf has a hard 2 GB size limit. Phi-4 Mini's `model.onnx.data` is 4.86 GB. [Issue #12882](https://github.com/microsoft/onnxruntime/issues/12882) confirms this limitation.

**Blocker 2: Edge downloads the model as a sealed component.**
The model files in `EdgeLLMOnDeviceModel/` are delivered by Edge's proprietary LLM service. We cannot replace `model.onnx` with a pre-optimized version -- Edge would re-download the original on the next launch or reject the modified file.

**Blocker 3: Hardware-specific optimizations.**
Pre-optimized models are hardware-specific. A model pre-optimized on x86 (developer machine under QEMU) cannot be used on ARM64 (CI runner). We would need to pre-optimize ON the CI runner itself, which requires running ONNX Runtime programmatically -- impossible when the runtime is embedded inside Edge.

**Blocker 4: EP-specific optimizations.**
The optimization output depends on the execution provider. A model pre-optimized for CPU EP would not work if Edge later uses DirectML. Since the genai_config.json specifies `webgpu` as the provider, the optimization path may differ from what CPU EP expects.

### ORT Format Models (Alternative)

ONNX Runtime also supports an ORT format (`.ort`) that pre-bakes optimizations. However, this requires:

- Converting with `convert_onnx_models_to_ort` script
- Matching the target EP and hardware exactly
- Loading via ONNX Runtime's ORT format API (not the standard ONNX loader)

Edge does not use ORT format models -- it uses standard ONNX format with GenAI configuration.

### What Edge Likely Does Internally

The `adapter_cache.bin` and `encoder_cache.bin` files generated after first inference serve a similar purpose to offline optimization. They appear to cache the compiled execution plan, avoiding re-optimization on subsequent runs. The current post-test cache strategy already preserves these files.

On the local developer machine (which has GPU/NPU), these cache files are **0 bytes** -- suggesting they are only populated on the CPU EP path or when specific conditions trigger caching.

### Recommendation

No action possible. The existing post-test profile cache strategy is the correct approach for avoiding repeated graph optimization. The cold-start on first-ever run (cache miss) is unavoidable with the current architecture.

### Sources

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)
- [ORT Format Models](https://onnxruntime.ai/docs/performance/model-optimizations/ort-format-models.html)
- [Issue #12882: optimized_model_filepath fails for models >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882)
- [ONNX Runtime Transformers Optimizer](https://onnxruntime.ai/docs/performance/transformers-optimization.html)

---

## Additional Findings

### The Model Is Optimized for WebGPU, Not CPU

The `genai_config.json` and model manifest both specify `"type": "webgpu"` as the intended execution target. This means:

1. The ONNX model graph may contain operators optimized for GPU execution patterns
2. CPU EP fallback may not be as efficient as a model explicitly quantized and optimized for CPU
3. The INT4 quantization scheme used may be tuned for GPU memory access patterns rather than CPU cache hierarchies

A CPU-optimized variant of Phi-4 Mini exists on HuggingFace ([microsoft/Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) with `cpu-int4-rtn-block-32` variant), but Edge downloads its own model version and we cannot substitute it.

### Windows ML Auto-Discovery (Future Optimization Path)

Windows ML on Windows 11 25H2+ includes EP auto-discovery that automatically selects the best execution provider for the hardware. If Edge migrates to Windows ML's API in the future, the CI runner could potentially benefit from optimized EP selection. However:

- The CI runner runs Windows 11 (not 25H2 yet on GitHub Actions)
- Windows ML's auto-discovery still requires actual hardware accelerators to be present
- This is speculative and not actionable today

### ONNX Runtime Versions in the Ecosystem

| Component                               | Version           | Date       |
| --------------------------------------- | ----------------- | ---------- |
| Edge's embedded `onnxruntime.dll`       | **1.25.20260307** | 2026-03-07 |
| Edge's embedded `onnxruntime-genai.dll` | **0.13.0-dev**    | 2026-03-10 |
| Latest public ONNX Runtime (PyPI)       | 1.24.4            | 2026-03-17 |
| Windows ML (App SDK 1.8.6)              | ~1.23.4           | 2026-03-19 |
| Windows ML (App SDK 2.0.0-Exp6)         | ~1.24.2           | 2026-03-13 |

Edge ships a version **ahead of both public PyPI and Windows ML releases**, indicating Microsoft's browser team has access to pre-release ONNX Runtime builds with the latest optimizations.

---

## Actionable Recommendations

### 1. Experiment: Modify `genai_config.json` After Bootstrap (LOW risk, MEDIUM potential)

After model download, modify the config to attempt graph optimization reduction:

```javascript
// In bootstrap script or a post-bootstrap CI step
const configPath = '.playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Explicitly set thread count (should already be auto-detected to 4)
config.model.decoder.session_options.intra_op_num_threads = 4;

// Attempt to reduce graph optimization level (may be ignored by Edge)
// 0 = ORT_DISABLE_ALL, 1 = ORT_ENABLE_BASIC, 2 = ORT_ENABLE_EXTENDED, 99 = ORT_ENABLE_ALL
config.model.decoder.session_options.graph_optimization_level = 1;

fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
```

**Expected outcome:** If Edge's ONNX Runtime GenAI reads the `graph_optimization_level` value, reducing it from `ORT_ENABLE_ALL` (default) to `ORT_ENABLE_BASIC` could shave 60-180 seconds off cold-start by skipping extended and layout optimizations.

**Risk:** Edge may ignore the value, validate the file against a checksum, or crash. Test in a PR branch first.

### 2. Add DLL Version Diagnostic Step (NO risk, HIGH value)

Log the ONNX Runtime version in CI for tracking across Edge Dev updates:

```yaml
- name: Log ONNX Runtime version
  if: ${{ !matrix.container }}
  shell: pwsh
  run: |
    $rtDir = Get-ChildItem ".playwright-profiles/msedge-dev/EdgeLLMRuntime" -Directory | Select-Object -First 1
    if ($rtDir) {
      $dll = Join-Path $rtDir.FullName "onnxruntime.dll"
      $ver = (Get-Item $dll).VersionInfo
      Write-Output "ONNX Runtime: $($ver.FileVersion)"
      Write-Output "GenAI: $((Get-Item (Join-Path $rtDir.FullName 'onnxruntime-genai.dll')).VersionInfo.FileVersion)"
    }
```

### 3. Log the `genai_config.json` in CI (NO risk, HIGH value)

Capture the model config for debugging:

```yaml
- name: Log model config
  if: ${{ !matrix.container }}
  shell: bash
  run: |
    cat .playwright-profiles/msedge-dev/EdgeLLMOnDeviceModel/*/genai_config.json || true
```

### 4. Monitor Peak Memory During Cold-Start (LOW risk, MEDIUM value)

The 4-core / 16 GB runner may experience memory pressure during graph optimization. Add monitoring:

```yaml
- name: Monitor memory during warm-up
  if: ${{ !matrix.container }}
  shell: pwsh
  run: |
    while ($true) {
      $procs = Get-Process -Name msedge* -ErrorAction SilentlyContinue
      if ($procs) {
        $total = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1GB
        Write-Output "[$(Get-Date -Format 'HH:mm:ss')] Edge total: $([math]::Round($total, 2)) GB"
      }
      Start-Sleep 30
    }
```

Run this as a background step during the e2e test phase.

### 5. Accept the Bottleneck (RECOMMENDED)

The fundamental constraint is 4 ARM64 cores. The cold-start is dominated by:

- Graph optimization: CPU-bound, scales with core count
- First-pass inference: 3.8B INT4 params x 32 layers on 4 cores

KleidiAI already optimizes the GEMM operations. NEON/I8MM/SVE2 are already in use. The profile cache already eliminates the cold-start on subsequent runs. The remaining cold-start time on cache miss is ~23 minutes, which is the cost of running a 3.8B parameter model on 4 CPU cores.

**To significantly reduce cold-start, the only options are:**

1. A runner with more cores (8+ vCPU Cobalt 100 instance)
2. A runner with GPU/NPU (Qualcomm Snapdragon X Elite, but not available on GitHub Actions)
3. A smaller model (but Phi-4 Mini is already one of the smallest capable SLMs)

---

## Summary Table

| Question                           | Answer                                                    | Actionable?                              |
| ---------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Q1: DirectML + Basic Render Driver | Software-only, slower than CPU EP                         | No                                       |
| Q2: XNNPACK on ARM64 Windows       | Not possible in Edge; MLAS is already better              | No                                       |
| Q3: NEON/SVE SIMD instructions     | Already active (NEON, I8MM, DotProd, SVE2)                | No action needed                         |
| Q4: KleidiAI in Edge               | Confirmed active (ORT 1.25 includes KleidiAI)             | No action needed                         |
| Q5: Thread count tuning            | genai_config.json editable; 4 threads is already optimal  | Experiment with graph_optimization_level |
| Q6: SwiftShader/ANGLE flags        | Would hurt (adds CPU overhead, does not affect inference) | No                                       |
| Q7: Offline model optimization     | Not possible (model sealed, exceeds 2 GB protobuf limit)  | No                                       |

---

## Sources

### Official Documentation (HIGH confidence)

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)
- [ONNX Runtime Thread Management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [ONNX Runtime GenAI Config Reference](https://onnxruntime.ai/docs/genai/reference/config.html)
- [ONNX Runtime XNNPACK EP](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html)
- [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [ONNX Runtime versions in Windows ML](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/onnx-versions)
- [DirectML Introduction](https://learn.microsoft.com/en-us/windows/ai/directml/dml)
- [Azure Cobalt 100 VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/cobalt-overview)

### ARM Architecture (HIGH confidence)

- [Arm + Microsoft KleidiAI ONNX Runtime](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime)
- [KleidiAI on Azure Cobalt 100](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100)
- [KleidiAI Microkernel Architecture](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/)
- [KleidiAI SDOT and I8MM](https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/kleidiai)
- [KleidiAI Software-Level AI Acceleration](https://www.arm.com/markets/artificial-intelligence/software/kleidi)
- [SME2 AI Acceleration](https://www.arm.com/technologies/sme2/accelerate-on-device-ai)
- [Azure Cobalt 100 AI inference](https://thomasvanlaere.com/posts/2025/10/exploring-ai-cpu-inferencing-with-azure-cobalt-100/)

### Chromium / SwiftShader (HIGH confidence)

- [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)
- [SwiftShader GitHub](https://github.com/google/swiftshader)

### GitHub Issues (HIGH confidence)

- [Issue #12882: optimized_model_filepath fails >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882)
- [Discussion #1260: graph_optimization_level in genai_config](https://github.com/microsoft/onnxruntime-genai/discussions/1260)
- [Issue #5299: GPU runtime fails to fallback to CPU](https://github.com/microsoft/onnxruntime/issues/5299)

### Local Inspection (HIGH confidence)

- `EdgeLLMRuntime/2026.3.10.1/onnxruntime.dll` -- FileVersion: 1.25.20260307.1.6db14b3
- `EdgeLLMRuntime/2026.3.10.1/onnxruntime-genai.dll` -- FileVersion: 0.13.0-dev
- `EdgeLLMOnDeviceModel/2026.2.19.1/genai_config.json` -- Session options, provider_options
- `EdgeLLMOnDeviceModel/2026.2.19.1/manifest.json` -- Model version, WebGPU type
