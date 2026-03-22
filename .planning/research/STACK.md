# Technology Stack

**Project:** CI optimization for on-device browser AI testing
**Researched:** 2026-03-22

## Recommended Stack

### Test Filtering

| Technology             | Version | Purpose                           | Why                                                             |
| ---------------------- | ------- | --------------------------------- | --------------------------------------------------------------- |
| Vitest tags            | 4.1+    | Tag unit tests as fast/inference  | Built-in feature, type-safe, CLI filtering with `--tags-filter` |
| Playwright annotations | Current | Tag e2e tests as @fast/@inference | Built-in `{ tag: '@fast' }` syntax, filter with `--grep`        |

### CI Infrastructure

| Technology                 | Version | Purpose                | Why                                                          |
| -------------------------- | ------- | ---------------------- | ------------------------------------------------------------ |
| GitHub Actions             | Current | CI/CD                  | Already in use; free for public repos                        |
| actions/cache@v5           | v5      | Profile caching        | Already in use; rolling key pattern with run_number          |
| Background processes (`&`) | N/A     | Step-level concurrency | Processes persist across steps within a job; well-documented |

### Diagnostics

| Technology                  | Version | Purpose                     | Why                                                         |
| --------------------------- | ------- | --------------------------- | ----------------------------------------------------------- |
| `ls -la` / file size checks | N/A     | Verify cache artifact sizes | Simple, no dependencies; add to CI workflow for diagnostics |

## Alternatives Considered

| Category          | Recommended                         | Alternative              | Why Not                                                                  |
| ----------------- | ----------------------------------- | ------------------------ | ------------------------------------------------------------------------ | --- | ------------------------------- |
| Test filtering    | Vitest tags                         | `vitest --grep` pattern  | Tags are type-safe and composable with `&&`/`                            |     | `; grep only matches test names |
| Test filtering    | Playwright `{ tag }`                | `test.describe` grouping | Tags work with `--grep`, can be mixed per test                           |
| CI parallelism    | Test suite split (same job)         | Cross-job parallelism    | Cross-job needs two ARM64 runners, cache transfer adds overhead          |
| Cache persistence | Fix artifact files + existing cache | Artifact upload/download | Artifacts have 90-day retention but slower than cache for 5+ GB profiles |

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
