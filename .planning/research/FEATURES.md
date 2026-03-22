# Feature Landscape

**Domain:** CI/CD optimization for on-device browser AI testing
**Researched:** 2026-03-22
**Scope:** Edge Dev + Phi-4 Mini on `windows-11-arm` ONLY. Chrome Beta on `ubuntu-latest` has no performance problem (~20s warm-up).

## Table Stakes

Features that the CI pipeline must have. Missing = tests are unreliable or too slow.

| Feature                                   | Why Expected                                                  | Complexity                | Notes                                                 |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| Edge model profile caching                | Avoids ~4.86 GB Phi-4 Mini re-download on every run           | Low (already implemented) | Rolling cache with run_number key on `windows-11-arm` |
| Edge model warm-up before inference tests | Front-loads 23+ min cold-start before test timeouts start     | Low (already implemented) | E2E fixture runs `session.prompt('warmup')`           |
| ProcessSingleton retry loop               | Chrome lockfile contention on Windows (Edge is less affected) | Low (already implemented) | 5 attempts, 2s delay                                  |
| Separate browser targets                  | Chrome/Edge need different configs, runners, OS               | Low (already implemented) | Per-browser Nx targets (`test-chrome`, `test-edge`)   |

## Differentiators

Features that significantly improve the Edge Dev CI experience. Not expected, but valued.

| Feature                               | Value Proposition                                                    | Complexity | Notes                                                                             |
| ------------------------------------- | -------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Fast/inference test split (Edge only) | ~1 min feedback for non-inference tests instead of waiting 23+ min   | Medium     | Vitest tags + Playwright annotations. Chrome Beta does not benefit (20s warm-up). |
| Edge cache artifact diagnostics       | Detect when `EdgeLLMOnDeviceModel/adapter_cache.bin` is 0 bytes      | Low        | Add file size check to CI workflow on `windows-11-arm` only                       |
| Graceful Edge Dev shutdown            | Allow ONNX Runtime to flush `adapter_cache.bin` before exit          | Low        | Replace `taskkill //F` with `context.close()` + sleep on Edge matrix entry        |
| Fast test CI step (Edge only)         | Separate CI step for fast tests before 23+ min warm-up               | Medium     | Workflow restructure; only applies to `windows-11-arm` matrix entry               |
| Warm-start measurement                | Track and report whether Edge warm-start vs cold-start time improved | Low        | Add timestamp logging to Edge global setup                                        |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature                            | Why Avoid                                                                                                             | What to Do Instead                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Docker container for Edge Dev           | Blocked by 4 hard constraints: no Windows containers in GHA, Docker ARM64 issues, no Linux Edge, Desktop SKU required | Keep bare `windows-11-arm` runner                              |
| Standalone ONNX inference server        | Changes what tests validate; Phi-4 Mini files are Edge-proprietary                                                    | Test through browser LanguageModel API as intended             |
| Parallel warm-up within same job (Edge) | ProcessSingleton prevents concurrent browser instances on same profile                                                | Use test splitting for fast feedback                           |
| macOS runner support for Edge           | ONNX Runtime CoreML crashes on insufficient GPU VRAM with no CPU fallback                                             | Accept `windows-11-arm` as only Edge Dev runner                |
| Mock inference for fast tests           | Defeats the purpose of testing real on-device AI                                                                      | Tag tests; run real inference tests with extended timeouts     |
| Fast/inference split for Chrome Beta    | Negligible value -- Chrome warm-up is 20s, not 23 min                                                                 | Keep Chrome tests as-is; apply split to Edge matrix entry only |

## Feature Dependencies

```
Edge cache artifact investigation --> Graceful Edge shutdown (only if files can be populated)
Edge cache artifact investigation --> Warm-start measurement (can only measure if artifacts exist)
Test tagging --> Fast test CI step (tags must exist before workflow uses them)
Fast test CI step --> Edge workflow restructure (ordering change in windows-11-arm entry)
```

## MVP Recommendation

Prioritize:

1. **Edge cache artifact diagnostics** -- add file size checks to `windows-11-arm` CI to understand whether `adapter_cache.bin` is populated at any point (Low effort, high information value)
2. **Test tagging** -- tag all tests as fast/inference (Medium effort, immediate fast feedback on Edge Dev matrix entry)
3. **Fast test CI step** -- run fast tests before warm-up on `windows-11-arm` (Medium effort, depends on #2)

Defer: **Graceful Edge Dev shutdown** -- investigate after understanding adapter_cache.bin behavior. May be unnecessary if ONNX Runtime CPU EP does not generate cache files.

## Sources

- [Vitest Test Filtering](https://vitest.dev/guide/filtering)
- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations)
- [ONNX Runtime EP Context Design](https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html)
