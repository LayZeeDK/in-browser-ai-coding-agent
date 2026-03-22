# Domain Pitfalls

**Domain:** CI/CD optimization for on-device browser AI testing
**Researched:** 2026-03-22

## Critical Pitfalls

Mistakes that cause wasted CI time, broken caching, or false test results.

### Pitfall 1: Assuming Cache Artifacts Eliminate Cold-Start

**What goes wrong:** The project saves the browser profile post-test with the expectation that `adapter_cache.bin` and `encoder_cache.bin` contain pre-compiled ONNX Runtime session data. But these files are always 0 bytes. Every CI run pays the full 23+ minute cold-start even with a cache hit.

**Why it happens:** ONNX Runtime's EP Context Cache mechanism (documented at [EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html)) is primarily implemented by GPU/NPU execution providers (TensorRT, OpenVINO, QNN). The CPU EP may not support session serialization. Alternatively, the browser process may be force-killed before ONNX Runtime flushes cache files to disk.

**Consequences:** The entire caching strategy is reduced to avoiding model re-download (~5 min saved) instead of avoiding model recompilation (~23 min saved). The team may believe caching is working when it is not.

**Prevention:** Add diagnostic logging to CI that checks file sizes of `adapter_cache.bin` and `encoder_cache.bin` at each stage (after bootstrap, after e2e, after unit tests, before cache save). If consistently 0 bytes, investigate whether CPU EP generates them at all. Compare with local machine behavior.

**Detection:** File sizes logged as 0 bytes in CI diagnostics. Cold-start time does not decrease between first and subsequent runs despite cache hits.

### Pitfall 2: Force-Killing Browser Before Cache Files Are Flushed

**What goes wrong:** The CI workflow uses `taskkill //F` to kill Edge Dev, Chrome, and chrome_crashpad_handler between e2e and unit test steps. Force-kill terminates processes without cleanup, potentially truncating in-flight file writes to 0 bytes.

**Why it happens:** The kill step was added to resolve ProcessSingleton lockfile contention. Chrome's `chrome_crashpad_handler` holds the profile lockfile after browser close, preventing the next browser launch.

**Consequences:** If ONNX Runtime writes cache files asynchronously (lazy flush on session destroy or process exit), force-kill truncates them. The profile saved to GitHub Actions cache contains 0-byte artifacts. The next run's warm-start fails to find valid cache data.

**Prevention:** Replace `taskkill //F` with a gentler approach: (1) let Playwright close the context gracefully, (2) wait 5-10 seconds for child process cleanup, (3) only force-kill `chrome_crashpad_handler.exe` if needed (it does not write cache files, only holds the lockfile).

**Detection:** Compare file sizes of `adapter_cache.bin` before and after the kill step. If they drop to 0 bytes, the kill step is the cause.

### Pitfall 3: Investing in Docker/Container Solutions for Windows ARM64

**What goes wrong:** Significant time is spent trying to containerize Edge Dev or run Windows containers on GitHub Actions, only to discover it is blocked by multiple hard constraints.

**Why it happens:** Docker containers work well for Chrome Beta on Linux, leading to the assumption that the same approach can work for Edge Dev on Windows.

**Consequences:** Days of investigation with no viable path forward. Four independent blockers: GitHub Actions does not support Windows containers, Docker on Windows ARM64 has fundamental issues, Edge Dev has no Linux ARM64 build, and Edge's model delivery requires a Desktop SKU.

**Prevention:** Before pursuing containerization, verify: (1) Does the CI platform support containers on the target OS? (2) Does the browser have a build for the container's OS/arch? (3) Does the model delivery system work in a container?

**Detection:** Early blockers: `Container operations are only supported on Linux runners` error in GitHub Actions.

## Moderate Pitfalls

### Pitfall 4: Gating Fast Tests Behind Model Warm-Up

**What goes wrong:** All tests (including availability checks, component rendering, API detection) wait 23+ minutes for model warm-up before running, even though they do not need inference.

**Prevention:** Tag tests by warm-up requirement. Run fast tests in a separate CI step before warm-up. Use Vitest `--tags-filter="fast"` and Playwright `--grep @fast`.

### Pitfall 5: Assuming Parallel Warm-Up Is Straightforward

**What goes wrong:** Attempting to start model warm-up as a background process while running fast tests concurrently, only to discover that both try to launch Edge Dev against the same profile directory, triggering ProcessSingleton conflicts.

**Prevention:** Only one browser process can use a profile directory at a time. If warm-up needs a browser, it must run in isolation. Either run warm-up and fast tests in separate jobs (with cache transfer overhead), or accept sequential execution.

### Pitfall 6: Expecting Cache Hits to Be Fast

**What goes wrong:** A cache hit restores the 5+ GB profile from GitHub Actions cache, which itself takes 2-5 minutes. Teams expect cache restore to be near-instant.

**Prevention:** Accept that cache restore for multi-GB profiles takes minutes. Factor this into timeout calculations. The value is avoiding the ~10 min model download from Microsoft's servers (which may be slower or unreliable), not eliminating setup time entirely.

### Pitfall 7: Pursuing macOS Support

**What goes wrong:** ONNX Runtime's CoreML execution provider on macOS passes capability checks (it can handle the model's operators) but crashes during GPU memory allocation. The error is `InvalidStateError: The device is unable to create a session`. There is no CPU fallback.

**Prevention:** Do not attempt macOS CI runners for Phi-4 Mini. There is no environment variable, flag, or configuration that forces CPU-only ONNX Runtime inference in Edge's embedded runtime. The only path to macOS support would be Microsoft implementing CPU fallback in CoreML EP, which is outside this project's control.

## Minor Pitfalls

### Pitfall 8: Vitest Tags and Browser Instance Filtering Interaction

**What goes wrong:** The `CI_VITEST_BROWSER_INSTANCE` environment variable filters to a single browser instance in CI. If Vitest tags are added, the interaction between tag filtering and instance filtering may be unexpected (e.g., `--tags-filter="fast"` might not compose correctly with instance filtering).

**Prevention:** Test the composition of `--tags-filter` with `CI_VITEST_BROWSER_INSTANCE` locally before deploying to CI. The Vitest config applies instance filtering at the config level, and tag filtering at the test level -- they should compose correctly, but verify.

### Pitfall 9: Cache Key Pollution from Diagnostic Steps

**What goes wrong:** Adding diagnostic steps (file size checks, logging) that modify files in the profile directory. The cache save step then captures modified timestamps, causing unnecessary cache churn.

**Prevention:** Diagnostic steps should be read-only (`ls -la`, `stat`, `cat`). Never write to the profile directory in diagnostic steps.

### Pitfall 10: Assuming Warm-Start Is Instantaneous

**What goes wrong:** Even with valid cached artifacts, the Vitest global setup warm-up (launching browser, navigating to internals page, running session.prompt('warmup')) takes 30-90 seconds. Tests are written with tight timeouts expecting instant model availability.

**Prevention:** Even with warm-start, keep per-test inference timeouts at 60+ seconds. The global setup warm-up should remain at 600s (10 min) as a safety net.

## Phase-Specific Warnings

| Phase Topic          | Likely Pitfall                              | Mitigation                                                                          |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Cache investigation  | CPU EP may not generate cache files at all  | Check ONNX Runtime docs for CPU EP context support; compare local vs CI behavior    |
| Test tagging         | Missing tags on new tests                   | Add CI check that untagged tests fail with a clear error                            |
| Workflow restructure | Breaking the e2e-before-unit ordering       | Keep inference e2e before inference unit tests; only move fast tests before warm-up |
| Browser lifecycle    | ProcessSingleton from stale warm-up process | Keep the 5-attempt retry loop; do not remove it even when removing the kill step    |

## Sources

- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html) - Session serialization mechanism
- [actions/runner#1402](https://github.com/actions/runner/issues/1402) - Windows container support status
- [docker/for-win#14368](https://github.com/docker/for-win/issues/14368) - Docker on Windows ARM64 issues
- Project's existing `phi4-mini-arm64-cold-start.md` and `onnx-runtime-arm64-cold-start.md` research
- Project's `docs/platform-runner-findings.md` - macOS incompatibility evidence
