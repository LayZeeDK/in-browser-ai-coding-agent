# Research: npm Incremental Install with Frozen Lockfile

**Date:** 2026-03-23
**Confidence:** HIGH (verified against official npm v11 docs, GitHub issues, and RFC discussions)
**Verdict:** npm has NO single command for incremental + frozen-lockfile install. `npm install --no-save --prefer-offline --no-audit` is the closest practical workaround.

## Executive Summary

npm fundamentally lacks a command equivalent to `pnpm install --frozen-lockfile` or `yarn install --immutable` -- i.e., a command that (a) preserves existing `node_modules`, (b) only installs what changed, (c) fails if the lockfile is out of sync with `package.json`, and (d) never modifies `package-lock.json`. The two npm commands split these guarantees:

- **`npm ci`**: Frozen lockfile (never writes lockfile, fails on mismatch) BUT deletes `node_modules` every time.
- **`npm install`**: Incremental (preserves `node_modules`, only installs diff) BUT may modify `package-lock.json`.

This gap has been a known community pain point since 2018. As of npm 11.12.0 (March 2026), no flag or RFC has closed it.

---

## Question 1: Does `npm install --frozen-lockfile` exist?

**NO.** npm does not have a `--frozen-lockfile` flag. That flag belongs to pnpm and yarn (classic).

| Flag                   | What it actually does in npm                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--frozen-lockfile`    | **Not an npm flag.** There is a joke npm _package_ named `--frozen-lockfile` on the registry. Running `npm install --frozen-lockfile` would attempt to install that package.                             |
| `--package-lock=false` | Prevents npm from **both reading AND writing** `package-lock.json`. Resolution falls back to `package.json` + registry. This is the **opposite** of frozen lockfile -- it ignores the lockfile entirely. |
| `--no-save`            | Prevents npm from **writing** to `package.json` and `package-lock.json`. npm still **reads** the lockfile for resolution. Does NOT validate lockfile-to-package.json sync.                               |
| `--prefer-offline`     | Uses locally cached tarballs, only hits registry if cache misses. Does not affect lockfile behavior.                                                                                                     |
| `--ignore-scripts`     | Skips lifecycle scripts. Irrelevant to lockfile.                                                                                                                                                         |

**The closest npm equivalent to `--frozen-lockfile`** is `npm ci`, which never modifies the lockfile and fails if `package-lock.json` is out of sync with `package.json`.

**Source:** [npm v11 `npm install` docs](https://docs.npmjs.com/cli/v11/commands/npm-install/), [npm v11 `npm ci` docs](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [npm/npm#19740](https://github.com/npm/npm/issues/19740)

---

## Question 2: Does `npm install` with existing `node_modules` skip redundant work?

**YES, substantially.** npm's Arborist engine (v7+) computes a diff between three trees:

1. **Actual tree** -- what exists on disk in `node_modules`
2. **Virtual tree** -- what `package-lock.json` describes
3. **Ideal tree** -- what `package.json` + lockfile resolution produces

The reification process (`reify()`) only executes the **minimum set of filesystem actions** (install, update, remove, move) needed to transform the actual tree into the ideal tree. If nothing changed, the diff is empty and npm exits quickly.

**How it works internally:**

```
loadActual() -> buildIdealTree() -> diffTrees() -> reify()
  |                |                   |              |
  reads disk       reads lockfile +    computes      executes only
  node_modules     package.json        delta         changed actions
```

When `node_modules` matches the lockfile and `package.json` hasn't changed, `npm install` typically completes in seconds ("up to date in X.Xs").

**However, there are caveats:**

- npm still performs metadata resolution (checking registry for package metadata), which costs network time. `--prefer-offline` mitigates this.
- npm may write trivial lockfile changes (whitespace, metadata normalization, `resolved`/`integrity` fields) even when no packages changed. This is a [known idempotency bug](https://github.com/npm/cli/issues/3652).
- With `--no-save`, the lockfile write is suppressed, but the resolution still happens.

**Source:** [npm v7 Arborist Deep Dive](https://blog.npmjs.org/post/618653678433435649/npm-v7-series-arborist-deep-dive.html), [npm install docs](https://docs.npmjs.com/cli/v11/commands/npm-install/)

---

## Question 3: Is there `npm ci --keep-node-modules` or `npm ci --no-clean`?

**NO.** No such flag exists in any npm version (checked through npm 11.12.0).

The `npm ci` docs explicitly state: "If a `node_modules` is already present, it will be automatically removed before `npm ci` begins its install." This is by design -- the "clean" in "clean install" is the core identity of the command.

**Feature requests:**

- [npm/npm#20104](https://github.com/npm/npm/issues/20104) (2018): "Running npm ci without deleting old node_modules folder" -- showed 4x slowdown on Windows (8s vs 34s). Archived, unresolved.
- [npm/cli#564](https://github.com/npm/cli/issues/564) (2019): "Do not remove node_modules on npm ci" -- npm team rejected, stating "The `npm ci` command purpose is to delete everything to start from a clean slate." Closed as "completed" (they only fixed a minor Docker bind-mount issue, not the core request). 90+ comments, significant community frustration.

**The available `npm ci` configuration options in v11 are:**
`install-strategy`, `legacy-bundling`, `global-style`, `omit`, `include`, `strict-peer-deps`, `foreground-scripts`, `ignore-scripts`, `allow-git`, `audit`, `bin-links`, `fund`, `dry-run`, `workspace`, `workspaces`, `include-workspace-root`, `install-links`

None of these control whether `node_modules` is deleted.

**Source:** [npm ci v11 docs](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [npm/cli#564](https://github.com/npm/cli/issues/564), [npm/npm#20104](https://github.com/npm/npm/issues/20104)

---

## Question 4: What about `--install-strategy=linked`?

**Irrelevant to this problem.** The `--install-strategy` flag controls the _layout_ of `node_modules` (hoisting, nesting, symlinking), not whether it gets deleted or whether the lockfile is frozen.

| Strategy            | Layout                                           | Status                                |
| ------------------- | ------------------------------------------------ | ------------------------------------- |
| `hoisted` (default) | Flat with deduplication                          | Stable                                |
| `nested`            | Deep, no deduplication                           | Stable (formerly `--legacy-bundling`) |
| `shallow`           | Only direct deps at top                          | Stable (formerly `--global-style`)    |
| `linked`            | Content-addressable store + symlinks (like pnpm) | **Experimental**                      |

The `linked` strategy is interesting for other reasons (catches phantom dependencies, similar to pnpm's isolation model), but it does not change the `npm ci` deletion behavior or add lockfile-freeze semantics to `npm install`.

**Source:** [npm install v11 docs](https://docs.npmjs.com/cli/v11/commands/npm-install/), [npm/rfcs Discussion #658](https://github.com/npm/rfcs/discussions/658)

---

## Question 5: Do yarn and pnpm handle this better?

**YES, decisively.** Both yarn and pnpm have the exact command npm lacks.

### pnpm install --frozen-lockfile

- Reads exact versions from `pnpm-lock.yaml`
- Fails if lockfile is out of sync with `package.json`
- Never modifies the lockfile
- **Preserves existing `node_modules`** -- only installs/links what changed
- Uses content-addressable store -- packages are hardlinked, not copied
- When lockfile is already satisfied: "Lockfile is up-to-date, resolution step is skipped"
- Default behavior in CI (when `CI` env var is set)

### yarn install --immutable (Yarn Berry 2+)

- Reads exact versions from `yarn.lock`
- Fails if lockfile would need modification
- Never modifies the lockfile
- **Preserves existing `node_modules`** -- if `node_modules/` already matches lockfile, exits in 1-2 seconds
- Supports "zero-installs" (commit cache + `.pnp.cjs` to repo, skip install entirely)
- Default behavior in CI (when `CI` env var is set)

### Comparison table

| Behavior                          | `npm ci`           | `npm install --no-save` | `pnpm install --frozen-lockfile` | `yarn install --immutable` |
| --------------------------------- | ------------------ | ----------------------- | -------------------------------- | -------------------------- |
| Reads lockfile for resolution     | Yes                | Yes                     | Yes                              | Yes                        |
| Fails on lockfile mismatch        | Yes                | **No**                  | Yes                              | Yes                        |
| Never modifies lockfile           | Yes                | Yes\*                   | Yes                              | Yes                        |
| Preserves existing `node_modules` | **No** (deletes)   | Yes                     | Yes                              | Yes                        |
| Incremental (skips unchanged)     | N/A (starts fresh) | Yes                     | Yes                              | Yes                        |
| Default in CI                     | N/A                | No                      | Yes                              | Yes                        |

\*`--no-save` suppresses writes but does not validate sync.

**Source:** [pnpm install docs](https://pnpm.io/cli/install), [yarn install docs](https://yarnpkg.com/cli/install), [npm/rfcs Discussion #388](https://github.com/npm/rfcs/discussions/388)

---

## Question 6: Are there npm RFCs for "fast ci" mode?

**Yes, two relevant proposals exist. Neither has been implemented.**

### RFC #415: `npm install --from-lockfile` (2021, still open)

- Proposed by Daniel Shumway
- Would read exact versions from lockfile (like `npm ci`) while preserving `node_modules` (like `npm install`)
- Would fail if no lockfile exists
- npm team questioned the premise, suggesting `npm install` already respects locked versions
- Deprioritized after lockfile v2 in npm v7 "partially mitigated" the issue
- **Status: Open, no implementation commitment**

### RFC Discussion #704: "Support incremental install from lockfile" (2023, zero replies)

- Filed June 30, 2023
- Explicitly states: "npm doesn't support doing an incremental install without touching the lockfile"
- Calls this a "decisive reason for teams switching to another package manager"
- Notes "I've seen scattered issues and discussions over the years, with no commitment to implement this feature"
- **Status: Open, zero replies from npm team, zero engagement**

### RFC Discussion #388: "Equivalent to yarn install --immutable?" (2021)

- Asked whether npm has any equivalent
- Community conclusion: **no equivalent exists**
- Original poster eventually "switched to pnpm, which has `pnpm install --frozen-lockfile`"
- Identified that `npm ci` doesn't even properly validate lockfile mismatch ([npm/cli#2701](https://github.com/npm/cli/issues/2701))

**Source:** [npm/rfcs#415](https://github.com/npm/rfcs/issues/415), [npm/rfcs Discussion #704](https://github.com/npm/rfcs/discussions/704), [npm/rfcs Discussion #388](https://github.com/npm/rfcs/discussions/388)

---

## Question 7: What does `npm install` do when `node_modules` matches the lockfile?

**It verifies the tree and exits quickly, but still does non-trivial work:**

1. **Loads actual tree** from disk (`node_modules` traversal)
2. **Loads virtual tree** from `package-lock.json`
3. **Builds ideal tree** from `package.json` + lockfile (may check registry metadata unless `--prefer-offline`)
4. **Diffs** actual vs ideal tree
5. If diff is empty: exits with "up to date in Xs" (typically 2-8 seconds)
6. If diff is non-empty: executes only the delta actions

**Integrity verification**: npm verifies SHA-512 integrity hashes during both cache insertion and extraction. Corrupted data is treated as missing and re-fetched. This happens during the `reify:unpack` stage for changed packages, not for packages that are already correct on disk.

**Important nuance**: Even when nothing needs installing, `npm install` may still write to `package-lock.json` to normalize metadata (formatting, `resolved` URLs, `integrity` fields). This is the [known idempotency bug](https://github.com/npm/cli/issues/3652). The `--no-save` flag suppresses this write.

**Source:** [npm v7 Arborist Deep Dive](https://blog.npmjs.org/post/618653678433435649/npm-v7-series-arborist-deep-dive.html), [npm/cli#3652](https://github.com/npm/cli/issues/3652)

---

## Practical Recommendation for This Project

### The best npm-only approach: `npm install --no-save --prefer-offline --no-audit`

This gives you:

- **Incremental install**: Arborist diffs actual vs ideal tree, only changes what's needed
- **Lockfile not modified**: `--no-save` prevents writes to `package-lock.json`
- **Fast metadata resolution**: `--prefer-offline` uses cached package metadata
- **No audit overhead**: `--no-audit` skips the vulnerability check network call

**What it does NOT give you:**

- **Lockfile sync validation**: If `package.json` and `package-lock.json` are out of sync, `npm install --no-save` will silently install whatever the lockfile says (or resolve from `package.json` ranges) without failing. Unlike `npm ci`, it won't error on mismatch.

### Proposed CI strategy: two-step approach

```yaml
# Step 1: Validate lockfile integrity (fail-fast, ~2s)
- name: Validate lockfile
  run: |
    # npm ci --dry-run validates lockfile sync without installing anything
    # If package.json and package-lock.json are out of sync, this fails
    npm ci --dry-run --ignore-scripts

# Step 2: Incremental install from cache (fast when cached)
- name: Install dependencies
  run: npm install --no-save --prefer-offline --no-audit
```

**Why this works:**

- Step 1 catches lockfile drift (the guarantee `npm ci` provides) without deleting `node_modules`
- Step 2 does the actual install incrementally, preserving cached `node_modules`
- Combined: you get frozen-lockfile semantics + incremental install

**Caveat on `npm ci --dry-run`:** The `--dry-run` flag reports what `npm ci` _would_ do without making changes. It validates lockfile sync as part of the process. However, this needs testing to confirm it:

1. Actually fails on lockfile mismatch (the sync check happens before the install phase)
2. Does not delete `node_modules` (dry-run should prevent all side effects)

### Alternative: Switch to pnpm for CI only

If the two-step approach proves unreliable, switching the CI pipeline to `pnpm install --frozen-lockfile` while keeping `npm` for local development is viable:

```yaml
- name: Install pnpm
  run: npm install -g pnpm@latest

- name: Generate pnpm-lock.yaml from package-lock.json
  run: pnpm import # converts npm lockfile to pnpm format

- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

However, this adds complexity (two lockfiles, potential resolution differences) and is not recommended unless npm's approach proves inadequate.

### Expected speedup

Current `npm ci` on Windows ARM64 with warm download cache: **499-568 seconds**

With `npm install --no-save --prefer-offline --no-audit` and a cached `node_modules`:

- **If nothing changed**: 2-8 seconds (tree diff only)
- **If a few packages changed**: 10-60 seconds (proportional to delta)
- **If many packages changed**: Still faster than `npm ci` because unchanged packages are not re-extracted

Conservative estimate: **80-95% reduction** when the dependency delta is small (the common case on CI cache hits).

---

## npm 11 Changelog Review

Reviewed all npm 11.x releases (v11.0.0 through v11.12.0, December 2024 -- March 2026). **No features related to incremental CI installs, frozen lockfile for `npm install`, or `--no-clean` for `npm ci` were added.** The npm team has not signaled any intent to close this gap.

**Source:** [npm/cli releases](https://github.com/npm/cli/releases), [npm/cli CHANGELOG.md](https://github.com/npm/cli/blob/latest/CHANGELOG.md)

---

## Sources

### Official Documentation

- [npm v11 `npm install` docs](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [npm v11 `npm ci` docs](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- [npm v11 `package-lock.json` docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)
- [pnpm install docs](https://pnpm.io/cli/install)
- [yarn install docs](https://yarnpkg.com/cli/install)

### npm Blog / Deep Dives

- [npm v7 Arborist Deep Dive](https://blog.npmjs.org/post/618653678433435649/npm-v7-series-arborist-deep-dive.html)

### GitHub Issues (npm)

- [npm/npm#20104 -- Running npm ci without deleting node_modules](https://github.com/npm/npm/issues/20104)
- [npm/cli#564 -- Do not remove node_modules on npm ci](https://github.com/npm/cli/issues/564)
- [npm/cli#3652 -- Lockfile generation by npm install is not idempotent](https://github.com/npm/cli/issues/3652)
- [npm/cli#8726 -- npm ci fails because npm install produces an out-of-sync lockfile](https://github.com/npm/cli/issues/8726)
- [npm/npm#17761 -- A way to run npm install without modifying the lockfile](https://github.com/npm/npm/issues/17761)
- [npm/npm#19740 -- npm install --no-package-lock does not use package-lock.json](https://github.com/npm/npm/issues/19740)

### npm RFCs

- [npm/rfcs#415 -- npm install --from-lockfile](https://github.com/npm/rfcs/issues/415)
- [npm/rfcs Discussion #704 -- Support incremental install from lockfile](https://github.com/npm/rfcs/discussions/704)
- [npm/rfcs Discussion #388 -- Equivalent to yarn install --immutable?](https://github.com/npm/rfcs/discussions/388)

### npm Releases

- [npm/cli releases](https://github.com/npm/cli/releases)
- [npm/cli CHANGELOG.md](https://github.com/npm/cli/blob/latest/CHANGELOG.md)
