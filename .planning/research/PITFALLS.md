# Domain Pitfalls

**Domain:** CI/CD optimization for on-device browser AI testing
**Researched:** 2026-03-22
**Scope:** Edge Dev + Phi-4 Mini on `windows-11-arm` ONLY. Chrome Beta on `ubuntu-latest` is a solved problem (~20s warm-up) and has none of these pitfalls.

## Critical Pitfalls

Mistakes that cause wasted CI time, broken caching, or false test results on the Edge Dev matrix entry.

### Pitfall 1: Assuming Edge Cache Artifacts Eliminate Cold-Start

**What goes wrong:** The project saves the Edge Dev browser profile post-test with the expectation that `EdgeLLMOnDeviceModel/adapter_cache.bin` and `encoder_cache.bin` contain pre-compiled ONNX Runtime session data. But these files are always 0 bytes on the `windows-11-arm` runner. Every CI run pays the full 23+ minute cold-start even with a cache hit.

**Why it happens:** ONNX Runtime's EP Context Cache mechanism (documented at [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html)) is primarily implemented by GPU/NPU execution providers (TensorRT, OpenVINO, QNN). The CPU EP on the Azure Cobalt 100 (no GPU, no NPU) may not support session serialization. Alternatively, Edge Dev may be force-killed before ONNX Runtime flushes cache files to disk. A third possibility: the developer's local machine (Snapdragon X Elite) has an NPU that Edge might use for inference, generating cache files that the CPU-only CI runner cannot produce.

**Consequences:** The Edge profile caching strategy is reduced to avoiding the ~4.86 GB model re-download (~5 min saved) instead of avoiding model recompilation (~23 min saved). The team may believe caching is eliminating cold-start when it is not.

**Prevention:** Add diagnostic logging to the `windows-11-arm` matrix entry that checks file sizes of `EdgeLLMOnDeviceModel/adapter_cache.bin` and `encoder_cache.bin` at each stage (after bootstrap, after e2e, after unit tests, before cache save). Compare with file sizes on the developer's local machine. If 0 bytes locally too, CPU EP does not generate them.

**Detection:** File sizes logged as 0 bytes in CI diagnostics. Cold-start time does not decrease between first and subsequent CI runs despite cache hits.

### Pitfall 2: Force-Killing Edge Dev Before Cache Files Are Flushed

**What goes wrong:** The CI workflow uses `taskkill //F` to kill `msedge.exe` and `chrome_crashpad_handler.exe` between e2e and unit test steps on `windows-11-arm`. Force-kill terminates processes without cleanup, potentially truncating in-flight file writes to 0 bytes.

**Why it happens:** The kill step was added to resolve ProcessSingleton lockfile contention, primarily a Chrome problem. Edge Dev does not typically exhibit ProcessSingleton issues (documented in `e2e-test-architecture.md`: "Edge Dev does not exhibit this behavior"). The kill step may be unnecessarily aggressive for the Edge matrix entry.

**Consequences:** If ONNX Runtime writes cache files asynchronously (lazy flush on session destroy or process exit), force-kill truncates them. The Edge profile saved to GitHub Actions cache contains 0-byte `adapter_cache.bin`. The next run's warm-start fails to find valid cache data.

**Prevention:** On the `windows-11-arm` matrix entry, replace `taskkill //F` with a gentler approach: (1) let Playwright close the context gracefully via fixture teardown, (2) wait 5-10 seconds for ONNX Runtime file flush, (3) do not kill `msedge.exe` at all -- Edge does not have the ProcessSingleton lockfile problem that Chrome does. Only kill `chrome_crashpad_handler.exe` if it exists (it should not on Edge).

**Detection:** Compare file sizes of `EdgeLLMOnDeviceModel/adapter_cache.bin` before and after the kill step. If they drop to 0 bytes after the kill, the kill step is the cause.

### Pitfall 3: Investing in Docker/Container Solutions for Edge Dev

**What goes wrong:** Significant time is spent trying to containerize Edge Dev or run Windows containers on GitHub Actions, only to discover it is blocked by multiple hard constraints.

**Why it happens:** Docker containers work well for Chrome Beta on `ubuntu-latest`, leading to the assumption that the same approach can work for Edge Dev on `windows-11-arm`. The two matrix entries have fundamentally different architecture constraints.

**Consequences:** Days of investigation with no viable path forward. Four independent blockers: GitHub Actions does not support Windows containers, Docker on Windows ARM64 has fundamental issues, Edge Dev has no Linux ARM64 build, and Edge's model delivery requires a Desktop SKU.

**Prevention:** Before pursuing containerization for Edge Dev, recognize the hard constraints: (1) GitHub Actions `container:` directive only works on Linux runners, (2) Edge Dev is a Windows-only browser, (3) Edge's Phi-4 Mini model delivery system is Windows-specific. None of these can be worked around.

**Detection:** Early blocker: `Container operations are only supported on Linux runners` error.

## Moderate Pitfalls

### Pitfall 4: Gating All Edge Dev Tests Behind Model Warm-Up

**What goes wrong:** All Edge Dev tests (including availability checks, component rendering, API detection) wait 23+ minutes for Phi-4 Mini warm-up before running, even though they do not need inference.

**Prevention:** Tag tests by warm-up requirement. Run fast tests in a separate CI step before warm-up on the `windows-11-arm` matrix entry. Use Vitest `--tags-filter="fast"` and Playwright `--grep @fast`. Note: this split has negligible value for Chrome Beta where warm-up is 20s.

### Pitfall 5: Assuming Parallel Warm-Up Is Straightforward on windows-11-arm

**What goes wrong:** Attempting to start Phi-4 Mini warm-up as a background process while running fast tests concurrently on `windows-11-arm`, only to discover that both try to launch Edge Dev against the same profile directory. While Edge Dev has fewer ProcessSingleton issues than Chrome, only one browser process can use a persistent profile at a time.

**Prevention:** Only one browser process can use a profile directory at a time (Chromium design, applies to both Chrome and Edge). If warm-up needs a browser, it must run in isolation. Accept sequential execution: fast tests first (without browser model warm-up), then inference tests with warm-up.

### Pitfall 6: Expecting Edge Profile Cache Restore to Be Fast

**What goes wrong:** A cache hit restores the ~5 GB Edge profile from GitHub Actions cache, which itself takes 2-5 minutes. Teams expect cache restore to be near-instant.

**Prevention:** Accept that cache restore for the ~5 GB Edge profile takes minutes. Factor this into timeout calculations. The value is avoiding the ~10 min model download from Microsoft's servers, not eliminating setup time entirely. Chrome's profile is smaller (~1.5 GB for Gemini Nano) and restores faster.

### Pitfall 7: Pursuing macOS Support for Edge Dev

**What goes wrong:** ONNX Runtime's CoreML execution provider on macOS passes capability checks but crashes during GPU memory allocation. The error is `InvalidStateError: The device is unable to create a session`. There is no CPU fallback.

**Prevention:** Do not attempt macOS CI runners for Edge Dev / Phi-4 Mini. `windows-11-arm` is the only viable runner. This is a hard platform restriction in ONNX Runtime's CoreML EP, outside this project's control.

### Pitfall 8: Applying Chrome Beta Optimizations to Edge Dev

**What goes wrong:** Assuming patterns that work for Chrome Beta / `ubuntu-latest` will transfer to Edge Dev / `windows-11-arm`. The two matrix entries use completely different inference stacks (LiteRT vs ONNX Runtime), different model delivery systems, different OS, different CPU architecture, and have different ProcessSingleton behavior.

**Prevention:** Treat each matrix entry as independent. Validate optimizations on the specific runner. Examples of non-transferable patterns: Docker containerization (works for Chrome, impossible for Edge), `--disable-gpu` effect (indirect on Chrome via `gpu_blocklist.cc`, no effect on Edge's separate ONNX Runtime pipeline), ProcessSingleton mitigations (Chrome has the problem, Edge mostly does not).

## Minor Pitfalls

### Pitfall 9: Vitest Tags and Browser Instance Filtering Interaction

**What goes wrong:** The `CI_VITEST_BROWSER_INSTANCE` environment variable filters to a single browser instance in CI (e.g., `edge-phi4-mini` on `windows-11-arm`). If Vitest tags are added, the interaction between tag filtering (`--tags-filter="fast"`) and instance filtering may be unexpected.

**Prevention:** Test the composition of `--tags-filter` with `CI_VITEST_BROWSER_INSTANCE=edge-phi4-mini` locally before deploying to CI. The Vitest config applies instance filtering at the config level, and tag filtering at the test level -- they should compose correctly, but verify.

### Pitfall 10: Cache Key Pollution from Diagnostic Steps

**What goes wrong:** Adding diagnostic steps (file size checks, logging) that accidentally modify files in the Edge profile directory. The cache save step then captures modified timestamps, causing unnecessary cache churn.

**Prevention:** Diagnostic steps should be read-only (`ls -la`, `stat`). Never write to the `.playwright-profiles/msedge-dev/` directory in diagnostic steps.

### Pitfall 11: Assuming Warm-Start Is Instantaneous on Edge Dev

**What goes wrong:** Even with valid cached artifacts, the Vitest global setup warm-up on Edge Dev (launching browser, navigating to `edge://on-device-internals`, running `session.prompt('warmup')`) takes at minimum 30-90 seconds. Tests are written with tight timeouts expecting instant model availability.

**Prevention:** Even with warm-start, keep per-test inference timeouts at 60+ seconds for Edge Dev. The global setup warm-up should remain at 600s (10 min) as a safety net. Chrome tests can use shorter timeouts since Gemini Nano warm-up is ~20s.

## Phase-Specific Warnings

| Phase Topic               | Likely Pitfall                                                                                      | Mitigation                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Edge cache investigation  | CPU EP on Cobalt 100 may not generate cache files; local machine NPU may explain different behavior | Compare local Edge profile (Snapdragon X Elite + NPU) with CI Edge profile (Cobalt 100, no GPU/NPU)        |
| Test tagging              | Missing tags on new tests breaks the split                                                          | Add CI check that untagged tests fail with a clear error                                                   |
| Edge workflow restructure | Breaking the e2e-before-unit ordering for inference tests                                           | Keep inference e2e before inference unit tests; only move fast tests before warm-up                        |
| Edge browser lifecycle    | Over-zealous kill step truncates ONNX cache files                                                   | Edge does not need the kill step (no ProcessSingleton issue); remove it entirely for the Edge matrix entry |

## Sources

- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) - Session serialization mechanism
- [actions/runner#1402](https://github.com/actions/runner/issues/1402) - Windows container support status
- [docker/for-win#14368](https://github.com/docker/for-win/issues/14368) - Docker on Windows ARM64 issues
- Project's `docs/e2e-test-architecture.md` - "Edge Dev does not exhibit this [ProcessSingleton] behavior"
- Project's `docs/platform-runner-findings.md` - macOS incompatibility evidence, Edge-specific ONNX Runtime architecture
- Project's `.planning/research/phi4-mini-arm64-cold-start.md` and `onnx-runtime-arm64-cold-start.md`
