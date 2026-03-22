# Technology Stack

**Project:** CI optimization for on-device browser AI testing
**Researched:** 2026-03-22
**Scope:** Edge Dev + Phi-4 Mini on `windows-11-arm` ONLY. Chrome Beta on `ubuntu-latest` needs no changes.

## Recommended Stack

### Test Filtering (for Edge Dev test split)

| Technology             | Version | Purpose                           | Why                                                             |
| ---------------------- | ------- | --------------------------------- | --------------------------------------------------------------- |
| Vitest tags            | 4.1+    | Tag unit tests as fast/inference  | Built-in feature, type-safe, CLI filtering with `--tags-filter` |
| Playwright annotations | Current | Tag e2e tests as @fast/@inference | Built-in `{ tag: '@fast' }` syntax, filter with `--grep`        |

Note: Tags are applied to all tests (both browsers share the same spec files), but the fast/inference split only impacts CI time on the Edge Dev `windows-11-arm` matrix entry. Chrome Beta warm-up is 20s, so the split has negligible value there.

### CI Infrastructure

| Technology                 | Version | Purpose                         | Why                                                     |
| -------------------------- | ------- | ------------------------------- | ------------------------------------------------------- |
| GitHub Actions             | Current | CI/CD                           | Already in use; free for public repos                   |
| actions/cache@v5           | v5      | Edge profile caching            | Already in use; rolling key pattern with run_number     |
| Background processes (`&`) | N/A     | Step-level concurrency (future) | Processes persist across steps within a job; documented |

### Diagnostics (Edge Dev `windows-11-arm` only)

| Technology                  | Version | Purpose                                               | Why                                                           |
| --------------------------- | ------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `ls -la` / file size checks | N/A     | Verify `EdgeLLMOnDeviceModel/adapter_cache.bin` sizes | Simple, no dependencies; add to `windows-11-arm` matrix entry |

## Alternatives Considered

| Category          | Recommended                            | Alternative              | Why Not                                                                                           |
| ----------------- | -------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Test filtering    | Vitest tags                            | `vitest --grep` pattern  | Tags are type-safe and composable with `&&`/`\|\|`; grep only matches test names                  |
| Test filtering    | Playwright `{ tag }`                   | `test.describe` grouping | Tags work with `--grep`, can be mixed per test                                                    |
| CI parallelism    | Test suite split (same job)            | Cross-job parallelism    | Cross-job needs two `windows-11-arm` runners, cache transfer adds overhead for ~5 GB Edge profile |
| Cache persistence | Fix artifact files + existing cache    | Artifact upload/download | Artifacts have 90-day retention but slower than cache for 5+ GB profiles                          |
| Edge warm-up      | Sequential (fast tests then inference) | Background warm-up       | ProcessSingleton prevents concurrent browser instances on same profile                            |

## Installation

No new packages needed. Vitest tags and Playwright annotations are built-in features.

```bash
# No installation required -- tags are Vitest 4.1+ built-in
# Verify Vitest version supports tags:
npm exec vitest -- --version
```

## Sources

- [Vitest Test Filtering docs](https://vitest.dev/guide/filtering)
- [Vitest 4.1 release blog](https://vitest.dev/blog/vitest-4-1.html)
- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations)
- [GitHub Actions background processes](https://www.eliostruyf.com/devhack-running-background-service-github-actions/)
