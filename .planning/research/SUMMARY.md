# Research Summary: CI Patterns for Slow AI Model Inference

**Domain:** CI/CD optimization for on-device browser AI testing
**Researched:** 2026-03-22
**Overall confidence:** MEDIUM-HIGH
**Scope:** Edge Dev + Phi-4 Mini on `windows-11-arm` ONLY. Chrome Beta + Gemini Nano on `ubuntu-latest` is a solved problem (~20s warm-up) and is not part of this research.

## Executive Summary

This project tests an Angular app that runs AI models entirely in the browser via the W3C LanguageModel API. The CI pipeline has two matrix entries: Chrome Beta with Gemini Nano on `ubuntu-latest` (containerized, ~20s warm-up, works well) and Edge Dev with Phi-4 Mini on `windows-11-arm` (23+ min cold-start, dominates CI wall-clock time). This research focuses exclusively on the Edge Dev / `windows-11-arm` problem. Chrome Beta is not discussed further because its pipeline is already fast and reliable.

The Edge Dev cold-start is caused by ONNX Runtime compiling a 4.86 GB model graph on a 4-vCPU Azure Cobalt 100 ARM64 processor with no GPU. This leaves only ~20 minutes for actual tests within the 45-minute step timeout.

Research investigated eight specific approaches: Docker containers for Edge Dev (blocked by multiple hard constraints), better GitHub-hosted hardware (not available on free tier), test suite splitting (most impactful), background warm-up (blocked by ProcessSingleton), service containers (not applicable to browser-internal APIs), published patterns (none exist), larger runners (paid only), and browser process persistence (partially viable).

The critical finding is that the `adapter_cache.bin` and `encoder_cache.bin` files in the Edge profile -- ONNX Runtime pre-compiled session data intended to eliminate cold-start -- are always 0 bytes in the CI cache. This means the caching strategy that should eliminate the 23+ min cold-start is not working. Fixing this is the single highest-impact improvement.

The second most impactful change is splitting the Edge Dev test suite into "fast" tests (no inference) and "inference" tests using Vitest tags and Playwright annotations. Fast tests can run in ~1 minute without any model warm-up, providing rapid feedback for the most common failure modes. This split has negligible value for Chrome Beta (where warm-up is only 20s) and should be applied selectively to the Edge Dev matrix entry.

## Key Findings

**Stack:** Vitest 4.1+ tags and Playwright annotations for test filtering; GitHub Actions background process persistence for step-level warm-up
**Architecture:** Split Edge Dev tests into fast/inference categories; investigate and fix adapter_cache.bin persistence in Edge profile; remove aggressive browser kill step on `windows-11-arm`
**Critical pitfall:** The entire Edge profile caching strategy may be ineffective if ONNX Runtime's CPU EP does not generate session cache files -- the cold-start would be unavoidable without hardware changes

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Investigate adapter_cache.bin in Edge profile** - Determine why ONNX Runtime cache files are 0 bytes on `windows-11-arm`. Compare with local developer machine (Snapdragon X Elite with NPU/GPU). If CPU EP does not generate them, accept the cold-start as unavoidable on this runner.
   - Addresses: The root cause of persistent cold-start even with cache hits
   - Avoids: Investing in optimizations that are moot if the cache mechanism is broken

2. **Split Edge Dev test suite** - Tag tests as fast/inference, update CI workflow to run fast tests first on the `windows-11-arm` matrix entry. Chrome Beta matrix entry can remain as-is (no benefit from splitting given 20s warm-up).
   - Addresses: Fast feedback for non-inference tests (~1 min vs ~25 min)
   - Avoids: Architectural complexity of parallel warm-up or service containers

3. **Optimize Edge Dev browser lifecycle** - Remove aggressive kill step on `windows-11-arm`, adjust cache save timing to allow ONNX Runtime file flush
   - Addresses: Possible cache file truncation from premature browser termination
   - Avoids: ProcessSingleton conflicts from stale lockfiles

**Phase ordering rationale:**

- Phase 1 must come first because its findings determine whether Phase 3 has any impact. If CPU EP cannot generate cache files, Phase 3 is moot.
- Phase 2 is independent and provides value regardless of Phase 1 outcome.
- Phase 3 depends on Phase 1 findings.

**Research flags for phases:**

- Phase 1: Needs deeper investigation (requires CI experimentation with file size checks at various points in the Edge Dev matrix entry)
- Phase 2: Standard patterns, well-documented in Vitest/Playwright docs
- Phase 3: Standard patterns but may be moot depending on Phase 1

## Confidence Assessment

| Area                         | Confidence | Notes                                                                                      |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Docker/container viability   | HIGH       | Multiple hard blockers confirmed via GitHub issues and docs                                |
| Test splitting approach      | HIGH       | Vitest tags and Playwright annotations are well-documented GA features                     |
| Background warm-up           | MEDIUM     | ProcessSingleton blocks same-profile concurrent access; cross-job parallelism has overhead |
| adapter_cache.bin root cause | LOW        | Multiple hypotheses; requires empirical investigation on `windows-11-arm`                  |
| Larger runner impact         | MEDIUM     | Cold-start reduction is extrapolated from benchmark data, not measured                     |
| Published patterns           | MEDIUM     | Extensive search found nothing; absence of evidence is not evidence of absence             |

## Gaps to Address

- **Why are adapter_cache.bin and encoder_cache.bin always 0 bytes in the Edge profile on `windows-11-arm`?** -- This is the critical open question. Requires CI experimentation. Compare with the Chrome profile's `OptGuideOnDeviceModel/adapter_cache.bin` and with the local developer machine's Edge profile.
- **Does ONNX Runtime CPU EP on ARM64 support session serialization at all?** -- The public ONNX Runtime docs only document EP context caching for GPU/NPU EPs. The local developer machine has a Qualcomm Hexagon NPU which Edge might use for inference, potentially generating cache files that the CPU-only CI runner cannot.
- **What is the actual warm-start time when cache artifacts are present?** -- Never measured because artifacts have never been non-zero in CI on `windows-11-arm`.
- **Would Vitest tags compose correctly with CI_VITEST_BROWSER_INSTANCE filtering?** -- Needs validation for the `edge-phi4-mini` instance.
