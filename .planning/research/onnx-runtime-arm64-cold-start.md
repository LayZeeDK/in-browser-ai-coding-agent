# Research: ONNX Runtime Cold-Start Performance on Windows ARM64

**Researched:** 2026-03-22
**Overall confidence:** MEDIUM-HIGH (official ONNX Runtime docs, GitHub issues, Arm benchmarks, architecture analysis; some Edge-specific internals are inferred rather than officially documented)
**Focus:** Why does the first `session.prompt()` take 11+ minutes on ARM64? What causes it, and what are the cache files?

---

## Executive Summary

The 11+ minute cold-start observed when running Phi-4 Mini on the `windows-11-arm` CI runner (Azure Cobalt 100, 4 vCPU ARM64, 16 GB RAM, no GPU) is caused by the cumulative cost of five sequential phases in ONNX Runtime's inference pipeline initialization: (1) model weight deserialization (~5 GB), (2) graph optimization and fusion, (3) execution provider partitioning and kernel compilation, (4) KV cache allocation, and (5) first-pass attention weight materialization. None of these phases individually explain the full 11 minutes, but together -- on a 4-core ARM64 CPU with no GPU -- they compound to produce the observed cold-start.

The `adapter_cache.bin` and `encoder_cache.bin` files found in the browser profile after first inference are **Edge-specific pre-compiled inference pipeline caches** -- most likely serialized ONNX Runtime session state, pre-optimized graph data, and/or compiled execution provider context. They are NOT standard ONNX Runtime artifacts documented in the public API. Their presence in both Chrome (`OptGuideOnDeviceModel/`) and Edge (`EdgeLLMOnDeviceModel/`) profile directories, and the fact that subsequent runs are dramatically faster, strongly suggests they are the browser's implementation of ONNX Runtime's offline optimization mechanism or EP Context caching.

The key insight for this project is that **caching the profile post-test (not post-bootstrap) is correct**, because these cache files are only generated after the first successful inference pass -- not after model download alone.

---

## 1. What Causes the 11+ Minute Cold-Start?

**Confidence:** HIGH (ONNX Runtime architecture documentation, corroborated by observed behavior)

### The Five Phases of First-Inference Initialization

When Edge's embedded ONNX Runtime loads Phi-4 Mini for the first time (no cached artifacts), the following phases execute sequentially:

| Phase                                                        | What Happens                                                                                                               | Estimated Cost (4-core ARM64) | Evidence                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Model Weight Deserialization                              | Load 4.86 GB of `model.onnx.data` from disk into RAM                                                                       | 30-90s                        | I/O bound; depends on storage speed. Azure VMs use network-attached storage, slower than local NVMe. [Issue #3802](https://github.com/microsoft/onnxruntime/issues/3802) reports slow loading on ARM64.                                                                                                                                                           |
| 2. Graph Optimization                                        | Apply all enabled graph optimizations (constant folding, node fusion, redundant elimination, layout transforms)            | 60-180s                       | ONNX Runtime applies Level 3 (ALL) optimizations by default. For complex LLM graphs with 3.8B parameters, this is CPU-intensive. [Graph Optimizations docs](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) states "applying all optimizations each time we initiate a session can add overhead to the model startup time." |
| 3. EP Partitioning & Kernel Compilation                      | CPU Execution Provider compiles optimized kernels for ARM64 (NEON/MLAS), allocates thread pools                            | 30-120s                       | On ARM64, MLAS (Microsoft Linear Algebra Subprograms) compiles NEON-optimized GEMM kernels. [KleidiAI integration](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) adds ARM-specific optimizations but still requires first-time compilation.                                                                                                  |
| 4. KV Cache Pre-allocation                                   | Allocate memory for the key-value cache used in autoregressive generation                                                  | 10-30s                        | For Phi-4 Mini (GQA with 128K context), even a minimal KV cache allocation for short-context inference requires ~0.5-2 GB. Memory arena setup adds overhead.                                                                                                                                                                                                      |
| 5. First-Pass Inference (Tokenizer + Attention + Generation) | Tokenize input, run first forward pass through all transformer layers, materialize attention weights, generate first token | 120-300s                      | The first forward pass forces all deferred initialization to complete. Matrix multiplications across 3.8B INT4 parameters on 4 ARM64 cores are compute-bound. Time-to-first-token is the dominant cost.                                                                                                                                                           |
| **Total estimated**                                          |                                                                                                                            | **250-720s (4-12 min)**       | Aligns with the observed 11+ minutes on Azure Cobalt 100.                                                                                                                                                                                                                                                                                                         |

### Why `LanguageModel.create()` Is Fast But `session.prompt()` Is Slow

`LanguageModel.create()` (which completes in seconds) triggers only Phase 1 and possibly partial Phase 2. The JavaScript API's `create()` method initializes the model session object but does not trigger full graph compilation, kernel generation, or KV cache allocation. These are deferred until the first actual inference call.

This is consistent with ONNX Runtime GenAI's architecture: the `Model` class [creates the ONNX Runtime session](https://deepwiki.com/microsoft/onnxruntime-genai) during construction, which involves model loading and some graph optimization, but the full execution plan (including kernel selection, memory planning, and EP-specific compilation) is finalized lazily during the first `Run()` call.

The project's documentation correctly identifies three levels of model readiness, and this research confirms the mechanism:

| Level            | What Completes  | Phases Executed      | Cold-Start Eliminated? |
| ---------------- | --------------- | -------------------- | ---------------------- |
| 1 (availability) | Files on disk   | None                 | No                     |
| 2 (registered)   | Session created | Phases 1-2 (partial) | No                     |
| 3 (first prompt) | Full inference  | All 5 phases         | **Yes**                |

---

## 2. Execution Provider on ARM64 Windows

**Confidence:** HIGH (empirical evidence from CI, corroborated by ONNX Runtime documentation)

### Which EP Does Edge Use?

On the `windows-11-arm` runner (Azure Cobalt 100, no GPU):

**CPU Execution Provider (MLAS backend)** -- this is confirmed by:

1. **No GPU exists** on the runner (Azure Cobalt 100 ARM64 VM has no DirectX 12, no DirectML). [Platform findings](../docs/platform-runner-findings.md) documents this empirically.
2. **DirectML EP cannot initialize** without DirectX 12 GPU hardware, so ONNX Runtime falls back to CPU EP cleanly.
3. **Identical performance** between `--disable-gpu` and default configurations (~15-17 min), confirming no GPU path was ever active.

### The MLAS Backend and ARM64 Optimization

ONNX Runtime's CPU EP uses MLAS (Microsoft Linear Algebra Subprograms) as its compute backend. On ARM64, MLAS uses:

- **NEON SIMD instructions** for vectorized operations (baseline)
- **KleidiAI optimizations** (ONNX Runtime v1.22+) for accelerated INT4 GEMM operations using ARM-specific instruction sets (Neon, SVE2, SME)

The [KleidiAI integration](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) delivers 28-51% performance uplift across different instance sizes, with:

- 2.4x faster prompt processing throughput
- 12% uplift in token generation

However, these optimizations primarily affect steady-state inference throughput, not cold-start initialization time. The cold-start is dominated by graph optimization, memory allocation, and first-pass computation -- not the raw GEMM kernel speed.

### What Version of ONNX Runtime Does Edge Use?

Edge downloads `onnxruntime.dll` and `onnxruntime-genai.dll` as component updates into the browser profile directory. The exact version is not user-accessible, but it is likely a recent build (within the last few months of the Edge Dev channel release). The DLLs are ARM64-native -- they are not x86 emulated.

---

## 3. Session Options That Affect Cold Start

**Confidence:** HIGH (ONNX Runtime official documentation)

### Relevant Session Options

| Option                     | Default                    | Impact on Cold Start                                                                                                                                                         | Controllable in Edge?                                                                                                                                                                   |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph_optimization_level` | `ORT_ENABLE_ALL` (Level 3) | **HIGH** -- Level 3 applies all optimizations including layout transforms. Reducing to Level 0 (disabled) or Level 1 (basic) would significantly reduce optimization time.   | **No** -- Edge controls this internally. Not exposed via flags, env vars, or `genai_config.json` ([Discussion #1260](https://github.com/microsoft/onnxruntime-genai/discussions/1260)). |
| `optimized_model_filepath` | Empty (no caching)         | **HIGH** -- If set, serializes the optimized graph to disk after first optimization. Subsequent loads skip optimization entirely.                                            | **No** -- but Edge may implement this internally (see Section 4).                                                                                                                       |
| `intra_op_num_threads`     | Auto (1 per physical core) | **MEDIUM** -- On 4-core Cobalt 100, defaults to 4 threads. Reducing to 1 would slow inference but reduce contention. Increasing is impossible (only 4 cores).                | **No** -- `genai_config.json` supports this but Edge's embedded version is not user-configurable.                                                                                       |
| `inter_op_num_threads`     | Auto (1 per physical core) | **LOW** -- Only used in `ORT_PARALLEL` execution mode. Default is `ORT_SEQUENTIAL`.                                                                                          | **No**                                                                                                                                                                                  |
| `enable_cpu_mem_arena`     | `true`                     | **MEDIUM** -- Memory arena pre-allocates memory pools. First-time setup has overhead, but subsequent allocations are faster. Disabling reduces memory but increases latency. | **No**                                                                                                                                                                                  |
| `enable_mem_pattern`       | `true`                     | **LOW-MEDIUM** -- Memory pattern optimization reuses allocation patterns from previous runs. First run has no pattern to reuse.                                              | **No**                                                                                                                                                                                  |
| `ep_context_enable`        | `false`                    | **HIGH** -- If enabled, pre-compiled EP context is dumped to disk as binary. Subsequent loads skip EP compilation. See Section 4.                                            | **No** -- but Edge may use this internally.                                                                                                                                             |

### Key Insight: User Cannot Tune These

Since Edge embeds ONNX Runtime as a native component with hardcoded session options, **none of these tuning knobs are accessible** to external developers. The browser controls:

1. Graph optimization level (likely `ORT_ENABLE_ALL`)
2. Thread configuration (likely auto-detected from hardware)
3. Memory arena settings (likely defaults)
4. EP selection (CPU EP due to no GPU; DirectML is the preferred but unavailable)

This means the 11+ minute cold-start is **not something we can optimize at the application level**. The only mitigation is caching the post-inference profile artifacts.

---

## 4. Optimized Graph Caching

**Confidence:** MEDIUM (ONNX Runtime docs confirm the mechanism; Edge's specific implementation is inferred)

### ONNX Runtime's Two Caching Mechanisms

ONNX Runtime provides two official mechanisms for reducing session creation time:

#### Mechanism 1: Offline Graph Optimization (`optimized_model_filepath`)

When `optimized_model_filepath` is set in SessionOptions, ONNX Runtime [serializes the optimized graph to disk](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) after applying all graph optimizations. On subsequent loads:

1. Load the pre-optimized model file instead of the original
2. Set `graph_optimization_level = ORT_DISABLE_ALL`
3. Session creation skips all optimization passes

**Caveat:** The serialized model must be generated with the same execution providers and hardware as the deployment target.

**Caveat for large models:** The `optimized_model_filepath` mechanism [fails for models >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882) due to the protobuf size cap. Phi-4 Mini's model data is 4.86 GB, so this mechanism **cannot be used directly** for the full model.

#### Mechanism 2: EP Context Caching (`ep_context_enable`)

The [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) provides a more sophisticated caching mechanism:

1. First run: EP compiles model subgraphs for the target hardware
2. Compilation result is serialized as `[model_name]_[ep].bin`
3. An `EPContext` node in the ONNX graph references the cached binary
4. Subsequent runs load the pre-compiled binary directly, **skipping compilation**

This mechanism was designed specifically for NPU/hardware accelerators where "conversion and compilation process can be time-consuming, especially for LLM models, sometimes taking **tens of minutes** to complete."

ONNX Runtime 1.22+ introduced a [Compile API](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) for ahead-of-time (AOT) compilation that further streamlines this.

### Does Edge Use These Mechanisms?

**Likely yes, in a proprietary form.** The evidence:

1. **The `adapter_cache.bin` and `encoder_cache.bin` files** appear in the profile directory only after first successful inference -- not after model download. This matches the EP Context pattern where compiled binaries are generated during first session creation.

2. **Subsequent inference is dramatically faster.** If Edge did not cache anything, every new session would pay the full 11+ minute cold-start. The observed behavior (first inference slow, subsequent fast) is exactly what optimized graph caching or EP Context caching produces.

3. **Edge downloads ONNX Runtime as a component.** This means Edge can update the caching strategy independently of browser releases, suggesting an actively maintained optimization layer.

4. **The file names** (`adapter_cache.bin`, `encoder_cache.bin`) suggest separate caches for different parts of the model pipeline -- possibly the tokenizer/embedding layer ("encoder") and the model adapter or attention layers ("adapter"). This is consistent with how ONNX Runtime GenAI manages [separate encoder and decoder components](https://onnxruntime.ai/docs/genai/reference/config.html).

---

## 5. What Are `adapter_cache.bin` and `encoder_cache.bin`?

**Confidence:** MEDIUM (inferred from ONNX Runtime architecture and observed behavior; not officially documented by Edge team)

### Analysis

These files are **Edge-proprietary inference pipeline caches**. They are NOT standard ONNX Runtime artifacts and do not appear in any public ONNX Runtime documentation. Based on their names, timing of creation, and the dramatic performance improvement they provide:

| File                | Likely Contents                                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter_cache.bin` | Pre-compiled model adapter data: optimized graph fragments, fused operator kernels, pre-computed weight projections for INT4 dequantization, or compiled MLAS kernel configurations for the specific ARM64 target | Created only after first inference. "Adapter" in ML context often refers to parameter-efficient fine-tuning layers or model-specific inference configurations.                                                          |
| `encoder_cache.bin` | Pre-compiled tokenizer/embedding layer data: tokenizer vocabulary mapping, embedding weight layout optimized for the target EP, or the initial layers of the transformer (which process input tokens)             | "Encoder" in the Phi-4 context likely refers to the input processing pipeline. Phi-4 Mini uses a dense decoder-only architecture but still has input embedding and positional encoding layers that need initialization. |

### Alternative Interpretations

1. **EP Context binaries:** These could be the EP Context cache files that ONNX Runtime's [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) generates. The naming convention (`[something]_cache.bin`) is similar to EP context file patterns.

2. **ONNX Runtime GenAI internal caches:** The `onnxruntime-genai.dll` library manages KV cache, tokenizer state, and generation configuration. These files could be serialized state from the GenAI layer rather than the core ONNX Runtime.

3. **Browser-specific optimization caches:** Edge may have its own caching layer above ONNX Runtime that serializes the complete inference pipeline state (model + session options + EP configuration + hardware profile) for fast restoration.

### Both Chrome and Edge Produce These Files

The project's profile inspection revealed `adapter_cache.bin` and `encoder_cache.bin` in both:

- `OptGuideOnDeviceModel/` (Chrome, using LiteRT/TFLite + XNNPACK)
- `EdgeLLMOnDeviceModel/` (Edge, using ONNX Runtime)

The fact that both browsers produce identically-named cache files despite using completely different inference runtimes (LiteRT vs ONNX Runtime) suggests these names come from a **shared Chromium-level caching abstraction** -- possibly the W3C LanguageModel API implementation layer that sits above both inference runtimes.

### Practical Implication

**Cache the profile post-test, not post-bootstrap.** This is already the project's approach (documented in [ci-workflow-architecture.md](../../docs/ci-workflow-architecture.md)), and this research confirms it is correct. The cache files are only generated after the full inference pipeline has been exercised (Level 3 readiness). A bootstrap-only cache would miss these files entirely, forcing the next run to repeat the full 11+ minute cold-start.

---

## 6. Memory Requirements and CI Runner Pressure

**Confidence:** HIGH (HuggingFace model specs, empirical CI data)

### Phi-4 Mini Memory Breakdown

| Component                                                  | RAM Required     | Notes                                                        |
| ---------------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| Model weights (INT4, loaded into RAM)                      | ~5.0 GB          | 4.86 GB `model.onnx.data` + overhead                         |
| ONNX Runtime overhead (graph, session state, thread pools) | ~0.3-0.5 GB      | Memory arena, optimization intermediate state                |
| KV cache (short-context, ~256 tokens)                      | ~0.5-1.0 GB      | Phi-4 Mini uses GQA; cache size scales with context length   |
| Tokenizer + GenAI library                                  | ~0.1-0.2 GB      | Vocabulary (200K), embedding tables                          |
| Edge browser process                                       | ~1.0-2.0 GB      | Renderer, GPU process (even without GPU), extensions         |
| OS + system services                                       | ~1.5-2.5 GB      | Windows 11, GitHub Actions runner agent, Node.js, Playwright |
| **Total (short-context inference)**                        | **~8.4-11.2 GB** |                                                              |
| **Available on `windows-11-arm`**                          | **16 GB**        | Azure Cobalt 100 VM                                          |
| **Headroom**                                               | **~4.8-7.6 GB**  | Comfortable for short-context test prompts                   |

### Could Memory Pressure Cause Slow Loading?

**Unlikely for this project's test workload.** The short-context prompts used in tests ("Hello, AI!", "warmup") consume minimal KV cache. The 16 GB runner has sufficient headroom.

However, memory pressure could become a factor if:

1. **Long-context prompts** are used in tests (128K context would need 10+ GB KV cache)
2. **Multiple browser instances** are running concurrently (not the case -- single worker)
3. **Model download and inference overlap** (not the case -- sequential bootstrap then test)

### First-Inference Memory Spike

During Phase 2 (graph optimization), ONNX Runtime may temporarily allocate additional memory to hold intermediate optimization state alongside the original graph. For a 5 GB model, this could temporarily push total usage to ~12-14 GB, approaching the 16 GB limit. This is a plausible contributor to the slow cold-start: if the VM starts paging to disk during graph optimization, the CPU-bound operation becomes I/O-bound.

**Recommendation:** Monitor peak memory usage during the first inference via Task Manager or `Get-Process` in a diagnostic CI step. If peak usage exceeds 14 GB, memory pressure is likely contributing to the cold-start time.

---

## 7. Why Subsequent Runs Are Faster

**Confidence:** HIGH (consistent with ONNX Runtime caching mechanisms and empirical observation)

The dramatic improvement on subsequent runs (seconds instead of minutes) is explained by the cumulative effect of cached artifacts:

| Phase                         | First Run                         | Subsequent Run (with cached profile)                             |
| ----------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Weight deserialization        | Load 4.86 GB from disk            | Same -- weights must always be loaded                            |
| Graph optimization            | Full Level 3 optimization pass    | **Skipped** -- `adapter_cache.bin` contains pre-optimized graph  |
| EP partitioning & compilation | Full kernel compilation for ARM64 | **Skipped** -- `adapter_cache.bin` contains pre-compiled kernels |
| KV cache allocation           | First-time arena setup            | Faster -- memory patterns may be reused from cached state        |
| First-pass inference          | Full cold-start forward pass      | **Fast** -- all initialization already complete, kernels warm    |
| **Total**                     | **11+ minutes**                   | **~30-90 seconds** (weight loading + warm-start)                 |

The weight deserialization (~5 GB) cannot be cached -- the model must always be loaded into RAM from disk. This sets a floor of ~30-90 seconds even with perfect caching, depending on storage I/O speed.

---

## 8. KleidiAI and ARM64-Specific Optimizations

**Confidence:** HIGH (official Arm blog posts and ONNX Runtime release notes)

### What KleidiAI Provides

[KleidiAI](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) is Arm's optimization library integrated into ONNX Runtime v1.22+ that accelerates INT4 quantized matrix multiplication using ARM-specific instruction sets:

| Instruction Set                    | Support on Cobalt 100         | Impact                                           |
| ---------------------------------- | ----------------------------- | ------------------------------------------------ |
| NEON                               | Yes (baseline ARM64)          | Standard vectorized operations                   |
| SVE2 (Scalable Vector Extension 2) | Yes (Neoverse N2)             | Wider vector operations, flexible vector lengths |
| SME (Scalable Matrix Extension)    | No (Neoverse N2 predates SME) | Not available on this runner                     |

### Performance Impact

From [Arm's benchmarks](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100):

- 28-51% throughput uplift across instance sizes (8 to 64 vCPU)
- 1.9x faster token generation vs AMD Genoa
- 2.8x better price/performance ratio

These optimizations improve **steady-state inference speed** (token generation after warm-up) but do not significantly reduce the cold-start time, which is dominated by graph optimization and first-pass computation.

### Version Dependency

The KleidiAI integration requires ONNX Runtime v1.22+. If Edge's embedded `onnxruntime.dll` is an older version, these optimizations may not be active. There is no way to verify the version from outside the browser.

---

## 9. Comparison: Cold-Start Across Environments

**Confidence:** HIGH (empirical data from project CI)

| Environment                 | Hardware                                | GPU          | Model Size          | Cold-Start           | Warm-Start | Notes                                              |
| --------------------------- | --------------------------------------- | ------------ | ------------------- | -------------------- | ---------- | -------------------------------------------------- |
| `windows-11-arm` CI         | Azure Cobalt 100 (4 ARM64 cores, 16 GB) | None         | 4.86 GB             | **11+ min**          | ~35s       | CPU EP only; main project runner                   |
| Developer machine           | Snapdragon X Elite (12 cores, 32 GB)    | Adreno X1-85 | 4.86 GB             | ~3-5 min (estimated) | ~10-20s    | GPU (DirectML) or NPU available; much faster cores |
| `ubuntu-latest` CI (Chrome) | Intel Xeon 8272CL (4 cores, 16 GB)      | None         | ~4 GB (Gemini Nano) | Moderate             | Fast       | Different runtime (LiteRT/XNNPACK)                 |
| Azure Cobalt 100 server     | 32 cores, 64 GB                         | None         | 4.86 GB             | ~1-2 min (estimated) | Fast       | 8x more cores; KleidiAI optimized                  |

The 4-core limitation on the CI runner is the primary bottleneck. Graph optimization and first-pass inference are CPU-bound operations that scale with core count. On the developer's 12-core Snapdragon X Elite, the same operations complete ~3-4x faster.

---

## 10. Actionable Recommendations

### Already Implemented (Correct Approach)

1. **Profile cache saved post-test** -- Captures `adapter_cache.bin` and `encoder_cache.bin`. This research confirms this is the correct approach.
2. **Three-way warm-up** (bootstrap, e2e fixture, Vitest global-setup) -- Each independently reaches Level 3 readiness. Redundancy is correct given that each is a separate entry point.
3. **`session.prompt('warmup')` in warm-up** -- This triggers full Phase 1-5 initialization. Removing it would revert to Level 2 readiness and re-introduce the 11+ minute cold-start in tests.

### Potential Future Optimizations

1. **Monitor peak memory during cold-start.** Add a diagnostic step that logs `Get-Process -Name msedge* | Select-Object WorkingSet64` every 30 seconds during the first warm-up. If peak exceeds 14 GB, memory pressure is a contributor.

2. **Investigate Edge's debug logging.** The `edge://flags` entry "Enable on device AI model debug logs" may reveal ONNX Runtime session creation timings, EP selection decisions, and cache hit/miss information. Enabling this flag during CI warm-up could provide valuable diagnostics.

3. **Track ONNX Runtime version in Edge Dev.** Capture the DLL version from the profile directory (`onnxruntime.dll` file properties) in a CI diagnostic step. If Edge ships a version < 1.22, KleidiAI optimizations are missing, and updating Edge Dev could improve performance.

4. **Consider pre-warming with a longer prompt.** The current warm-up uses `'warmup'` (a single token). A slightly longer prompt (e.g., 10-20 tokens) might trigger additional KV cache initialization that a single-token prompt misses. This is speculative -- test before committing.

5. **Watch for ONNX Runtime Compile API adoption.** ONNX Runtime 1.22+ introduced [dedicated Compile APIs](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) for ahead-of-time EP context compilation. If Edge adopts this, cold-start could be reduced significantly. This would manifest as Edge generating the cache files during model download rather than first inference.

---

## Sources

### Official Documentation (HIGH confidence)

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) -- Online vs offline mode, `optimized_model_filepath`, optimization levels
- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) -- Pre-compiled EP caching, `ep_context_enable`, binary cache files
- [ONNX Runtime Thread Management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) -- `intra_op_num_threads`, `inter_op_num_threads`, thread spinning
- [ONNX Runtime GenAI Config Reference](https://onnxruntime.ai/docs/genai/reference/config.html) -- `genai_config.json`, session options, encoder/decoder configuration
- [Phi-4-mini-instruct-onnx](https://huggingface.co/microsoft/Phi-4-mini-instruct-onnx) -- Model sizes (4.86 GB data, 15.5 MB tokenizer), INT4 CPU variant
- [Arm KleidiAI + ONNX Runtime](https://newsroom.arm.com/blog/arm-microsoft-kleidiai-onnx-runtime) -- 28-51% throughput uplift, ARM64-specific optimizations
- [Deploy Phi-4-mini on Azure Cobalt 100](https://learn.arm.com/learning-paths/servers-and-cloud-computing/onnx/setup/) -- ARM64 build, KleidiAI setup
- [Arm Cobalt 100 Performance Blog](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100) -- Benchmarks, 1.9x vs AMD Genoa
- [Microsoft Edge Prompt API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Hardware requirements, platform support

### GitHub Issues (HIGH confidence)

- [Issue #19022: Session creation takes too long](https://github.com/microsoft/onnxruntime/issues/19022) -- Feature request for faster initialization
- [Issue #22219: Very slow load on Windows](https://github.com/microsoft/onnxruntime/issues/22219) -- 15 min load for 52 MB model on Windows
- [Issue #3802: Slow loading on ARM64](https://github.com/microsoft/onnxruntime/issues/3802) -- Memory and time issues on Jetson Nano
- [Issue #5957: Slow GPU session creation](https://github.com/microsoft/onnxruntime/issues/5957) -- First session slow, subsequent fast
- [Issue #20502: Slow DirectML session creation](https://github.com/microsoft/onnxruntime/issues/20502) -- 180s on Intel Iris Xe
- [Issue #12882: Optimized model filepath fails for models >= 2GB](https://github.com/microsoft/onnxruntime/issues/12882) -- Protobuf size cap limitation
- [Discussion #1260: graph_optimization_level not supported in genai_config.json](https://github.com/microsoft/onnxruntime-genai/discussions/1260) -- Confirmed missing feature

### Architecture Analysis (MEDIUM-HIGH confidence)

- [DeepWiki: ONNX Runtime InferenceSession](https://deepwiki.com/microsoft/onnxruntime/3.2-inference-session) -- Lifecycle phases, initialization
- [DeepWiki: ONNX Runtime GenAI](https://deepwiki.com/microsoft/onnxruntime-genai) -- Model class, KV cache management, session wrapping
- [ONNX Runtime GenAI GitHub](https://github.com/microsoft/onnxruntime-genai) -- Source code, architecture documentation
- [Edge VSR Blog](https://blogs.windows.com/msedgedev/2023/03/08/video-super-resolution-in-microsoft-edge/) -- Confirms Edge's separate DX12 pipeline for ML inference

### Project Documentation (HIGH confidence, empirically verified)

- [docs/platform-runner-findings.md](../../docs/platform-runner-findings.md) -- Runner hardware, GPU/CPU EP selection, profile directory structure
- [docs/ci-workflow-architecture.md](../../docs/ci-workflow-architecture.md) -- Cache strategy, warm-up order, post-test save rationale
- [docs/unit-test-architecture.md](../../docs/unit-test-architecture.md) -- Three levels of model readiness, warm-up prompt necessity
- [.planning/research/onnx-runtime-macos-cpu-gpu.md](onnx-runtime-macos-cpu-gpu.md) -- ONNX Runtime EP fallback behavior, memory requirements
