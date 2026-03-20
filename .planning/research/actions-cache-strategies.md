# GitHub Actions Caching Strategies for Large Browser Artifacts (2-5GB)

**Researched:** 2026-03-20
**Domain:** CI/CD caching for on-device AI model testing with browser automation
**Overall confidence:** HIGH (primary sources: GitHub official docs, GitHub Changelog, Playwright docs)

---

## 1. actions/cache Size Limits and Behavior

### Repository-Level Limits

| Plan                    | Default Cache Storage | Expandable?                           |
| ----------------------- | --------------------- | ------------------------------------- |
| GitHub Free             | 10 GB                 | No                                    |
| GitHub Pro / Team       | 10 GB                 | Yes (pay-as-you-go)                   |
| GitHub Enterprise Cloud | 10 GB                 | Yes (up to 10 TB per user-owned repo) |

As of [November 2025](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/), repositories on paid plans can exceed the 10 GB cap using pay-as-you-go billing. Enterprise and organization admins can configure the maximum limit.

### Per-Entry Size Limit

GitHub's official documentation does **not** explicitly state a per-entry size limit separate from the repository total. In practice, a single cache entry can consume the entire repository cache allocation (10 GB by default). The cache is downloaded in segments: 1 GB segments on 32-bit runners, 2 GB segments on 64-bit runners. This means a 5 GB cache entry is technically feasible on a free plan but would consume half the repo's total allocation.

**Confidence:** HIGH -- verified against [GitHub Actions limits docs](https://docs.github.com/en/actions/reference/limits) and [dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

### Eviction Policy

- Caches not accessed within **7 days** are automatically deleted.
- When total cache storage exceeds the limit, oldest-accessed caches are evicted first.
- There is no limit on the _number_ of cache entries, only total size.

### Rate Limits (January 2026)

Per the [January 2026 changelog](https://github.blog/changelog/2026-01-16-rate-limiting-for-actions-cache-entries/):

- **200 uploads/minute** per repository
- **1,500 downloads/minute** per repository
- Exceeding these rates causes subsequent operations to fail until the rate resets.

### Implications for 2-5 GB Browser Artifacts

A single 2-5 GB cache entry is possible but problematic on the free plan:

- A 5 GB entry leaves only 5 GB for all other caches (dependencies, build outputs, etc.).
- Cache restore time for 5 GB at ~125 MB/s (GitHub-hosted runner bandwidth) is approximately **40 seconds**, which is acceptable.
- Cache save time is comparable.

**Recommendation:** For a single project with only browser artifact caching needs, the default 10 GB limit is workable for entries up to ~3 GB. Beyond that, consider the pay-as-you-go expansion or external storage.

---

## 2. Caching Playwright Browsers

### Official Playwright Position

Playwright's [CI documentation](https://playwright.dev/docs/ci) **does not recommend caching browser binaries**, stating:

> "Caching browser binaries is not recommended, since the amount of time it takes to restore the cache is comparable to the time it takes to download the binaries."

Additionally, Linux OS-level dependencies (shared libraries) are not cacheable and must be installed regardless.

**Confidence:** HIGH -- verified against official Playwright docs.

### When Caching Still Makes Sense

Despite the official guidance, caching is beneficial when:

1. **Network constraints** -- CI runners with limited bandwidth or behind restrictive proxies.
2. **Reliability** -- Avoiding flaky external downloads during CI runs.
3. **Custom browser configurations** -- When you need browsers with specific flags, extensions, or profiles pre-configured.
4. **AI model pre-loading** -- When the browser profile includes downloaded ONNX/WASM model files that take significant time to fetch.

### Recommended Cache Key Strategy

```yaml
# Extract exact Playwright version for cache key
- name: Get Playwright version
  run: |
    PLAYWRIGHT_VERSION=$(node -e "console.log(require('./package-lock.json').packages['node_modules/@playwright/test'].version)")
    echo "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" >> $GITHUB_ENV

- name: Cache Playwright browsers
  uses: actions/cache@v4
  id: playwright-cache
  with:
    path: ~/.cache/ms-playwright
    key: ${{ runner.os }}-playwright-${{ env.PLAYWRIGHT_VERSION }}
```

### Conditional Installation Pattern

```yaml
# Cache miss: install browsers AND OS dependencies
- run: npx playwright install --with-deps
  if: steps.playwright-cache.outputs.cache-hit != 'true'

# Cache hit: install only OS dependencies (not cacheable)
- run: npx playwright install-deps
  if: steps.playwright-cache.outputs.cache-hit == 'true'
```

### Playwright Browser Sizes (approximate)

| Browser       | Size (compressed) | Size (on disk) |
| ------------- | ----------------- | -------------- |
| Chromium      | ~150 MB           | ~350 MB        |
| Firefox       | ~80 MB            | ~200 MB        |
| WebKit        | ~60 MB            | ~150 MB        |
| **All three** | **~290 MB**       | **~700 MB**    |

Playwright browsers alone are well within cache limits. The 2-5 GB concern applies when you add AI model files and browser user data directories on top.

### Alternative: Playwright Docker Image

For CI, pulling the official Playwright Docker image (`mcr.microsoft.com/playwright`) is often faster than caching. Community benchmarks indicate Docker pull is faster than GitHub Cache restore + Docker load for container-based approaches.

**Sources:**

- [Playwright CI docs](https://playwright.dev/docs/ci)
- [microsoft/playwright#7249](https://github.com/microsoft/playwright/issues/7249)
- [Caching Playwright in GitHub Actions (Justin Poehnelt)](https://justin.poehnelt.com/posts/caching-playwright-in-github-actions/)
- [DEV Community: How To Cache Playwright Browser On Github Actions](https://dev.to/ayomiku222/how-to-cache-playwright-browser-on-github-actions-51o6)

---

## 3. Caching Browser User Data Directories

### What's in a Chrome/Edge User Data Directory?

A typical user data directory contains:

- `Default/` profile folder (preferences, bookmarks, extensions, history)
- `Cache/`, `Code Cache/`, `GPUCache/` -- volatile disk caches
- `Service Worker/`, `IndexedDB/`, `Local Storage/` -- web storage
- `SingletonLock`, `SingletonSocket`, `SingletonCookie` -- process lock files
- `Web Data`, `History`, `Cookies` -- SQLite databases
- Downloaded AI model files (in `IndexedDB/` or `Cache Storage/`)

### Critical Pitfalls

#### 1. Lock Files Prevent Browser Startup (CRITICAL)

Chrome creates `SingletonLock`, `SingletonSocket`, and `SingletonCookie` files to prevent multiple instances from using the same profile. If the browser crashes or is killed (common in CI), these lock files persist. Restoring a cache that includes them **will prevent Chrome from starting**.

**Prevention:** Always exclude lock files when caching:

```yaml
path: |
  /path/to/user-data-dir
  !/path/to/user-data-dir/SingletonLock
  !/path/to/user-data-dir/SingletonSocket
  !/path/to/user-data-dir/SingletonCookie
```

Or delete them after cache restore:

```bash
rm -f /path/to/user-data-dir/Singleton*
```

#### 2. Cache Corruption from Mid-Write Snapshots (HIGH RISK)

Chromium's disk cache uses index files and data block-files without external locking. If the cache was captured while Chrome was writing (e.g., CI job killed mid-test), the restored cache may have inconsistent index/data files. Chrome will detect this at some point and **discard the entire cache**, negating the caching benefit.

**Prevention:**

- Always ensure Chrome is fully shut down before caching.
- Use `actions/cache/save` (split action) in an explicit step after browser shutdown, not in a post-job hook where timing is uncertain.

#### 3. Version Mismatch Corruption (MEDIUM RISK)

Chrome/Edge's internal file formats change between versions. A cached user data directory from Chrome 120 may not work correctly with Chrome 122. This can cause silent data corruption or startup failures.

**Prevention:** Include the browser version in the cache key:

```yaml
key: ${{ runner.os }}-chrome-profile-${{ env.CHROME_VERSION }}-${{ hashFiles('model-manifest.json') }}
```

#### 4. Cache Size Bloat (MEDIUM RISK)

A user data directory can grow to several GB, mostly from volatile caches (`Cache/`, `Code Cache/`, `GPUCache/`) that provide no value in CI.

**Prevention:** Exclude volatile subdirectories:

```yaml
path: |
  /path/to/user-data-dir/Default/IndexedDB
  /path/to/user-data-dir/Default/Cache Storage
  /path/to/user-data-dir/Default/Local Storage
```

Only cache the specific subdirectories containing AI model data (typically `IndexedDB/` or `Cache Storage/` where models downloaded via Cache API or OPFS reside).

### Recommended Approach for AI Model Data

Instead of caching the entire user data directory, **cache only the model files separately** and inject them into the browser profile at test time:

1. Cache ONNX/WASM model files in a dedicated cache entry.
2. At test startup, copy model files into the browser's expected storage location.
3. Or use a local HTTP server to serve models, with the model directory cached.

This avoids all user data directory corruption issues.

**Confidence:** MEDIUM -- based on Chromium design docs and community CI experience. No single authoritative guide exists for this specific scenario.

**Sources:**

- [Chromium Disk Cache design](https://www.chromium.org/developers/design-documents/network-stack/disk-cache/)
- [Chromium OS: Protecting Cached User Data](https://www.chromium.org/chromium-os/chromiumos-design-docs/protecting-cached-user-data/)
- [Google Cloud: Chrome in VDI environments](https://cloud.google.com/blog/products/chrome-enterprise/configuring-chrome-browser-in-your-vdi-environment)

---

## 4. Alternative Caching Approaches

### 4a. GitHub Actions Artifacts (upload-artifact / download-artifact)

| Property                       | Value                              |
| ------------------------------ | ---------------------------------- |
| Per-artifact size              | Up to 5 GB                         |
| Aggregate storage (Free)       | 500 MB                             |
| Aggregate storage (Pro)        | 1 GB                               |
| Aggregate storage (Team)       | 2 GB                               |
| Aggregate storage (Enterprise) | 50 GB                              |
| Retention                      | 1-90 days (configurable)           |
| Cross-workflow sharing         | Yes (same repo, via artifact name) |
| Cross-job sharing              | Yes (within same workflow run)     |

**Verdict: Poor fit for large persistent caching.** Artifact storage quotas are tight, especially on free/team plans. Artifacts are designed for build outputs within a single workflow run, not persistent caching across runs. The 500 MB free-tier aggregate limit makes this impractical for 2-5 GB browser artifacts.

Recent improvement (February 2026): [Non-zipped artifact uploads](https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/) are now supported, reducing overhead for already-compressed content.

### 4b. External Cloud Storage (S3, Azure Blob, GCS)

**Best option for artifacts exceeding 3 GB or when GitHub cache limits are insufficient.**

| Storage    | Action/Tool                    | Auth Method     | Notes                                         |
| ---------- | ------------------------------ | --------------- | --------------------------------------------- |
| AWS S3     | `aws s3 cp` / `aws s3 sync`    | OIDC or secrets | Unlimited storage, ~300-500 MB/s with RunsOn  |
| Azure Blob | `az storage blob upload-batch` | OIDC or secrets | Native to GitHub-hosted runners (Azure infra) |
| GCS        | `gcloud storage cp`            | OIDC or secrets | Similar to S3                                 |

Example with S3:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-arn: arn:aws:iam::123456789:role/ci-cache
    aws-region: us-east-1

- name: Restore model cache from S3
  run: |
    aws s3 sync s3://my-ci-cache/models ./models --only-show-errors || true

- name: Save model cache to S3
  if: steps.check-models.outputs.changed == 'true'
  run: |
    aws s3 sync ./models s3://my-ci-cache/models --only-show-errors
```

**Pros:**

- Unlimited storage
- No eviction pressure from other caches
- Configurable retention policies
- Potentially faster than GitHub cache for self-hosted runners

**Cons:**

- Additional infrastructure to manage
- Cloud provider costs
- Requires secret/OIDC configuration
- More complex workflow setup

### 4c. GitHub Packages / Container Registry (GHCR)

An unconventional but viable approach: package model files as an OCI artifact or Docker image layer.

```yaml
- name: Pull model image
  run: |
    docker pull ghcr.io/${{ github.repository }}/models:latest || true
    docker create --name model-extract ghcr.io/${{ github.repository }}/models:latest || true
    docker cp model-extract:/models ./models || true
    docker rm model-extract || true
```

| Property             | Value                           |
| -------------------- | ------------------------------- |
| Storage (Free)       | 500 MB                          |
| Storage (Pro)        | 2 GB                            |
| Storage (Team)       | 2 GB                            |
| Storage (Enterprise) | 50 GB                           |
| Per-file limit       | No explicit limit (layer-based) |

**Verdict: Niche use case.** GHCR storage quotas are even tighter than artifacts on free plans. The Docker image approach adds complexity. However, for Enterprise plans with 50 GB, this can work well since Docker layer caching is efficient for infrequently-changing model files.

### 4d. Split Save/Restore with actions/cache/save and actions/cache/restore

The `actions/cache` action combines restore-on-start and save-on-post-job. The split actions provide granular control:

```yaml
# Restore at the beginning of the job
- uses: actions/cache/restore@v4
  id: model-cache
  with:
    path: ./models
    key: models-${{ hashFiles('model-manifest.json') }}
    restore-keys: |
      models-

# ... run tests ...

# Save only if models changed (regardless of job outcome)
- uses: actions/cache/save@v4
  if: always() && steps.model-cache.outputs.cache-hit != 'true'
  with:
    path: ./models
    key: models-${{ hashFiles('model-manifest.json') }}
```

**Key advantages for this use case:**

1. **Save on failure:** If browser tests crash after downloading models, `actions/cache/save` with `if: always()` still saves the models for next run.
2. **Conditional save:** Only save when cache was not already hit, avoiding redundant uploads.
3. **Multi-step caching:** Restore models early, save browser profile later, each with independent keys.

**Confidence:** HIGH -- `actions/cache/save` and `actions/cache/restore` are documented features in [actions/cache](https://github.com/actions/cache).

### 4e. Third-Party Cache Solutions

| Solution                                                                              | Storage        | Speed                  | Cost              |
| ------------------------------------------------------------------------------------- | -------------- | ---------------------- | ----------------- |
| [RunsOn S3 Cache](https://runs-on.com/caching/s3-cache-for-github-actions/)           | Unlimited (S3) | 300-500 MB/s           | S3 costs          |
| [Namespace Cache Volumes](https://namespace.so/docs/solutions/github-actions/caching) | 20 GB minimum  | Fast (local volume)    | Namespace pricing |
| [Depot](https://depot.dev/blog/github-actions-cache)                                  | Unlimited (S3) | Up to 10x GitHub cache | Depot pricing     |
| [Buildjet Cache](https://buildjet.com)                                                | Expanded       | Fast                   | Buildjet pricing  |

These are most relevant for teams already using these platforms for other reasons.

---

## 5. Cache Warming Strategies

### Cache Scoping Rules (Critical to Understand)

```
main (default branch)
  |-- Caches created here are accessible to ALL branches
  |
  +-- feature-a (can read main's caches + its own)
  |     |
  |     +-- PR #42 (can read feature-a + main caches, writes to refs/pull/42/merge scope)
  |
  +-- feature-b (can read main's caches + its own, CANNOT read feature-a's caches)
```

**Key insight:** Caches created on the default branch are the only universally accessible caches. This is why cache warming workflows should target `main`.

### Strategy 1: Dedicated Cache Warming Workflow (Recommended)

Create a workflow that runs on `main` specifically to populate caches:

```yaml
# .github/workflows/warm-cache.yml
name: Warm CI Cache
on:
  push:
    branches: [main]
    paths:
      - 'model-manifest.json'
      - 'package-lock.json'
      - 'playwright.config.*'
  schedule:
    - cron: '0 6 * * 1' # Weekly Monday 6 AM (keep caches alive before 7-day expiry)

jobs:
  warm-models:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Restore existing model cache
        uses: actions/cache/restore@v4
        id: model-cache
        with:
          path: ./models
          key: models-${{ hashFiles('model-manifest.json') }}

      - name: Download models (cache miss only)
        if: steps.model-cache.outputs.cache-hit != 'true'
        run: |
          node scripts/download-models.js

      - name: Save model cache
        if: steps.model-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ./models
          key: models-${{ hashFiles('model-manifest.json') }}

  warm-playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Get Playwright version
        run: |
          PLAYWRIGHT_VERSION=$(node -e "console.log(require('./package-lock.json').packages['node_modules/@playwright/test'].version)")
          echo "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" >> $GITHUB_ENV

      - name: Restore Playwright cache
        uses: actions/cache/restore@v4
        id: pw-cache
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ env.PLAYWRIGHT_VERSION }}

      - name: Install Playwright browsers
        if: steps.pw-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Save Playwright cache
        if: steps.pw-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ env.PLAYWRIGHT_VERSION }}
```

### Strategy 2: First-Run Population in CI Workflow

If a dedicated warming workflow is overkill, the CI workflow itself can populate the cache on first run:

```yaml
- uses: actions/cache@v4
  id: model-cache
  with:
    path: ./models
    key: models-${{ hashFiles('model-manifest.json') }}
    restore-keys: |
      models-

# First run: cache miss, download models (~2-5 min)
# Subsequent runs: cache hit, skip download (~30-60 sec restore)
- name: Download models if not cached
  if: steps.model-cache.outputs.cache-hit != 'true'
  run: node scripts/download-models.js
```

The downside: the first CI run on every new branch will be slow (cache miss), and the cache created is scoped to that branch. Sibling branches cannot reuse it.

### Strategy 3: Scheduled Cache Refresh (Keep-Alive)

Since caches expire after 7 days of inactivity, run a weekly workflow that touches critical caches:

```yaml
on:
  schedule:
    - cron: '0 0 * * 0' # Every Sunday

jobs:
  keep-cache-alive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache/restore@v4
        with:
          path: ./models
          key: models-${{ hashFiles('model-manifest.json') }}
          restore-keys: models-
      # Restoring the cache counts as "accessing" it, resetting the 7-day timer
```

### Strategy 4: Layered Cache Keys for Partial Hits

For large model directories where individual models change independently:

```yaml
# Exact match: all models at exact versions
key: models-${{ hashFiles('model-manifest.json') }}

# Partial match: restore whatever we have, then download only missing models
restore-keys: |
  models-
```

The `restore-keys` prefix match restores the closest available cache. Your download script should then check which models are already present and only download missing ones.

### Recommended Cache Key Design

```
{os}-{purpose}-{content-hash}
```

| Cache                 | Key                                                                           | Approximate Size       |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| Node modules          | `linux-npm-${{ hashFiles('package-lock.json') }}`                             | 200-500 MB             |
| Playwright browsers   | `linux-playwright-${{ env.PLAYWRIGHT_VERSION }}`                              | 350 MB (Chromium only) |
| AI models (ONNX/WASM) | `models-${{ hashFiles('model-manifest.json') }}`                              | 1-4 GB                 |
| Browser profile data  | `linux-profile-${{ env.CHROME_VER }}-${{ hashFiles('model-manifest.json') }}` | 500 MB - 2 GB          |

**Total estimated cache usage: 2-7 GB** -- fits within 10 GB default limit if models are under 4 GB.

---

## 6. Recommended Architecture for This Project

Based on all findings, here is the recommended caching architecture:

### Tier 1: Use actions/cache for Playwright + Node modules (straightforward)

Standard caching for dependencies and browser binaries. Well-documented, widely used.

### Tier 2: Use actions/cache for AI model files (with care)

Cache downloaded ONNX/WASM model files in a dedicated cache entry keyed to a model manifest file. Use split save/restore actions for reliability. Keep models under 4 GB to leave room for other caches.

### Tier 3: Do NOT cache browser user data directories

The corruption risks (lock files, mid-write snapshots, version mismatches) outweigh the benefits. Instead:

- Start with a fresh browser profile each run.
- Pre-populate model files via a local HTTP server or file injection.
- If model download into the browser is the bottleneck, cache the model files externally and serve them locally rather than trying to cache the browser's internal storage format.

### Tier 4: External storage (S3/Azure) as escape hatch

Only needed if total cache requirements exceed 10 GB or if model files exceed 5 GB. Adds operational complexity.

### Cache Warming: Use a dedicated workflow on main

Run on push-to-main (when model manifest changes) and on a weekly schedule. This ensures all feature branches and PRs have warm caches available.

---

## Summary of Hard Limits

| Resource                             | Limit                         | Source                                                                                                                        |
| ------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Repository cache storage (free)      | 10 GB                         | [GitHub docs](https://docs.github.com/en/actions/reference/limits)                                                            |
| Repository cache storage (paid, max) | Up to 10 TB                   | [Nov 2025 changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/) |
| Cache entry expiry                   | 7 days unused                 | [GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)                          |
| Cache key max length                 | 512 characters                | [actions/cache README](https://github.com/actions/cache)                                                                      |
| Cache upload rate                    | 200/min per repo              | [Jan 2026 changelog](https://github.blog/changelog/2026-01-16-rate-limiting-for-actions-cache-entries/)                       |
| Cache download rate                  | 1,500/min per repo            | [Jan 2026 changelog](https://github.blog/changelog/2026-01-16-rate-limiting-for-actions-cache-entries/)                       |
| Cache download segments              | 1 GB (32-bit) / 2 GB (64-bit) | [actions/cache tips](https://github.com/actions/cache/blob/main/tips-and-workarounds.md)                                      |
| Artifact per-entry size              | Up to 5 GB                    | [GitHub docs](https://docs.github.com/en/actions/reference/limits)                                                            |
| Artifact storage (free)              | 500 MB total                  | [GitHub docs](https://docs.github.com/en/actions/reference/limits)                                                            |
| GitHub-hosted runner bandwidth       | ~125 MB/s (1 Gbps)            | [Depot blog](https://depot.dev/blog/github-actions-cache)                                                                     |

---

## Open Questions

1. **Per-entry cache size limit:** GitHub docs do not explicitly state a maximum size for a single cache entry. Empirically, entries up to 10 GB work, but the exact ceiling is undocumented. LOW confidence on whether entries above 10 GB work even with expanded storage.

2. **ONNX Runtime Web 4 GB WASM limit:** WebAssembly's 32-bit addressing limits models to 4 GB. If your AI models approach this limit, the browser itself cannot load them regardless of caching strategy. This is a runtime constraint, not a CI constraint.

3. **Cache API vs IndexedDB vs OPFS:** The specific browser storage API used by the in-browser AI framework determines which subdirectory of the user data dir holds model data. This needs to be verified per-framework to know exactly what to cache.
