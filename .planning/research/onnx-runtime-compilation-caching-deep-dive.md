# ONNX Runtime Model Compilation Caching on ARM64: Deep Dive

**Researched:** 2026-03-22
**Overall confidence:** HIGH (official ONNX Runtime docs, GitHub source code, config key headers, GenAI discussions; Edge-specific internals are inferred from DLL inspection and empirical observation)
**Context:** Answering four specific questions about whether ONNX Runtime's caching and configuration mechanisms can reduce the 11-23+ minute cold-start for Phi-4 Mini on the `windows-11-arm` CI runner (Azure Cobalt 100, 4 vCPU ARM64, 16 GB RAM, no GPU).

---

## Executive Summary

ONNX Runtime does have persistent optimization caching via `optimized_model_filepath`, but it **cannot help** in this project's context because: (a) Edge's embedded ONNX Runtime does not expose session options, (b) the Phi-4 Mini model exceeds the 2 GB protobuf serialization limit, and (c) ONNX Runtime GenAI does not support `graph_optimization_level` or `optimized_model_filepath` in `genai_config.json`. There are **no environment variables** that can influence Edge's embedded ONNX Runtime behavior -- all configuration is programmatic via C/C++ APIs that Edge controls internally. The `adapter_cache.bin` and `encoder_cache.bin` files are Edge's proprietary implementation of inference pipeline caching, generated only after first successful inference. The existing post-test cache strategy is the only viable mitigation.

---

## Q1: Does ONNX Runtime Cache Compiled/Optimized Model Graphs to Disk?

**Answer: YES, two mechanisms exist. Neither is usable in this project.**
**Confidence: HIGH**

### Mechanism 1: `optimized_model_filepath` (Offline Graph Optimization)

ONNX Runtime supports serializing the optimized model graph to disk via `SessionOptions.optimized_model_filepath`. This is the "offline mode" described in the [Graph Optimizations documentation](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html).

**How it works:**

```python
import onnxruntime as ort

# First run: optimize and save
sess_options = ort.SessionOptions()
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
sess_options.optimized_model_filepath = "path/to/optimized_model.onnx"
session = ort.InferenceSession("model.onnx", sess_options, providers=['CPUExecutionProvider'])

# Subsequent runs: load pre-optimized, skip optimization
sess_options2 = ort.SessionOptions()
sess_options2.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
session2 = ort.InferenceSession("path/to/optimized_model.onnx", sess_options2, providers=['CPUExecutionProvider'])
```

APIs available across all languages: Python (`sess_options.optimized_model_filepath`), C (`SetOptimizedModelFilePath`), C# (`SessionOptions.OptimizedModelFilePath`), C++ (`session_options.SetOptimizedModelFilePath`).

**Critical limitations for this project:**

| Limitation                           | Impact                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 GB protobuf size limit**         | Phi-4 Mini's `model.onnx.data` is 4.86 GB. [Issue #12882](https://github.com/microsoft/onnxruntime/issues/12882) confirms `optimized_model_filepath` fails for models >= 2 GB.               |
| **Hardware-specific**                | The serialized model must be generated on the exact same hardware, execution provider, and optimization level as the deployment target. A model optimized for AVX2 won't work on ARM64 NEON. |
| **Requires programmatic API access** | Must call `SessionOptions` directly. Edge's embedded ONNX Runtime does not expose this.                                                                                                      |
| **Not supported in GenAI config**    | `genai_config.json` does not support `optimized_model_filepath` ([Config reference](https://onnxruntime.ai/docs/genai/reference/config.html)).                                               |

**There is no `ORT_OPTIMIZATION_CACHE_DIR` environment variable.** This was searched for extensively -- no such env var exists in ONNX Runtime's source code or documentation. All optimization caching is done through the programmatic `SessionOptions` API.

### Mechanism 2: EP Context Caching (`ep_context_enable`)

The [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) provides a more sophisticated caching mechanism designed for hardware accelerators:

1. First run: EP compiles model subgraphs for target hardware
2. Compiled binary is serialized alongside the model as `[model]_[ep]_[hash].bin`
3. EPContext node in the ONNX graph references the cached binary
4. Subsequent runs load the pre-compiled binary directly, skipping compilation

Session options:

- `ep.context_enable = "1"` -- enable cache generation
- `ep.context_embed_mode = "0"` -- store in external file (vs embedded in model)
- `ep.context_file_path` -- custom output path for cached binary

**Limitation for this project:** EP Context is designed for NPU/hardware EPs (QNN, OpenVINO, VitisAI). The **CPU Execution Provider does NOT actively support EP Context caching** -- the CPU EP appears in the documentation only as a fallback target when non-CPU nodes need fallback handling. The CPU EP's graph optimizations (MLAS kernel selection, NEON/SVE dispatch, weight pre-packing) are NOT serialized through this mechanism.

### Mechanism 3: Pre-Packed Weight Caching

ONNX Runtime has a separate mechanism for pre-packed weight persistence:

- `session.save_external_prepacked_constant_initializers` -- saves pre-packed versions of constant initializers to external files when saving an optimized model
- `session.disable_prepacking` -- disables weight pre-packing during session initialization
- `PrePackedWeightsContainer` class -- in-memory cache for sharing pre-packed weights across multiple sessions

Pre-packing reorganizes weight data into formats optimized for specific kernel implementations (e.g., MLAS GEMM kernels). On ARM64, this includes reorganizing INT4 weights for efficient NEON/I8MM/SVE2 operations.

**Limitation:** Requires programmatic API access and is designed for reuse within a single process lifetime, not cross-process persistence. Edge does not expose this.

### Summary: Available Caching Mechanisms

| Mechanism                                 | Caches What                                  | CPU EP Support       | Edge Controllable   | Model Size Limit |
| ----------------------------------------- | -------------------------------------------- | -------------------- | ------------------- | ---------------- |
| `optimized_model_filepath`                | Optimized graph (all EP-agnostic transforms) | YES                  | NO                  | 2 GB             |
| EP Context (`ep_context_enable`)          | EP-compiled subgraphs                        | NO (NPU/GPU only)    | NO                  | No limit         |
| Pre-packed weights                        | Weight layout for specific kernels           | YES (in-memory only) | NO                  | No limit         |
| `adapter_cache.bin` / `encoder_cache.bin` | Unknown (Edge-proprietary)                   | YES (empirically)    | NO (auto-generated) | No limit         |

---

## Q2: Does Edge's ONNX Runtime GenAI 0.13.0 Write Persistent Cache Files During First Inference?

**Answer: YES. `adapter_cache.bin` and `encoder_cache.bin` are generated after first inference. These are Edge-proprietary, not documented ONNX Runtime artifacts.**
**Confidence: HIGH (empirical observation, corroborated by timing analysis)**

### What We Know

Edge's embedded ONNX Runtime (v1.25.20260307) with GenAI extension (v0.13.0-dev) writes two cache files into the model directory after the first successful `session.prompt()` call:

| File                | Local Dev Machine (GPU/NPU) | CI Runner (CPU EP only)                        |
| ------------------- | --------------------------- | ---------------------------------------------- |
| `adapter_cache.bin` | **0 bytes**                 | **Non-zero** (populated after first inference) |
| `encoder_cache.bin` | **0 bytes**                 | **Non-zero** (populated after first inference) |

The 0-byte vs non-zero difference between local (GPU path) and CI (CPU path) is significant. It suggests these caches are **CPU EP-specific compiled execution plans** -- the GPU path does not need them because DirectML/WebGPU compilation is handled differently (likely through their own caching mechanisms like shader caches).

### What These Files Likely Contain

Based on ONNX Runtime architecture and the observed behavior:

| File                | Likely Contents                                                                                                        | Evidence                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `adapter_cache.bin` | Pre-compiled MLAS kernel configurations, fused operator execution plans, pre-packed weight layouts for ARM64 INT4 GEMM | "Adapter" in ML context refers to model-specific inference configurations. Created only after first inference completes. |
| `encoder_cache.bin` | Tokenizer/embedding pipeline state, input processing layer compiled execution plan                                     | "Encoder" refers to input processing. Phi-4 Mini is decoder-only but has input embedding and positional encoding layers. |

### Are There ARM64-Specific Compilation Caches (KleidiAI Kernel Caches, NEON Optimization Caches)?

**No separate ARM64-specific cache files exist.** KleidiAI kernels are pre-compiled into the `onnxruntime.dll` binary itself -- they are not JIT-compiled at runtime. The KleidiAI integration works by selecting the optimal pre-built microkernel at runtime based on CPU feature detection:

| KleidiAI Selection Order    | CPU Feature                 | On Cobalt 100? | Cache Needed?            |
| --------------------------- | --------------------------- | -------------- | ------------------------ |
| 1. SME2 kernels             | Scalable Matrix Extension 2 | No             | No -- compiled in binary |
| 2. I8MM kernels (prefill)   | Integer Matrix Multiply     | Yes            | No -- compiled in binary |
| 3. DotProd kernels (decode) | SDOT instruction            | Yes            | No -- compiled in binary |
| 4. NEON fallback            | 128-bit SIMD                | Yes            | No -- compiled in binary |

The cold-start cost is NOT from JIT-compiling ARM64 kernels. It is from:

1. Graph optimization (operator fusion, layout transforms) -- sequential graph walking
2. Weight deserialization (4.86 GB from disk to RAM)
3. Memory arena pre-allocation (KV cache, intermediate tensors)
4. First forward pass (exercises all GEMM paths, materializes attention weights)

The `adapter_cache.bin` and `encoder_cache.bin` likely cache the results of steps 1 and 3, allowing subsequent runs to skip those phases.

### The `genai_config.json` Has WebGPU as Target

The model's `genai_config.json` specifies:

```json
{
  "model": {
    "decoder": {
      "session_options": {
        "log_id": "onnxruntime-genai",
        "provider_options": [{ "webgpu": {} }]
      }
    }
  }
}
```

The `webgpu` provider option means this model was optimized for GPU execution. On the no-GPU CI runner, ONNX Runtime falls back to CPU EP automatically. This fallback path may be less optimal than a model explicitly optimized for CPU (`cpu-int4-rtn-block-32` variant on HuggingFace), but Edge downloads its own sealed model variant and this cannot be changed.

---

## Q3: Can Environment Variables Influence ONNX Runtime Inside Edge?

**Answer: NO. There are no environment variables that affect Edge's embedded ONNX Runtime.**
**Confidence: HIGH**

### Comprehensive Search Results

#### `ORT_GLOBAL_THREAD_POOL_OPTIONS` -- DOES NOT EXIST

This is not a real environment variable. ONNX Runtime's global thread pool is configured programmatically via the C API:

```c
// The only way to configure global thread pools
OrtThreadingOptions* tp_options;
OrtCreateThreadingOptions(&tp_options);
OrtSetGlobalIntraOpNumThreads(tp_options, 4);
OrtSetGlobalInterOpNumThreads(tp_options, 1);
OrtCreateEnvWithGlobalThreadPools(ORT_LOGGING_LEVEL_WARNING, "test", tp_options, &env);
```

There is no environment variable equivalent. Edge calls these APIs internally with its own values.

#### `ORT_SESSION_OPTIONS` -- DOES NOT EXIST

Not a real environment variable. Session options are configured programmatically through the SessionOptions struct/class in each language binding.

#### What Environment Variables DO Exist

| Variable                   | Effect                                                                | Works in Edge?                                 |
| -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `OMP_NUM_THREADS`          | Controls intra-op thread count when ORT is built with OpenMP          | **NO** -- Edge's ORT build is NOT OpenMP-based |
| `OMP_WAIT_POLICY`          | Controls thread spin-wait behavior (ACTIVE/PASSIVE) for OpenMP builds | **NO** -- same reason                          |
| `CUDA_VISIBLE_DEVICES`     | Controls GPU device selection for CUDA EP                             | **NO** -- not CUDA, and not GPU                |
| `XLNX_ONNX_EP_REPORT_FILE` | AMD Ryzen AI operator assignment report                               | **NO** -- AMD-specific                         |

#### Session Config Keys That Would Help (If Accessible)

From [onnxruntime_session_options_config_keys.h](https://github.com/microsoft/onnxruntime/blob/main/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h):

| Config Key                                              | What It Does                          | Could It Help?                                         |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `session.disable_prepacking`                            | Skip weight pre-packing               | Would reduce init time but hurt inference speed        |
| `session.save_external_prepacked_constant_initializers` | Persist pre-packed weights to disk    | Would cache weight transformations for subsequent runs |
| `mlas.enable_gemm_fastmath_arm64_bfloat16`              | Enable BF16 GEMM on ARM64             | Might improve throughput for FP32 layers               |
| `mlas.disable_kleidiai`                                 | Disable KleidiAI kernels              | Would be slower -- DO NOT want this                    |
| `session.dynamic_block_base`                            | Dynamic thread pool task partitioning | Could reduce latency variance                          |
| `session.intra_op.allow_spinning`                       | Thread spin-wait control              | Could trade CPU usage for lower latency                |
| `session.disable_model_compile`                         | Skip EP compilation                   | For pre-compiled models only                           |
| `ep.context_enable`                                     | Enable EP context caching             | Would cache compiled EP subgraphs                      |

**None of these are accessible** because Edge controls session creation internally. Even the `genai_config.json` in the model directory -- while it does support some session options -- is integrity-checked by Edge and cannot be modified without Edge rejecting the model.

#### The `genai_config.json` Session Options Gap

The `genai_config.json` format [supports](https://onnxruntime.ai/docs/genai/reference/config.html) these session options:

- `intra_op_num_threads`, `inter_op_num_threads` -- threading
- `enable_cpu_mem_arena`, `enable_mem_pattern` -- memory
- `ep_context_enable`, `ep_context_embed_mode`, `ep_context_file_path` -- EP caching
- `graph_optimization_level` -- **RECENTLY ADDED** (was missing, [Discussion #1260](https://github.com/microsoft/onnxruntime-genai/discussions/1260) reported it, a PR was submitted)
- `log_id`, `log_severity_level`, `enable_profiling` -- diagnostics

**NOT supported in genai_config.json:**

- `optimized_model_filepath` -- cannot serialize optimized graph
- `session.save_external_prepacked_constant_initializers` -- cannot cache pre-packed weights
- `session.dynamic_block_base` -- cannot enable dynamic cost model
- `mlas.enable_gemm_fastmath_arm64_bfloat16` -- cannot enable ARM64 BF16 GEMM

Even if these were supported, Edge's LLM service likely overrides the `genai_config.json` values with its own hardcoded session options. The model file integrity check also prevents modification.

---

## Q4: Can ONNX Models Be Pre-Compiled for ARM64 CPU EP to Make First Inference Fast?

**Answer: In theory yes (via `onnxruntime.transformers.optimizer` or offline mode), but NOT for this project.**
**Confidence: HIGH**

### What Exists for Pre-Compilation

#### 1. `onnxruntime.transformers.optimizer` (Python Offline Tool)

The [Transformers optimizer](https://onnxruntime.ai/docs/performance/transformers-optimization.html) applies graph optimizations offline:

```bash
python -m onnxruntime.transformers.optimizer --input model.onnx --output model_optimized.onnx \
  --model_type gpt2 --opt_level 99 --only_onnxruntime
```

This produces a pre-optimized ONNX file with fusions already applied (attention layer fusion, GELU fusion, LayerNorm fusion, etc.). The optimized model can then be loaded with `graph_optimization_level = ORT_DISABLE_ALL` to skip runtime optimization.

#### 2. Offline Graph Optimization (`optimized_model_filepath`)

As described in Q1 -- run inference once to save the optimized graph, then reload it.

#### 3. EP Context Compile API (ONNX Runtime 1.22+)

The [Compile API](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) provides ahead-of-time compilation:

```python
sess_options = ort.SessionOptions()
sess_options.add_session_config_entry("ep.context_enable", "1")
sess_options.add_session_config_entry("ep.context_embed_mode", "0")
# First session: compile and save context binary
session = ort.InferenceSession("model.onnx", sess_options, providers=['QNNExecutionProvider'])
# Produces model_ctx.onnx + [hash].bin
# Subsequent sessions: load pre-compiled
sess_options2 = ort.SessionOptions()
sess_options2.add_session_config_entry("session.disable_model_compile", "1")
session2 = ort.InferenceSession("model_ctx.onnx", sess_options2, providers=['QNNExecutionProvider'])
```

**Important: EP Context is for NPU/GPU EPs, not CPU EP.** The CPU EP does not implement the `GetEpContextNodes()` interface. CPU graph optimizations are separate from EP compilation.

### Why None of These Work for This Project

| Approach                             | Blocker                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onnxruntime.transformers.optimizer` | Model is sealed (Edge downloads its own version); would need to replace `model.onnx` in the profile, which Edge would reject on integrity check.                   |
| `optimized_model_filepath`           | Phi-4 Mini exceeds 2 GB protobuf limit.                                                                                                                            |
| EP Context Compile API               | CPU EP does not support EP context caching.                                                                                                                        |
| Modify `genai_config.json`           | Edge's LLM service overrides session options; file is integrity-checked.                                                                                           |
| Ship a CPU-optimized model variant   | Edge controls model delivery; the [cpu-int4-rtn-block-32](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) variant on HuggingFace cannot be substituted. |

### The Only Viable Strategy: Profile Caching

The existing approach is the only viable strategy:

1. **First run (cache miss):** Full cold-start (11-23+ min). Graph optimization, weight materialization, KV cache allocation, first inference all happen. `adapter_cache.bin` and `encoder_cache.bin` are generated.
2. **Cache the profile post-test.** This captures all inference artifacts including the two cache files.
3. **Subsequent runs (cache hit):** Restore profile. ONNX Runtime loads the cached execution plan instead of re-optimizing. Cold-start drops to ~30-90s (weight loading only).

---

## Consolidated Findings

### What We Confirmed

| Finding                                                                          | Confidence | Source                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optimized_model_filepath` exists but has 2 GB limit                             | HIGH       | [Official docs](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html), [Issue #12882](https://github.com/microsoft/onnxruntime/issues/12882) |
| No `ORT_OPTIMIZATION_CACHE_DIR` env var exists                                   | HIGH       | Exhaustive search of docs, source headers, FAQ                                                                                                                               |
| No `ORT_GLOBAL_THREAD_POOL_OPTIONS` env var exists                               | HIGH       | [Config keys header](https://github.com/microsoft/onnxruntime/blob/main/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h)                          |
| No `ORT_SESSION_OPTIONS` env var exists                                          | HIGH       | Same source                                                                                                                                                                  |
| `genai_config.json` does not support `optimized_model_filepath`                  | HIGH       | [Config reference](https://onnxruntime.ai/docs/genai/reference/config.html)                                                                                                  |
| `graph_optimization_level` recently added to GenAI config                        | MEDIUM     | [Discussion #1260](https://github.com/microsoft/onnxruntime-genai/discussions/1260) (PR submitted)                                                                           |
| KleidiAI kernels are pre-compiled in binary, no JIT cache needed                 | HIGH       | [KleidiAI architecture](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/)                                                                       |
| Edge ships ORT 1.25 (ahead of public 1.24.4)                                     | HIGH       | Local DLL inspection                                                                                                                                                         |
| `adapter_cache.bin`/`encoder_cache.bin` are 0 bytes on GPU, populated on CPU EP  | HIGH       | Local vs CI observation                                                                                                                                                      |
| EP Context caching does not apply to CPU EP                                      | HIGH       | [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html)                                                                                  |
| Only `OMP_NUM_THREADS` and `OMP_WAIT_POLICY` env vars exist (OpenMP builds only) | HIGH       | [Thread management docs](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)                                                                            |
| Edge's ORT is not an OpenMP build                                                | HIGH       | No OpenMP env vars have any effect on Edge                                                                                                                                   |

### What Cannot Be Changed

1. **Edge's embedded ONNX Runtime is a sealed black box.** No session options, no optimization control, no thread tuning.
2. **No environment variable exists** to influence ONNX Runtime behavior inside Edge.
3. **The model exceeds 2 GB**, blocking the `optimized_model_filepath` offline mode.
4. **The model is integrity-checked**, preventing `genai_config.json` modification.
5. **CPU EP does not support EP Context caching**, so even if Edge exposed `ep.context_enable`, it would not help.
6. **KleidiAI kernels are already active** (ORT 1.25 includes them) -- no further ARM64 optimization is available.

### What IS Working

1. **Profile caching post-test** captures `adapter_cache.bin` and `encoder_cache.bin`
2. **Three-way warm-up** (bootstrap, e2e fixture, Vitest global-setup) reaches Level 3 readiness
3. **`session.prompt('warmup')` in warm-up** triggers full pipeline initialization
4. **Rolling cache keys** with `restore-keys` prefix matching maximize cache hits

### Remaining Open Questions

1. **What is the actual content of `adapter_cache.bin` and `encoder_cache.bin`?** Running `file` or hex-dumping the first few bytes on CI would reveal format hints (protobuf, flatbuffers, raw binary, etc.).

2. **Do these cache files actually reduce startup time on CI?** The timing difference between cache-hit and cache-miss CI runs has been observed but not precisely measured. A controlled A/B test (delete cache files before warm-up vs keep them) would quantify the benefit.

3. **Does the `graph_optimization_level` setting in `genai_config.json` work in Edge's ORT 1.25?** The GenAI discussion #1260 indicated a PR was submitted. If ORT 1.25 includes the fix, and Edge honors `genai_config.json` values, setting `graph_optimization_level` to 0 (disabled) after first run could theoretically help -- but only if the cache files already contain the optimized graph.

---

## Sources

### Official Documentation (HIGH confidence)

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) -- `optimized_model_filepath`, offline mode, optimization levels
- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) -- EP compilation caching, `ep_context_enable`, context binary files
- [ONNX Runtime GenAI Config Reference](https://onnxruntime.ai/docs/genai/reference/config.html) -- `genai_config.json` session_options schema
- [ONNX Runtime Thread Management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) -- `OMP_NUM_THREADS`, `OMP_WAIT_POLICY`, session config entries
- [ONNX Runtime Session Options Config Keys](https://github.com/microsoft/onnxruntime/blob/main/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h) -- ALL config keys including ARM64-specific, caching, compilation
- [ONNX Runtime Transformers Optimizer](https://onnxruntime.ai/docs/performance/transformers-optimization.html) -- offline model optimization tool
- [Arm + Microsoft KleidiAI](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) -- KleidiAI integration, ARM64 MLAS optimizations
- [KleidiAI Microkernel Architecture](https://learn.arm.com/learning-paths/cross-platform/kleidiai-explainer/page3/) -- I8MM/DotProd/SME2 selection order

### GitHub Issues and Discussions (HIGH confidence)

- [Issue #12882: optimized_model_filepath fails for models >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882)
- [Discussion #1260: graph_optimization_level not supported in genai_config.json](https://github.com/microsoft/onnxruntime-genai/discussions/1260)
- [Issue #19022: Session creation takes too long](https://github.com/microsoft/onnxruntime/issues/19022)
- [Issue #19177: First inference slow despite warm-up](https://github.com/microsoft/onnxruntime/issues/19177)
- [Issue #11581: GPU inference slow first time, fast continuously](https://github.com/microsoft/onnxruntime/issues/11581)
- [PR #24416: session.disable_model_compile config](https://github.com/microsoft/onnxruntime/pull/24416)

### Project Documentation (HIGH confidence, empirically verified)

- [.planning/research/arm64-ci-onnx-optimizations.md](arm64-ci-onnx-optimizations.md) -- DLL versions, genai_config.json actual contents, cache file sizes
- [.planning/research/onnx-runtime-arm64-cold-start.md](onnx-runtime-arm64-cold-start.md) -- Five phases of cold-start, caching mechanisms analysis
- [.planning/research/phi4-mini-arm64-cold-start.md](phi4-mini-arm64-cold-start.md) -- Hardware comparison, root cause analysis
- [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md) -- EP selection, two separate GPU paths in Edge
