# Edge Dev CI Regression: Root Cause Analysis

**Investigated:** 2026-03-23
**Confidence:** HIGH (all findings verified from CI logs)

## Executive Summary

Edge Dev (Phi-4 Mini) unit tests on windows-11-arm regressed from passing to timing out. The root cause is **not** a version change, ONNX Runtime update, or runner image change. Everything version-wise is identical. The regression was caused by **commit `172edce`** which split the combined `test` job into separate `test-edge` and `e2e-edge` jobs, eliminating the on-disk ONNX compilation cache that the E2E step previously built for unit tests.

## Root Cause: Job Split Eliminated Shared ONNX Compilation Cache

### The Old Architecture (passing)

In the combined `test` job (runs 93-104), steps ran sequentially on the **same runner VM**:

1. Bootstrap AI model (downloads model files, creates profile)
2. **E2E tests** (30 min timeout) -- launches Edge, triggers `session.prompt('warmup')`, ONNX Runtime compiles model to ARM64 native code, writes `adapter_cache.bin` and `encoder_cache.bin` to disk
3. Kill browser processes
4. **Unit tests** -- launches fresh Edge from the SAME profile directory, ONNX Runtime finds on-disk compilation cache, compilation takes ~23 min instead of ~48 min

The E2E step acted as a **compilation pre-heater**: even though it timed out (warm-up took 30+ min), it populated the ONNX disk cache that unit tests subsequently reused.

### The New Architecture (failing)

Commit `172edce` ("warm up model in Vitest browser process, not global-setup") split the jobs:

- **`e2e-edge`** job: runs on runner VM A, compiles ONNX, writes cache to its local disk
- **`test-edge`** job: runs on runner VM B, has NO compilation cache, must compile from scratch

Both jobs run in **parallel on different VMs**. The ONNX compilation cache from e2e-edge's VM cannot help test-edge's VM. Each job must independently compile the model, taking ~48-53 minutes from scratch.

### Why Unit Tests Time Out

The total first-inference time on ARM64 without cached compilation is ~48-53 minutes:

| Run                 | Cache State                    | Warm-up Duration         | Tests                    |
| ------------------- | ------------------------------ | ------------------------ | ------------------------ |
| 93 (old, combined)  | Fresh, but E2E pre-heated disk | 23 min total             | 13/13 PASSED             |
| 104 (old, combined) | Cached with compiled artifacts | 6.1 min                  | 3/3 e2e PASSED           |
| 123 (new, split)    | Fresh, no pre-heating          | 48 min                   | 1 passed, rest timed out |
| 127 (new, split)    | Stale cache (0-byte artifacts) | 45+ min, never completed | ALL FAILED               |

The `test-edge` job has a 120-min timeout but the warm-up alone takes ~48 min. Add test execution time and the second prompt test times out.

## Evidence: Version Comparison (All Identical)

Every version number is the same across passing and failing runs:

| Component         | Passing (Run 93/104) | Failing (Run 123/127) | Changed? |
| ----------------- | -------------------- | --------------------- | -------- |
| Edge Dev          | 147.0.3912.10        | 147.0.3912.10         | NO       |
| Runner image      | 20260209.46.1        | 20260209.46.1         | NO       |
| Runner version    | 2.331.0              | 2.331.0               | NO       |
| Node.js           | 24.12.0              | 24.12.0               | NO       |
| Agent version     | 20260123.484         | 20260123.484          | NO       |
| ONNX Runtime      | N/A (not logged)     | 1.25.20260307.1       | N/A      |
| GenAI             | N/A (not logged)     | 0.13.0-dev            | N/A      |
| Runtime dir       | N/A                  | 2026.3.10.1           | N/A      |
| Model dir         | N/A                  | 2026.2.19.1           | N/A      |
| Playwright FFmpeg | v1011                | v1011                 | NO       |

**Note:** ONNX Runtime version logging was added in the failing runs (commit `8d62717`), so we cannot compare the exact ORT version in passing runs. However, Edge Dev version 147.0.3912.10 is identical, and ONNX Runtime DLLs are delivered as part of the Edge browser profile, so the same Edge version implies the same ONNX Runtime version.

## Evidence: Empty Inference Cache Files

In failing runs, the ONNX compilation cache files are 0 bytes:

```
-rw-r--r-- 1 runneradmin 197121 0 Mar 22 20:14 adapter_cache.bin
-rw-r--r-- 1 runneradmin 197121 0 Mar 22 20:18 encoder_cache.bin
```

These files are created as empty placeholders during model registration. They are populated with compiled ARM64 native code only after the first `session.prompt()` completes successfully. Since warm-up times out before completion, the files remain empty. The empty files get saved to GitHub Actions cache, and subsequent runs restore them -- perpetuating the problem.

## Evidence: availability() Status Difference

The `LanguageModel.availability()` status reveals the cache state:

| Run               | Source            | availability() | Meaning                           |
| ----------------- | ----------------- | -------------- | --------------------------------- |
| 93 (fresh)        | E2E fixture       | "downloading"  | Model files not fully registered  |
| 93 (fresh)        | Unit global-setup | "downloading"  | Still downloading/registering     |
| 104 (cached)      | E2E fixture       | "available"    | Model fully ready from cache      |
| 104 (cached)      | Unit global-setup | "available"    | Model fully ready from cache      |
| 123 (fresh)       | Unit global-setup | "available"    | Model registered but not compiled |
| 123 (fresh)       | browser-warmup    | "downloading"  | Different browser instance        |
| 127 (stale cache) | Unit global-setup | "available"    | Stale cache, registered           |
| 127 (stale cache) | browser-warmup    | "downloading"  | Fresh browser, re-downloading     |

## Timeline of Changes

| Commit        | Run     | Change                                        | Impact                                  |
| ------------- | ------- | --------------------------------------------- | --------------------------------------- |
| `cf4059b`     | 104     | Last run with old combined `test` job         | PASSING (6.1 min warm-up with cache)    |
| `73f4d7c`     | ~110    | Split Chrome/Edge into separate test jobs     | E2E still in test-edge, OK              |
| `ddf19de`     | ~122    | Remove perf-param matrix                      | Simplification only                     |
| **`172edce`** | **123** | **Split test-edge into test-edge + e2e-edge** | **REGRESSION: no more E2E pre-heating** |
| `8d8361c`     | 122     | Docs only                                     | No effect                               |
| `1fc2b1d`     | 121     | Docs only                                     | No effect                               |

## Contributing Factor: Cache Key Changes

Later commits (`36c1a58`, `4d1d3c7`) changed cache key prefixes:

- Old: `msedge-dev-ai-model-windows11-arm-v3`
- New e2e: `msedge-dev-e2e-edge-v1`
- New test: `msedge-dev-test-edge-v1`

This further broke the cache chain -- even if a successful run had populated inference cache files, the new jobs cannot find the old cache entries.

## The Vicious Cycle

1. test-edge starts with empty or no ONNX compilation cache
2. Warm-up prompt starts ONNX compilation from scratch (~48 min)
3. Warm-up times out (45 min limit in browser-warmup)
4. Tests start running, first test absorbs remaining compilation time
5. First test MAY pass (167s), but second test times out (5 min limit)
6. Job marked as failed
7. Post-test cache save skipped (condition: `steps.unit-tests.outcome == 'success'`)
8. Even if cache were saved, `adapter_cache.bin` is 0 bytes (never completed)
9. Next run restores 0-byte cache -> cycle repeats

## Recommendations

### Option A: Restore Sequential E2E-Then-Unit Architecture (Simplest)

Put E2E back into the test-edge job, running before unit tests on the same VM. This restores the compilation pre-heating that made the old architecture work. The E2E step warm-up populates the on-disk ONNX compilation cache, and unit tests reuse it.

Tradeoff: increases total job time because E2E and unit tests run sequentially.

### Option B: Make test-edge Depend on e2e-edge (Cache Handoff)

Make `test-edge` depend on `e2e-edge` via `needs: e2e-edge`. Have `e2e-edge` save the populated compilation cache (only on success), and `test-edge` restore it. This preserves parallel architecture for Chrome while giving Edge the serial dependency it needs.

Tradeoff: test-edge waits for e2e-edge to complete before starting. The total wall-clock time for Edge tests increases.

### Option C: Extend Warm-up Timeout to Cover Full Compilation

Increase the browser-warmup timeout from 45 min to 60 min. The first test would then encounter a fully compiled model and complete in seconds instead of minutes.

Tradeoff: does not solve the vicious cycle of empty cache files. Every cold run still takes 48+ min.

### Option D: Pre-warm in Bootstrap Step

Modify the bootstrap script to run a prompt after model registration and wait for it to complete (with a long timeout). This would ensure the ONNX compilation cache is populated before any test step runs.

Tradeoff: the bootstrap step would take 48+ min on cold start, but subsequent runs with cache would be fast.

### Recommended: Combination of A + D

1. Restore E2E step in test-edge (Option A) for the disk cache benefit
2. After successful E2E, save the profile cache WITH populated inference artifacts
3. On cache hit, both E2E and unit tests benefit from compiled ONNX
4. On cache miss, E2E pre-heats the compilation for unit tests

## Detailed Log References

| Run         | Job ID      | Type            | Key Observations                                       |
| ----------- | ----------- | --------------- | ------------------------------------------------------ |
| 23402799639 | 68076679972 | PASS unit (old) | 13/13 pass, E2E pre-heated compilation, 23 min warm-up |
| 23408368667 | 68091167133 | PASS e2e (old)  | 3/3 e2e pass, 6.1 min warm-up from warm cache          |
| 23411549538 | 68099528610 | FAIL unit (new) | 1 test pass at 167s, 48 min total warm-up              |
| 23413075220 | 68103615700 | FAIL unit (new) | All tests fail, 45+ min warm-up never completed        |
| 23413075220 | 68103615711 | FAIL e2e (new)  | 55+ min warm-up, page closed                           |

## Sources

- CI logs downloaded via `gh api repos/LayZeeDK/in-browser-ai-coding-agent/actions/jobs/{id}/logs`
- Commit history: `git log cf4059b..HEAD -- .github/workflows/ci.yml`
- Key commit: `172edce` (git show)
