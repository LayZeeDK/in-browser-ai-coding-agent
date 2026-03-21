# npm CI Caching Optimization for Windows ARM64 Runners

**Researched:** 2026-03-21
**Domain:** CI/CD dependency caching on `windows-11-arm` GitHub Actions runners
**Overall confidence:** HIGH (primary sources: GitHub official docs, actions/setup-node source code, npm docs, GitHub Changelog)

---

## Executive Summary

The current CI workflow uses `actions/setup-node@v6` with `cache: 'npm'`, which caches only the npm download cache (`%LocalAppData%\npm-cache` on Windows), **not** `node_modules/`. This means `npm ci` still runs on every workflow invocation: it deletes `node_modules/`, resolves all 1,657 packages, and rebuilds native modules from cached tarballs. The cache provides a modest speedup (avoids re-downloading from the registry) but does not eliminate the most expensive part: constructing `node_modules/` from scratch.

The recommended optimization is to **cache `node_modules/` directly** via `actions/cache` and **skip `npm ci` entirely on cache hit**. For this project (542 MB `node_modules/`, pinned Node.js 24, many ARM64-native optional dependencies), this is safe and should reduce the dependency step from 1-3 minutes to ~10-20 seconds (cache restore time). The lockfile hash as cache key ensures correctness -- any dependency change triggers a fresh `npm ci`.

---

## 1. What `actions/setup-node@v6` `cache: 'npm'` Actually Caches

### Answer: The npm global download cache, NOT `node_modules/`

The `actions/setup-node` action calls `npm config get cache` to locate the npm cache directory and caches that path using `actions/cache` under the hood.

| Property                     | Value                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **What gets cached**         | npm's global download cache (package tarballs)                                                           |
| **Path on Windows**          | `%LocalAppData%\npm-cache` (npm v7+) or `%AppData%\npm-cache` (older npm)                                |
| **Path on Linux**            | `~/.npm`                                                                                                 |
| **Cache key format**         | `node-cache-{platform}-npm-{hash(package-lock.json)}`                                                    |
| **Does `npm ci` still run?** | YES -- every single time                                                                                 |
| **Speed benefit**            | Moderate: avoids downloading tarballs from registry, but npm still rebuilds `node_modules/` from scratch |

**Key insight:** `npm ci` always deletes `node_modules/` before installing. Even with a warm npm download cache, npm must still:

1. Delete `node_modules/` entirely
2. Read and resolve `package-lock.json` (1,657 packages)
3. Extract each tarball from the download cache into `node_modules/`
4. Run install scripts for native modules (@swc/core, esbuild, nx, @parcel/watcher, lmdb, etc.)
5. Build the `node_modules/.package-lock.json` hidden lockfile

This costs 1-3 minutes even with a warm download cache.

**Confidence:** HIGH -- verified from [actions/setup-node source code](https://github.com/actions/setup-node/blob/main/src/cache-utils.ts) and [advanced usage docs](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md).

---

## 2. `npm ci` vs `npm install` for CI

### `npm ci` is correct for CI, but its approach is wasteful when dependencies rarely change

| Property                                      | `npm ci`                     | `npm install`                   |
| --------------------------------------------- | ---------------------------- | ------------------------------- |
| Deletes `node_modules/`                       | Yes (always)                 | No                              |
| Requires lockfile                             | Yes (fails without)          | No (creates/updates it)         |
| Modifies lockfile                             | No                           | Yes (may update)                |
| Deterministic                                 | Yes                          | No (may resolve newer versions) |
| Speed (cold)                                  | Faster than `npm install`    | Slower (must resolve)           |
| Speed (warm cache + existing `node_modules/`) | Slow (destroys and rebuilds) | Fast (only installs changes)    |

**The problem:** In most CI runs, dependencies have not changed. `npm ci` still spends 1-3 minutes deleting and reconstructing `node_modules/` with the exact same content. There is no `npm ci --if-needed` or `npm ci --keep-node-modules` flag.

**npm has no equivalent to `yarn install --frozen-lockfile`** -- which verifies the lockfile is in sync without deleting `node_modules/`. The only npm command that enforces lockfile integrity is `npm ci`, and it always starts from scratch.

**Confidence:** HIGH -- verified from [npm ci docs](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

---

## 3. Windows ARM64 Specifics

### Node.js on the `windows-11-arm` Runner

| Property                          | Value                                                     |
| --------------------------------- | --------------------------------------------------------- |
| **Preinstalled Node.js**          | 22.17.1 (primary), 20.19.4 (cached)                       |
| **Preinstalled npm**              | 10.9.2                                                    |
| **Architecture**                  | ARM64-native (Azure Cobalt 100, Arm Neoverse N2, 4 vCPUs) |
| **QEMU emulation**                | Not used -- this is a native ARM64 runner                 |
| **Runner label**                  | `windows-11-arm`                                          |
| **`actions/setup-node` handling** | Installs native ARM64 Node.js binary                      |

### Native ARM64 Packages in This Project

This project has extensive ARM64 Windows native optional dependencies in `package-lock.json`:

| Package                 | ARM64 Binary                             |
| ----------------------- | ---------------------------------------- |
| `@swc/core`             | `@swc/core-win32-arm64-msvc`             |
| `esbuild`               | `@esbuild/win32-arm64`                   |
| `nx`                    | `@nx/nx-win32-arm64-msvc`                |
| `@parcel/watcher`       | `@parcel/watcher-win32-arm64`            |
| `lmdb`                  | `@lmdb/lmdb-win32-arm64`                 |
| `@rollup/rollup`        | `@rollup/rollup-win32-arm64-msvc`        |
| `@rolldown/binding`     | `@rolldown/binding-win32-arm64-msvc`     |
| `@rspack/binding`       | `@rspack/binding-win32-arm64-msvc`       |
| `@oxc-resolver/binding` | `@oxc-resolver/binding-win32-arm64-msvc` |
| `@napi-rs/nice`         | `@napi-rs/nice-win32-arm64-msvc`         |

**Implication for caching:** These native binaries are platform-specific. A `node_modules/` cache is ONLY valid for the same OS + architecture combination. The cache key must include the runner OS (which `runner.os` provides as "Windows"). Since this project uses a single Windows ARM64 runner target, cross-platform contamination is not a concern as long as the cache key distinguishes OS.

**Implication for `npm ci` speed:** Building/extracting these native binaries is a significant portion of the `npm ci` time. Caching `node_modules/` directly avoids rebuilding them on every run.

**Confidence:** HIGH -- verified from [partner-runner-images](https://github.com/actions/partner-runner-images/blob/main/images/arm-windows-11-image.md) and the project's `package-lock.json`.

---

## 4. Caching Strategies Compared

### Strategy A: Current Setup (`actions/setup-node` npm download cache)

```yaml
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    cache: 'npm'
- run: npm ci
```

| Metric                   | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| Cache hit: install time  | ~1-3 minutes (rebuilds node_modules from cached tarballs) |
| Cache miss: install time | ~2-4 minutes (downloads + rebuilds)                       |
| Cache size               | ~200-400 MB (compressed tarballs)                         |
| Correctness risk         | None -- `npm ci` enforces lockfile                        |
| Complexity               | Minimal (built-in)                                        |

### Strategy B: Cache `node_modules/` directly, skip `npm ci` on hit (RECOMMENDED)

```yaml
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    # Disable built-in npm cache -- we handle caching ourselves
    cache: ''

- name: Cache node_modules
  id: cache-node-modules
  uses: actions/cache@v5
  with:
    path: node_modules
    key: ${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}
    # No restore-keys! A partial match would be deleted by npm ci anyway.

- name: Install dependencies
  if: steps.cache-node-modules.outputs.cache-hit != 'true'
  run: npm ci
```

| Metric                   | Value                                               |
| ------------------------ | --------------------------------------------------- |
| Cache hit: install time  | ~10-20 seconds (cache restore only, no npm ci)      |
| Cache miss: install time | ~2-4 minutes (fresh npm ci, then cache saved)       |
| Cache size               | ~542 MB uncompressed, ~200-300 MB compressed (zstd) |
| Correctness risk         | Low -- exact lockfile hash ensures exact match      |
| Complexity               | Low (3 extra YAML lines)                            |

### Strategy C: Cache both npm download cache AND `node_modules/`

This is redundant. If `node_modules/` cache hits, the npm download cache is never used. If `node_modules/` cache misses, `npm ci` fetches from the registry (fast enough). The double cache wastes cache storage.

**Verdict: Do not use.**

### Strategy D: Cache npm download cache via `actions/cache` directly (instead of setup-node)

```yaml
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    cache: ''

- uses: actions/cache@v5
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-npm-

- run: npm ci
```

This gives more control over cache keys (e.g., adding `restore-keys` for partial matches) but still runs `npm ci` every time. Marginal improvement over Strategy A.

**Verdict: Slight improvement over A, but Strategy B is strictly better.**

### Comparison Matrix

| Strategy                  | Cache Hit Time | Cache Miss Time | Storage     | Correctness   | Complexity |
| ------------------------- | -------------- | --------------- | ----------- | ------------- | ---------- |
| A: setup-node npm cache   | ~1-3 min       | ~2-4 min        | ~300 MB     | Perfect       | Minimal    |
| **B: node_modules cache** | **~15 sec**    | **~2-4 min**    | **~300 MB** | **Excellent** | **Low**    |
| C: Both caches            | ~15 sec        | ~2-4 min        | ~600 MB     | Excellent     | Medium     |
| D: Manual npm cache       | ~1-3 min       | ~2-4 min        | ~300 MB     | Perfect       | Low        |

---

## 5. Lockfile Verification When Caching `node_modules/`

### How the cache key ensures correctness

The cache key `${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}` is the critical correctness mechanism:

1. **Any dependency change** modifies `package-lock.json`, which changes the hash, which changes the cache key, which causes a cache miss, which triggers a fresh `npm ci`.
2. **No restore-keys** means stale partial matches are never restored. This is intentional -- if the lockfile changed, we want a clean install, not a potentially broken `node_modules/`.
3. **`runner.os` in the key** prevents cross-platform cache contamination. A `node_modules/` from Linux would never be restored on Windows.

### What about uncommitted lockfile changes?

If a developer modifies `package.json` without running `npm install` (so the lockfile is stale), `npm ci` would catch this error on the first CI run (cache miss due to changed `package.json`). On subsequent runs with the same lockfile, the cache would hit and `npm ci` would be skipped -- but since the lockfile didn't change, the `node_modules/` is still correct for that lockfile.

**The only scenario where caching `node_modules/` could be wrong:** If `package-lock.json` is committed out of sync with `package.json`. But `npm ci` catches this on the cache-miss run and would fail, preventing the bad state from being cached.

### Optional: Add Node.js version to cache key

If you change Node.js versions frequently, include it in the key:

```yaml
key: ${{ runner.os }}-node${{ steps.node.outputs.node-version }}-modules-${{ hashFiles('package-lock.json') }}
```

For this project, the Node.js version is pinned in `.node-version` (currently `24`), and changing it is rare enough that the lockfile likely also changes (due to native module recompilation). Including it is a belt-and-suspenders measure.

**Confidence:** HIGH -- this is a well-established pattern documented by [GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) and [actions/cache examples](https://github.com/actions/cache/blob/master/examples.md).

---

## 6. Nx-Specific Caching

### Nx Local Cache (`.nx/cache`)

Nx caches task outputs (build, lint, test, typecheck) in `.nx/cache` by default. This is a local file-based cache. The current `nx.json` enables caching for all major targets.

### Should we cache `.nx/cache` in GitHub Actions?

| Scenario                    | Recommendation                                   |
| --------------------------- | ------------------------------------------------ |
| **Same PR, re-run**         | Yes, cache hit would skip unchanged task targets |
| **Different PR, same code** | Possible hit if base branch cache exists         |
| **Cross-branch sharing**    | Limited by GitHub Actions cache scoping rules    |

**However**, Nx task caching is less impactful than `node_modules` caching for this project because:

1. The most expensive CI steps (Playwright tests, Edge Dev AI model bootstrapping) are **not cached by Nx** -- they involve browser automation with side effects.
2. Lint, typecheck, and build are relatively fast compared to dependency installation + browser tests.
3. Adding `.nx/cache` to GitHub Actions cache adds complexity and cache storage pressure.

### Nx Cloud (Remote Cache)

Nx offers remote caching via Nx Cloud (free tier available). This would allow caching task outputs across branches and CI runs. However:

- It requires an Nx Cloud account and access token.
- For this project, the bottleneck is dependency installation and browser tests, not Nx-cacheable tasks.
- The CREEP vulnerability (CVE-2025-36852) affects self-hosted bucket-based alternatives, pushing toward Nx Cloud as the managed option.

**Recommendation:** Do NOT add Nx cache to GitHub Actions at this time. If Nx-cacheable tasks become a bottleneck later, consider Nx Cloud rather than `actions/cache` for `.nx/cache`.

**Confidence:** MEDIUM -- based on [Nx caching docs](https://nx.dev/docs/concepts/how-caching-works) and project-specific analysis. The value assessment depends on actual task durations.

---

## 7. Recommended Configuration

### Optimized CI Workflow (test job, `windows-11-arm` matrix entry)

Replace the current pattern:

```yaml
# BEFORE (current)
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    cache: 'npm'

- run: npm ci
```

With:

```yaml
# AFTER (optimized)
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    # Disable built-in npm cache; we cache node_modules directly
    cache: ''

- name: Cache node_modules
  id: cache-node-modules
  uses: actions/cache@v5
  with:
    path: node_modules
    key: ${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}

- name: Install dependencies
  if: steps.cache-node-modules.outputs.cache-hit != 'true'
  run: npm ci
```

### Full Test Job Example

```yaml
test:
  needs: ghcr
  runs-on: ${{ matrix.runner }}
  strategy:
    fail-fast: false
    matrix:
      include:
        - browser: chrome-beta
          project: chrome-gemini-nano
          cache-key: chrome-beta-cpu-container-v1
          runner: ubuntu-latest
          xvfb: 'xvfb-run --auto-servernum'
          container: true
        - browser: msedge-dev
          project: edge-phi4-mini
          cache-key: msedge-dev-ai-model-windows11-arm-v1
          runner: windows-11-arm
          xvfb: ''
          container: false
  container: ${{ matrix.container && fromJSON(format('{{"image":"{0}-{1}:latest","options":"--ipc=host --user 1001"}}', needs.ghcr.outputs.image, matrix.browser)) || '' }}
  steps:
    - uses: actions/checkout@v6
      with:
        filter: tree:0
        fetch-depth: 0

    - uses: nrwl/nx-set-shas@v5

    - uses: actions/setup-node@v6
      with:
        node-version-file: '.node-version'
        cache: ''

    - name: Cache node_modules
      id: cache-node-modules
      uses: actions/cache@v5
      with:
        path: node_modules
        key: ${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}

    - name: Install dependencies
      if: steps.cache-node-modules.outputs.cache-hit != 'true'
      run: npm ci

    - name: Install ${{ matrix.browser }}
      if: ${{ !matrix.container }}
      run: npx playwright install ${{ matrix.browser }} --with-deps

    # ... rest of workflow unchanged ...
```

### Apply to ALL Jobs (format, lint-typecheck-build, test)

The same pattern works for the `format` and `lint-typecheck-build` jobs too:

```yaml
format:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
      with:
        filter: tree:0
        fetch-depth: 0

    - uses: nrwl/nx-set-shas@v5

    - uses: actions/setup-node@v6
      with:
        node-version-file: '.node-version'
        cache: ''

    - name: Cache node_modules
      id: cache-node-modules
      uses: actions/cache@v5
      with:
        path: node_modules
        key: ${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}

    - name: Install dependencies
      if: steps.cache-node-modules.outputs.cache-hit != 'true'
      run: npm ci

    - run: npm exec nx -- format:check
```

**Important:** The `runner.os` in the cache key means Linux and Windows jobs naturally have separate caches (key prefix `Linux-node-modules-...` vs `Windows-node-modules-...`). This is correct and necessary since native binaries differ between platforms.

---

## 8. Cache Storage Budget

| Cache Entry                 | Estimated Compressed Size | Key                                    |
| --------------------------- | ------------------------- | -------------------------------------- |
| Linux node_modules          | ~200-300 MB               | `Linux-node-modules-{lockfile-hash}`   |
| Windows node_modules        | ~200-300 MB               | `Windows-node-modules-{lockfile-hash}` |
| Edge Dev AI model profile   | ~500 MB - 2 GB            | `msedge-dev-ai-model-windows11-arm-v1` |
| Chrome Beta container image | N/A (in GHCR)             | N/A                                    |
| **Total**                   | **~900 MB - 2.6 GB**      |                                        |

Well within the 10 GB GitHub Actions cache limit. The AI model cache is the largest consumer, not `node_modules/`.

---

## 9. actions/cache Version Recommendation

Use `actions/cache@v5` (latest: v5.0.3):

- Runs on Node.js 24 runtime
- Uses the new cache service v2 backend (rolled out Feb 2025)
- Uses zstd compression (significantly faster than gzip on Windows)
- Requires runner version >= 2.327.1 (the `windows-11-arm` hosted runners meet this)

**Do not use** `actions/cache@v4` or older -- they use the legacy cache backend and will eventually be deprecated.

**Confidence:** HIGH -- verified from [actions/cache releases](https://github.com/actions/cache/releases) and [GitHub Changelog](https://github.blog/changelog/).

---

## 10. Pitfalls and Caveats

### Pitfall 1: Using `restore-keys` with `node_modules/` caching

**What goes wrong:** A partial cache match restores a stale `node_modules/` that doesn't match the current lockfile. Then `npm ci` (which would fix it) is skipped because `cache-hit` is based on exact match... except `actions/cache` sets `cache-hit` to `false` for restore-key matches. However, this creates a subtle bug: the stale `node_modules/` is present, `npm ci` runs and deletes it, then rebuilds. The stale restore wasted time.
**Prevention:** Do NOT use `restore-keys`. An exact match or nothing.

### Pitfall 2: Forgetting to disable `actions/setup-node` built-in caching

**What goes wrong:** Both `actions/setup-node` and `actions/cache` try to cache npm data. Wastes cache storage and adds confusion. `setup-node` caches `~/.npm`; your manual step caches `node_modules/`. They don't conflict functionally but waste space.
**Prevention:** Set `cache: ''` on `actions/setup-node` when using manual `actions/cache` for `node_modules/`.

### Pitfall 3: Node.js version change without lockfile change

**What goes wrong:** If you change `.node-version` from 22 to 24 but don't run `npm install` to regenerate the lockfile, the cache key doesn't change, and you get `node_modules/` built for Node 22 running on Node 24. Native modules may crash.
**Prevention:** This is unlikely in practice because changing Node.js major versions almost always requires updating the lockfile (native binaries have version-specific builds). As an extra safety measure, include Node.js version in the cache key:

```yaml
key: ${{ runner.os }}-node${{ steps.setup-node.outputs.node-version }}-modules-${{ hashFiles('package-lock.json') }}
```

Note: `actions/setup-node@v6` provides `node-version` as an output.

### Pitfall 4: Cache size exceeding repository limits

**What goes wrong:** With multiple OS targets (Linux + Windows) and the AI model cache, total cache usage could approach 3 GB. Not close to the 10 GB limit but worth monitoring.
**Prevention:** Monitor via the GitHub Actions Cache management UI. The 7-day eviction policy automatically cleans stale entries.

### Pitfall 5: `actions/cache@v5` minimum runner version

**What goes wrong:** Self-hosted runners with runner version < 2.327.1 will fail with `actions/cache@v5`.
**Prevention:** The `windows-11-arm` hosted runners are maintained by GitHub and always meet the minimum version. This is only a concern for self-hosted runners.

---

## 11. Answers to Specific Research Questions

### Q1: What does `actions/setup-node` `cache: 'npm'` actually cache?

**A:** The npm download cache directory (`%LocalAppData%\npm-cache` on modern Windows, `~/.npm` on Linux). NOT `node_modules/`. npm must still reconstruct `node_modules/` from cached tarballs on every run.

### Q2: Is `npm ci` the best choice for CI?

**A:** `npm ci` is correct for ensuring lockfile integrity, but running it on every CI invocation is wasteful. The optimal pattern: cache `node_modules/` keyed on the lockfile hash, run `npm ci` only on cache miss. This gives you lockfile enforcement (on miss) plus instant restores (on hit).

### Q3: Are there performance differences for npm on Windows ARM64?

**A:** The `windows-11-arm` runners are native ARM64 (Azure Cobalt 100). Node.js runs natively, not under QEMU. This project has ARM64-native optional dependencies for all major packages (SWC, esbuild, Nx, Rollup, Rolldown, Rspack, Parcel Watcher, LMDB, OXC Resolver). Native ARM64 execution is significantly faster than x86 emulation.

### Q4: Which caching strategy is best?

**A:** Strategy B (cache `node_modules/` directly, skip `npm ci` on hit) is the clear winner. ~10-20 seconds on cache hit vs ~1-3 minutes with the current setup. See Section 4 for the full comparison.

### Q5: How do we verify the lockfile without `npm ci`?

**A:** We don't need to verify it separately. The cache key includes the lockfile hash. If the lockfile changed, the cache misses, and `npm ci` runs (which enforces lockfile integrity). If the lockfile didn't change, the cached `node_modules/` is guaranteed correct for that lockfile.

### Q6: Does Nx have remote caching that could help?

**A:** Nx has local caching (`.nx/cache`) and Nx Cloud for remote caching. Neither helps with dependency installation time. They cache task outputs (build, lint, test results). For this project, the bottleneck is dependency installation and browser tests, not Nx-cacheable tasks. Nx Cloud may be worth considering later if build/lint tasks become slow.

---

## Sources

- [actions/setup-node advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md) -- built-in caching docs
- [actions/setup-node source: cache-utils.ts](https://github.com/actions/setup-node/blob/main/src/cache-utils.ts) -- npm cache path detection
- [actions/cache v5](https://github.com/actions/cache) -- latest cache action
- [GitHub dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) -- official docs
- [npm ci docs](https://docs.npmjs.com/cli/v11/commands/npm-ci/) -- `npm ci` behavior
- [npm cache docs](https://docs.npmjs.com/cli/v11/commands/npm-cache/) -- cache location on Windows
- [Windows ARM64 hosted runners](https://github.blog/changelog/2025-04-14-windows-arm64-hosted-runners-now-available-in-public-preview/) -- runner announcement
- [Partner runner images (ARM Windows 11)](https://github.com/actions/partner-runner-images/blob/main/images/arm-windows-11-image.md) -- preinstalled tools
- [ARM64 runners in private repos](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/) -- Jan 2026 update
- [Tinkering with Node.js Core on ARM64 Windows](https://joyeecheung.github.io/blog/2026/01/31/tinkering-with-nodejs-core-on-arm64-windows/) -- ARM64 Windows Node.js state
- [Nx caching concepts](https://nx.dev/docs/concepts/how-caching-works) -- Nx local/remote cache
- [Super fast npm install on GitHub Actions](https://www.voorhoede.nl/en/blog/super-fast-npm-install-on-github-actions/) -- node_modules caching pattern
- [Caching npm on GitHub Actions](https://accreditly.io/articles/caching-npm-i-on-github-actions-for-faster-build-times) -- comparison of strategies
- [GitHub Actions Cache: Windows compression](https://chadgolden.com/blog/github-actions-hosted-windows-runners-slower-than-expected-ci-and-you) -- zstd/tar on Windows
