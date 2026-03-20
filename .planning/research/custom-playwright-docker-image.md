# Custom Playwright Docker Image: Trade-off Analysis

**Researched:** 2026-03-20
**Domain:** CI/CD infrastructure for in-browser AI model testing
**Overall confidence:** MEDIUM-HIGH (Docker/CI mechanics well-documented; some size estimates are extrapolated)

---

## Executive Summary

Building a custom Docker image extending `mcr.microsoft.com/playwright` is technically straightforward but introduces maintenance burden that may not be justified given the current project's needs. The analysis below compares three approaches: custom image with browsers only (Option A), custom image with browsers and models baked in (Option B), and the current bare-runner approach (Option C).

**Recommendation:** Stay with Option C (bare runner + disk cleanup + `actions/cache`) for now. The complexity and maintenance overhead of a custom Docker image does not pay off until the project has stabilized its browser/model matrix and CI runs exceed ~50/day where install time savings compound meaningfully. If Option C becomes a bottleneck, graduate to Option A (browsers only) -- never Option B (models baked in).

---

## Option A: Custom Image with Browsers Only

### Dockerfile

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble
RUN npx playwright install chrome-beta msedge-dev
```

### Image Size Estimate

| Layer                               | Compressed (wire) | Uncompressed (disk) | Source                                                                         |
| ----------------------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------ |
| Base `playwright:noble`             | ~800 MB - 1 GB    | ~2 GB               | [Docker Hub](https://hub.docker.com/r/microsoft/playwright), community reports |
| Chrome Beta (~350 MB binary + deps) | ~200 MB           | ~450 MB             | Extrapolated from Playwright browser sizes                                     |
| Edge Dev (~350 MB binary + deps)    | ~200 MB           | ~450 MB             | Extrapolated from Playwright browser sizes                                     |
| **Total**                           | **~1.2-1.4 GB**   | **~2.9 GB**         | Estimate                                                                       |

**Confidence:** MEDIUM -- base image size is well-documented at ~2 GB uncompressed. Branded browser sizes are extrapolated from Chromium (~350 MB on disk) plus additional shared libraries. Actual sizes should be verified by building the image.

### Versioning and Tagging Strategy

Pin the image tag to the Playwright version used in the project:

```
ghcr.io/{owner}/{repo}/playwright-ai:v1.52.0
ghcr.io/{owner}/{repo}/playwright-ai:v1.52.0-20260320  # with build date for disambiguation
```

**When to rebuild:**

- On every Playwright version bump in `package.json` / `package-lock.json`
- Automate via a GitHub Actions workflow triggered by changes to `package-lock.json` on the default branch

```yaml
# .github/workflows/build-playwright-image.yml
name: Build Playwright Image
on:
  push:
    branches: [main]
    paths: ['package-lock.json']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Extract Playwright version
        id: pw
        run: |
          PW_VERSION=$(node -e "console.log(require('./package-lock.json').packages['node_modules/@playwright/test'].version)")
          echo "version=$PW_VERSION" >> "$GITHUB_OUTPUT"
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/playwright-ai:v${{ steps.pw.version }}
            ghcr.io/${{ github.repository }}/playwright-ai:latest
          cache-from: type=registry,ref=ghcr.io/${{ github.repository }}/playwright-ai:buildcache
          cache-to: type=registry,ref=ghcr.io/${{ github.repository }}/playwright-ai:buildcache,mode=max
```

### Where to Host

**GHCR (recommended)** because:

- Native integration with GitHub Actions (no extra credentials needed -- `GITHUB_TOKEN` works)
- Same network as GitHub-hosted runners (fast pulls)
- Currently free for public repos; storage and bandwidth are effectively free as of March 2026
- Image permissions can be scoped independently of repo visibility

**Docker Hub** is an alternative but requires separate credentials and has rate limits (100 pulls/6h for anonymous, 200 for authenticated on free tier).

**Confidence:** HIGH -- [GHCR docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [community discussion on GHCR pricing](https://github.com/orgs/community/discussions/183054).

### How `actions/cache` Works Inside a Container Job

This is the most nuanced aspect of Option A. Key mechanics:

1. **`actions/cache` runs on the host runner**, not inside the container. The runner downloads/uploads cache archives to GitHub's cache service.

2. **The runner mounts the workspace directory** into the container at `/github/workspace` (mapped from the host's `/home/runner/work/{repo}/{repo}`). Steps inside the container see this mounted path.

3. **Cache paths must be volume-mounted** to be visible inside the container. Paths outside the mounted workspace (like `/root/.cache/ms-playwright` inside the container) are NOT automatically cached unless explicitly volume-mounted.

4. **Practical implication for model caching:** To cache AI model files that live inside a container path (e.g., `/opt/ai-profiles/`), you must either:
   - Mount a host directory into the container via `volumes:` and point `actions/cache` at the host path
   - Use a workspace-relative path (e.g., `${{ github.workspace }}/.model-cache`) so it's automatically in the mounted volume

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/owner/repo/playwright-ai:v1.52.0
      options: --ipc=host --user 1001
      volumes:
        - /home/runner/model-cache:/opt/ai-profiles
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: /home/runner/model-cache # Host path, not container path
          key: ai-models-${{ hashFiles('model-manifest.json') }}
      - run: npm ci
      - run: npx playwright test
```

**Confidence:** HIGH -- verified via [GitHub community discussion #23607](https://github.com/orgs/community/discussions/23607) and [GitHub docs on container volumes](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container).

### Runner Disk Space Inside Containers

Yes, the runner's disk space still applies. The container runs on the same VM; it does not get separate storage. The OS disk has ~84 GB total with ~29 GB free by default. After disk cleanup (removing Android SDK, .NET, etc.), you can reclaim ~31 GB more, bringing free space to ~50-60 GB.

The container image itself consumes disk space when pulled. A ~1.2 GB compressed image expands to ~2.9 GB on disk, reducing available space accordingly.

**Confidence:** HIGH -- [runner disk space discussion](https://github.com/actions/runner-images/discussions/9329).

---

## Option B: Custom Image with Browsers + Models Baked In

### Dockerfile

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble
RUN npx playwright install chrome-beta msedge-dev
COPY chrome-beta-profile/ /opt/ai-profiles/chrome-beta/
COPY msedge-dev-profile/ /opt/ai-profiles/msedge-dev/
```

### Image Size Estimate

| Layer                       | Compressed (wire) | Uncompressed (disk) | Notes                       |
| --------------------------- | ----------------- | ------------------- | --------------------------- |
| Base `playwright:noble`     | ~800 MB - 1 GB    | ~2 GB               |                             |
| Chrome Beta + Edge Dev      | ~400 MB           | ~900 MB             |                             |
| Gemini Nano model (~2.4 GB) | ~1.5-2 GB         | ~2.4 GB             | ONNX models compress 30-40% |
| Phi-4-mini model (~3.6 GB)  | ~2.2-2.8 GB       | ~3.6 GB             | FP16 weights                |
| **Total**                   | **~4.9-6.2 GB**   | **~8.9 GB**         | Estimate                    |

### GHCR Storage and Costs

| Aspect                           | Detail                                                                    |
| -------------------------------- | ------------------------------------------------------------------------- |
| Storage (public repos)           | Currently free (no enforced billing as of March 2026)                     |
| Storage (private repos)          | 500 MB free, then $0.25/GB/month if billing enforced                      |
| Bandwidth (GitHub Actions pulls) | Free (pulls from within GitHub Actions are always free)                   |
| Bandwidth (external pulls)       | 1 GB/month free, then $0.50/GB                                            |
| Future billing                   | GitHub confirmed GHCR won't be free forever; 30-day notice before charges |

For a ~5-6 GB compressed image on a public repo, storage is currently free. On a private repo, if billing were enforced, it would cost ~$1.25-1.50/month for storage.

**Confidence:** MEDIUM -- GHCR billing is in flux. The "currently free" status may change. See [community discussion #183054](https://github.com/orgs/community/discussions/183054).

### Pull Time for a 9 GB Image vs Cache Restore for 6 GB

| Approach                                 | Estimated Time     | Notes                                                                                                            |
| ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Docker pull ~5-6 GB compressed from GHCR | **2-5 minutes**    | Depends on GHCR throughput; some users report slow pulls from GHCR (8+ min for 1.5 GB); others report fast pulls |
| `actions/cache` restore ~6 GB            | **45-90 seconds**  | At ~125 MB/s runner bandwidth, 6 GB takes ~48s transfer + decompression overhead                                 |
| Docker pull from Docker Hub              | Potentially faster | One user reported Docker Hub is faster than GHCR for large images                                                |

**Key finding:** For large artifacts, `actions/cache` restore is significantly faster than Docker image pulls. A 6 GB model cache restores in under 2 minutes, while pulling a 9 GB image could take 2-5+ minutes. This strongly favors Option A (small image) + `actions/cache` (for models) over Option B (everything baked in).

**Confidence:** MEDIUM -- pull times vary significantly. GHCR has had [reported IPv6 performance issues](https://github.com/orgs/community/discussions/27080). Cache restore benchmarks are extrapolated from documented ~125 MB/s bandwidth.

### How to Update When Models Change

This is Option B's biggest weakness. When a model version changes:

1. You must rebuild the entire Docker image (~15-30 min build time for 9 GB)
2. You must push ~5-6 GB of layers to GHCR
3. Every CI run must pull the new image (no layer reuse for model layers since model content changed)
4. Model files don't compress well as Docker layers (binary blobs, no dedup benefit)

Compare with `actions/cache`: update a `model-manifest.json` hash, and only the new model files are uploaded/downloaded. The base Docker image stays cached on the runner.

### Docker Layer Caching for Large Images

Two approaches exist in GitHub Actions:

**1. `type=gha` (GitHub Actions cache backend):**

- Uses the same `actions/cache` infrastructure
- Subject to the 10 GB per-repo limit
- A 9 GB image would consume nearly the entire cache quota
- NOT recommended for this use case

**2. `type=registry` (GHCR registry cache):**

- Stores cache layers directly in GHCR
- No size limit (beyond GHCR storage limits)
- Better for large images
- Only re-pushes changed layers

```yaml
- uses: docker/build-push-action@v6
  with:
    push: true
    tags: ghcr.io/${{ github.repository }}/playwright-ai:latest
    cache-from: type=registry,ref=ghcr.io/${{ github.repository }}/playwright-ai:buildcache
    cache-to: type=registry,ref=ghcr.io/${{ github.repository }}/playwright-ai:buildcache,mode=max
```

However, even with registry caching, the model layers are large binary blobs that change atomically -- you get little benefit from layer caching when the model content changes.

**Confidence:** HIGH -- [Docker cache docs for GHA](https://docs.docker.com/build/ci/github-actions/cache/), [Blacksmith layer caching guide](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions).

### Verdict on Option B

**Do not pursue Option B.** The combination of enormous image size, slow pull times, poor layer caching for binary blobs, and complex update process makes it strictly worse than Option A + `actions/cache` for models. The only scenario where Option B makes sense is a self-hosted runner fleet where the image is pre-pulled and persistent -- not ephemeral GitHub-hosted runners.

---

## Option C: Current Approach (Bare Runner + Disk Cleanup + Cache)

### What It Looks Like

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Disk cleanup (~5 seconds, reclaims ~31 GB)
      - name: Free disk space
        run: |
          sudo rm -rf /usr/local/lib/android
          sudo rm -rf /usr/share/dotnet
          sudo rm -rf /opt/ghc

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - run: npm ci

      # Browser install (~30 seconds)
      - run: npx playwright install --with-deps chrome-beta msedge-dev

      # Model cache restore (~30 seconds for cache hit)
      - uses: actions/cache@v4
        with:
          path: /tmp/ai-model-cache
          key: ai-models-${{ hashFiles('model-manifest.json') }}

      - run: npx playwright test
```

### Timing Breakdown

| Step                                            | First Run (cold) | Subsequent Runs (warm cache)   |
| ----------------------------------------------- | ---------------- | ------------------------------ |
| Disk cleanup                                    | ~5s              | ~5s                            |
| `npm ci`                                        | ~15-30s          | ~10s (npm cache hit)           |
| `npx playwright install chrome-beta msedge-dev` | ~30-45s          | ~30-45s (no cache -- see note) |
| Model cache restore                             | N/A (miss)       | ~30-60s                        |
| Model download (if miss)                        | ~60-120s         | N/A                            |
| **Total overhead**                              | **~2-3.5 min**   | **~1.5-2.5 min**               |

**Note on browser install time:** Playwright's [official CI docs](https://playwright.dev/docs/ci) explicitly recommend against caching browser binaries because "the time it takes to restore the cache is comparable to the time it takes to download the binaries." Branded browsers (Chrome Beta, Edge Dev) are ~350-450 MB each and download quickly from Google/Microsoft CDNs.

### Advantages

1. **Zero maintenance** -- no Dockerfile, no image build workflow, no registry to manage
2. **Always fresh browsers** -- `npx playwright install` always gets the latest Chrome Beta and Edge Dev
3. **Simple debugging** -- all steps visible in workflow logs, no opaque Docker layers
4. **No UID/permission issues** -- runs natively on the runner, no container path mapping
5. **Full `actions/cache` compatibility** -- no volume mount confusion
6. **No GHCR dependency** -- one fewer external service

### Disadvantages

1. **Repeated browser installs** -- ~30-45s per run (but Playwright says this is comparable to cache restore)
2. **OS dependency installation** -- `--with-deps` installs system packages each run (~10-15s)
3. **Less reproducible** -- Chrome Beta auto-updates, so different runs may use different browser versions
4. **Disk space management** -- must run cleanup step to ensure enough space

### When to Graduate from Option C

Consider moving to Option A when:

- CI runs exceed ~50/day AND the 30-45s browser install savings compounds meaningfully
- You need exact browser version pinning (the Docker image locks the browser version at build time)
- Multiple repos share the same browser configuration (one image serves many repos)
- OS dependency installation becomes unreliable (rare but possible with apt mirrors)

---

## General Questions Answered

### 1. GHCR Storage Limits

| Plan                 | Storage (free)        | Bandwidth (free/month)    | Notes                                  |
| -------------------- | --------------------- | ------------------------- | -------------------------------------- |
| Public repos         | Unlimited (currently) | Unlimited from GH Actions | Storage and bandwidth "currently free" |
| Private (Free plan)  | 500 MB                | 1 GB                      |                                        |
| Private (Pro)        | 2 GB                  | 10 GB                     |                                        |
| Private (Team)       | 2 GB                  | 10 GB                     |                                        |
| Private (Enterprise) | 50 GB                 | 100 GB                    |                                        |

**Important:** GitHub has stated GHCR pricing will be enforced eventually, with 30 days notice. Pulls from GitHub Actions are guaranteed free regardless. See [GHCR pricing guide](https://expertbeacon.com/github-container-registry-pricing-the-complete-guide-for-2024/).

**Confidence:** MEDIUM -- the "currently free" status is documented but may change. The per-plan limits come from multiple sources and may not be perfectly current.

### 2. `container:` Interaction with `actions/cache`

- `actions/cache` runs on the **host runner**, not inside the container
- Cache archives are downloaded to/uploaded from the host filesystem
- The runner mounts the workspace (`/home/runner/work/{repo}/{repo}`) into the container at `/github/workspace`
- For cache paths **inside the workspace**, path mapping is automatic
- For cache paths **outside the workspace** (e.g., `/root/.cache/`), you must use `volumes:` to bind-mount a host directory and point `actions/cache` at the host path
- The `${{ github.workspace }}` expression resolves to the host path, which is then mapped into the container

**Recommendation:** Always use workspace-relative paths for cached content when using container jobs, or explicitly mount volumes and cache the host-side path.

**Confidence:** HIGH -- verified via [GitHub community discussion #23607](https://github.com/orgs/community/discussions/23607) and [GitHub docs on running jobs in containers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container).

### 3. `--ipc=host` and `--user 1001` in Container Options

Both are supported and commonly used together:

```yaml
container:
  image: mcr.microsoft.com/playwright:v1.52.0-noble
  options: --ipc=host --user 1001
```

**`--ipc=host`:** Required for Chromium-based browsers. Without it, Chromium can run out of shared memory and crash (the `/dev/shm` inside containers defaults to 64 MB). Playwright [officially recommends](https://playwright.dev/docs/docker) this flag.

**`--user 1001`:** Matches the UID of the `runner` user on standard GitHub-hosted Ubuntu runners. This ensures files created by `actions/checkout` and other steps (owned by UID 1001 on the host) are accessible inside the container. As of May 2025, larger runners also use UID 1001 (previously 1000). The Playwright Docker docs explicitly show `--user 1001` in their GitHub Actions example.

**Caveats:**

- Using `--user 1001` means the container does NOT run as root. Some operations (like `apt-get install`) will fail inside `run:` steps. All system-level setup must happen at image build time.
- If you need root access for setup steps, use `--user root` and accept that the Chromium sandbox is disabled (acceptable for trusted test code).

**Confidence:** HIGH -- verified via [Playwright Docker docs](https://playwright.dev/docs/docker), [GitHub runner UID issue #10936](https://github.com/actions/runner-images/issues/10936), [Cypress CI docs](https://docs.cypress.io/app/continuous-integration/github-actions).

### 4. Container Approach and Playwright Browser Launching

The container approach does NOT prevent Playwright from launching Chrome Beta or Edge Dev, provided:

1. The browsers are installed at build time (`RUN npx playwright install chrome-beta msedge-dev`) or at runtime in a step
2. `--ipc=host` is set (prevents shared memory crashes)
3. The Playwright version in the image matches the Playwright version in `package.json`
4. System dependencies are present (the base Playwright image includes them; branded browsers may need additional deps installed via `--with-deps`)

**Known working pattern** (from Playwright's own CI docs):

```yaml
container:
  image: mcr.microsoft.com/playwright:v1.52.0-noble
  options: --user 1001 --ipc=host
steps:
  - uses: actions/checkout@v4
  - run: npm ci
  - run: npx playwright install chrome-beta msedge-dev
  - run: npx playwright test --project=chrome-beta --project=msedge-dev
```

**Confidence:** HIGH -- this is the documented pattern from [Playwright CI docs](https://playwright.dev/docs/ci).

### 5. Docker Image Pull Time by Size

Estimated pull times on GitHub-hosted runners:

| Compressed Size    | Estimated Pull Time | Notes                                         |
| ------------------ | ------------------- | --------------------------------------------- |
| ~500 MB            | 15-30s              | Small images, fast                            |
| ~1 GB              | 30-60s              | Typical Playwright base image                 |
| ~1.5 GB (Option A) | 45-90s              | Browsers added                                |
| ~3 GB              | 2-3 min             |                                               |
| ~5-6 GB (Option B) | 3-8 min             | Highly variable; GHCR can be slow             |
| ~9 GB              | 5-15 min            | Approaching impractical for ephemeral runners |

**Variability warning:** GHCR pull performance is inconsistent. One user reported 1.5 GB taking 8+ minutes from GHCR vs 14 seconds from Docker Hub. This appears related to IPv6 routing issues. Disabling IPv6 improved GHCR performance to Docker Hub levels.

**Confidence:** LOW-MEDIUM -- pull times are highly variable and depend on registry load, network path, and image layer distribution.

### 6. Examples of Custom Playwright Images with Branded Browsers

**JacobLinCool/playwright-docker** ([GitHub](https://github.com/JacobLinCool/playwright-docker)):

- Pre-built images with Google Chrome and Microsoft Edge (stable channels)
- Tags: `jacoblincool/playwright:chrome`, `jacoblincool/playwright:msedge`, `jacoblincool/playwright:all`
- Available for both x64 and ARM64
- Does NOT include beta/dev channels
- Runs Playwright Server, not a bare environment

No public examples were found of teams using custom Playwright images specifically with Chrome Beta or Edge Dev channels in CI. This is a niche use case primarily relevant to testing experimental browser APIs (like the LanguageModel/Prompt API).

**Confidence:** HIGH for JacobLinCool's existence, LOW for broader community examples.

---

## Comparison Matrix

| Criterion                | Option A (Image + Cache)    | Option B (All Baked In)             | Option C (Bare Runner)     |
| ------------------------ | --------------------------- | ----------------------------------- | -------------------------- |
| **Image size**           | ~1.2-1.4 GB compressed      | ~5-6 GB compressed                  | N/A                        |
| **Pull/setup time**      | ~45-90s pull + 30-60s cache | ~3-8 min pull                       | ~30-45s install            |
| **Total overhead**       | ~2-3 min                    | ~3-8 min                            | ~1.5-2.5 min               |
| **Maintenance**          | Dockerfile + build workflow | Dockerfile + build + model pipeline | None                       |
| **Browser freshness**    | Locked to build time        | Locked to build time                | Always latest              |
| **Model update speed**   | Cache key change            | Full image rebuild                  | Cache key change           |
| **`actions/cache` ease** | Requires volume mounts      | Not needed (but less flexible)      | Native, no tricks          |
| **Reproducibility**      | HIGH (pinned versions)      | HIGH (everything pinned)            | LOW (browsers auto-update) |
| **GHCR cost (public)**   | Free (currently)            | Free (currently)                    | N/A                        |
| **Complexity**           | Medium                      | High                                | Low                        |
| **Disk space impact**    | ~2.9 GB used by image       | ~8.9 GB used by image               | Only install artifacts     |

---

## Recommendation

### Stay with Option C. Here's why:

1. **Option C is faster** for the common case. Browser install (~30-45s) is comparable to image pull time for Option A, and much faster than Option B's pull time.

2. **Option C has zero maintenance cost.** No Dockerfile, no build workflow, no GHCR storage concerns, no UID permission issues.

3. **`actions/cache` works natively** on bare runners. No volume mount gymnastics needed. Model files cached at `/tmp/ai-model-cache` are directly accessible.

4. **Browser freshness is a feature, not a bug.** For testing experimental APIs (LanguageModel), you WANT the latest Chrome Beta and Edge Dev. A Docker image locks you to a specific version that quickly goes stale.

5. **The project is in early development.** The browser/model matrix is not stable yet. Introducing Docker image infrastructure now creates maintenance burden before the requirements are settled.

### When to reconsider

Move to Option A if:

- You need exact browser version pinning for reproducible test results across PRs
- CI runs exceed ~50/day and the 30-45s savings per run justifies the Dockerfile/workflow maintenance
- OS dependency installation (`--with-deps`) becomes flaky or slow

Never pursue Option B for this project. The model files are too large, change too infrequently to justify baking into layers, and `actions/cache` handles them better in every dimension.

---

## Sources

- [Playwright Docker docs](https://playwright.dev/docs/docker)
- [Playwright CI docs](https://playwright.dev/docs/ci)
- [GitHub Actions container jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container)
- [GitHub community discussion #23607 -- cache in container workflows](https://github.com/orgs/community/discussions/23607)
- [GitHub runner UID change issue #10936](https://github.com/actions/runner-images/issues/10936)
- [GitHub runner disk space discussion #9329](https://github.com/actions/runner-images/discussions/9329)
- [GHCR pricing discussion #183054](https://github.com/orgs/community/discussions/183054)
- [GitHub Actions cache >10 GB changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)
- [Docker build cache for GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [GHCR vs Docker Hub pull speed discussion #27080](https://github.com/orgs/community/discussions/27080)
- [JacobLinCool/playwright-docker](https://github.com/JacobLinCool/playwright-docker)
- [Ken Muse: Docker layer caching in GitHub Actions](https://www.kenmuse.com/blog/implementing-docker-layer-caching-in-github-actions/)
- [Blacksmith: Docker layer caching guide](https://www.blacksmith.sh/blog/cache-is-king-a-guide-for-docker-layer-caching-in-github-actions)
- [GitHub Actions limits reference](https://docs.github.com/en/actions/reference/limits)
