# Codebase Concerns

**Analysis Date:** 2026-03-24

## Tech Debt

**LanguageModel API Model Availability Polling:**

- Issue: `model-status.component.ts` lines 116-126 implement a blocking polling loop in `ngOnInit()` that polls `checkAvailability()` every 2 seconds until the model changes from "downloading" to another state. This blocks the component initialization and does not yield to Angular's change detection.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`
- Impact: UI becomes unresponsive during model download. Long downloads (multi-GB) make the app appear frozen. If the download takes hours (as documented for cold-start), the component never completes initialization. The polling mechanism is dated; RxJS interval/timer streams would be more idiomatic and testable.
- Fix approach: Replace polling loop with RxJS `interval()` + `takeUntil()` + signal updates. Use computed signals to derive UI state from availability signal. Maintain the 2-second interval for consistency with other polling patterns in the codebase.

**Duplicate Flag and Feature Configuration:**

- Issue: Browser flag configuration is duplicated across two separate files: `scripts/bootstrap-ai-model.mjs` (lines 40-62) and `libs/shared/browser-profiles/src/lib/browser-profiles.ts` (lines 18-37). Both define `PLAYWRIGHT_DISABLE_FEATURES`, `DISABLE_FEATURES_WITHOUT_OPT_HINTS`, and `IGNORE_DEFAULT_ARGS` independently. The bootstrap script maintains its own `browserConfig` structure that mirrors but is not derived from `allProfiles` in the library.
- Files:
  - `scripts/bootstrap-ai-model.mjs` (lines 40-62, 70-95)
  - `libs/shared/browser-profiles/src/lib/browser-profiles.ts` (lines 18-37)
- Impact: Flags become out of sync. If Playwright changes its default `--disable-features` list, each location must be updated independently. Missed updates cause inconsistent flag state between bootstrap and test runs, leading to intermittent "model not ready" failures that are hard to diagnose.
- Fix approach: Import `PLAYWRIGHT_DISABLE_FEATURES`, `DISABLE_FEATURES_WITHOUT_OPT_HINTS`, and `AI_IGNORE_DEFAULT_ARGS` from `@layzeedk/browser-profiles` in the bootstrap script instead of redefining them. The bootstrap script is a plain Node.js ESM module, so the import should work without build tooling.

**Session Creation and Cleanup Pattern:**

- Issue: `language-model.service.ts` creates a new `LanguageModel.session` for every `prompt()` call and immediately destroys it after the response. Per the W3C Prompt API spec, `session.destroy()` signals the browser to unload the model from memory if no other sessions reference it.
- Files: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` (lines 53-65)
- Impact: If a test queues multiple prompts rapidly, closing the first session before the next begins could trigger model unload, resetting the warm-up state. Tests have 600-second timeouts; a cold re-init during a test would cause timeout failure.
- Fix approach: Cache the session in the service (lazy-create once per component lifecycle) and only destroy it on component destroy. Alternatively, document the current pattern as intentional and add a test guard that verifies the model is still warm after back-to-back prompts.

**node_modules Committed Inside .github/actions/paths-filter:**

- Issue: `.github/actions/paths-filter/node_modules/` is committed to the repository. This is a deliberate choice for GitHub Actions composite actions (avoids a build step), but it creates maintenance overhead. The vendored deps (`@actions/core@1.11.1`, `@actions/exec@1.1.1`, `tunnel@0.0.6`, `undici@5.25.4`) will not receive security updates unless manually updated.
- Files: `.github/actions/paths-filter/node_modules/` (full directory tree committed)
- Impact: Security vulnerabilities in vendored packages (e.g., `undici`) will go unnoticed by `npm audit` run on the root `package.json`. `tunnel@0.0.6` is an older package. Dependabot does not scan nested `node_modules` unless explicitly configured for that directory.
- Fix approach: Add a separate Dependabot config for `.github/actions/paths-filter/` in `.github/dependabot.yml`. Alternatively, run `npm audit --prefix .github/actions/paths-filter` in CI. Current risk is low (action runs in GitHub's controlled environment), but tracking is missing.

**CI Workflow Duplication (e2e-edge / test-edge Jobs):**

- Issue: The `e2e-edge` and `test-edge` jobs in `.github/workflows/ci.yml` (lines 227-425) are structurally identical except for the final test command and cache key prefix. Approximately 70% of their YAML is duplicated: `actions/checkout`, `nrwl/nx-set-shas`, `actions/setup-node`, node_modules cache restore/save, `playwright install msedge-dev`, AI model cache restore/bootstrap/save, and ONNX runtime logging.
- Files: `.github/workflows/ci.yml` (lines 227-304 vs lines 306-425)
- Impact: Changes to the Edge bootstrap process (e.g., new `--perf-param` value, updated retry logic) must be applied in two places. A missed sync causes jobs to diverge silently.
- Fix approach: Extract the common Edge setup steps into a reusable composite action at `.github/actions/edge-setup/` or use a reusable workflow (`.github/workflows/edge-setup.yml`). The two jobs diverge only at the final `run` step and the cache key prefix (`msedge-dev-e2e-edge-v1-` vs `msedge-dev-test-edge-v1-`); these can be parameterized.

**bootstrap-ai-model.mjs Does Not Import from Shared Library:**

- Issue: `scripts/bootstrap-ai-model.mjs` reimplements its own `browserConfig` object (lines 70-95) with browser flags, args, and internal page URLs. This is the same information held in `libs/shared/browser-profiles/src/lib/browser-profiles.ts`'s `allProfiles` array, but the script does not import from the library.
- Files: `scripts/bootstrap-ai-model.mjs` (lines 70-95), `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Impact: Adding a new browser requires updating both the library and the script. The `edge-llm-on-device-model-performance-param@${values['perf-param']}` flag interpolation exists only in the script, not in the library's `allProfiles`.
- Fix approach: Make `@layzeedk/browser-profiles` importable from the script (it already uses `workspaceRoot` from `@nx/devkit`, so Node.js ESM resolution works). Expose a `getBootstrapConfig(browserChannel)` function from the library that returns flags, args, and `internalPage`. The `--perf-param` CLI override can remain script-specific.

## Known Bugs

**Chrome ProcessSingleton Profile Lock (Windows):**

- Symptoms: Second `launchPersistentContext()` call fails with "Browser window not found" after first context closes on Windows. `chrome_crashpad_handler` holds a `FILE_FLAG_DELETE_ON_CLOSE` handle on the profile lockfile, preventing immediate reuse.
- Files:
  - `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 45-68)
  - Documented in `AGENTS.md` Troubleshooting section
- Trigger: Close and relaunch persistent context on Windows. Per-test browser fixtures exhibit this most clearly.
- Workaround: 5-attempt retry loop with 2-second delay between attempts. Implemented in `fixtures.ts`. Playwright issues #2828, #6123, #6310, #12830 track the underlying bug.

**Transient Edge Model Loading Race:**

- Symptoms: Edge Dev reports "Not Ready For Unknown Reason" on `edge://on-device-internals` during model loading, then resolves to "Ready" after a page refresh or brief wait (~1-2 seconds).
- Files:
  - `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 78-103)
  - `apps/in-browser-ai-coding-agent/browser-warmup.ts`
- Trigger: Immediately after browser launch, before model finishes registering with Edge's LLM service.
- Workaround: Fixtures ignore transient errors and wait for model availability to stabilize. Warm-up catches errors gracefully.

**@1 vs @2 Flag Incompatibility (Chrome 147):**

- Symptoms: Using `optimization-guide-on-device-model@2` (BypassPerfRequirement) on Chrome 147 with no GPU produces `UnknownError: Other generic failures occurred`. Model downloads successfully but inference fails.
- Files: `libs/shared/browser-profiles/src/lib/browser-profiles.ts` (line 69, correctly set to `@1`)
- Trigger: Machines with 0 GPU VRAM (e.g., `ubuntu-latest` CI runner).
- Workaround: Use `@1`. Chrome 147+ auto-detects no GPU and correctly routes to CPU. Current codebase correctly uses `@1`; this is a documented historical issue.

**E2E Tests Hardcode localhost:4200:**

- Symptoms: `apps/in-browser-ai-coding-agent-e2e/src/prompt.spec.ts` line 7 hardcodes `http://localhost:4200/` rather than using the `baseURL` from the Playwright config. If the dev server starts on a different port (via `E2E_PORT` env var), the test navigates to the wrong URL.
- Files: `apps/in-browser-ai-coding-agent-e2e/src/prompt.spec.ts` (line 7)
- Trigger: Running E2E tests with `E2E_PORT` set to a non-4200 value.
- Workaround: Playwright's `webServer` uses port 4200 by default. The issue is dormant unless `E2E_PORT` is overridden. Fix: use `page.goto('/')` (relative) or inject `baseURL` from worker info as done in `fixtures.ts` line 75.

## Security Considerations

**DomSanitizer Bypass in Model Status Component:**

- Risk: `model-status.component.ts` uses `sanitizer.bypassSecurityTrustHtml()` (line 110) to render model responses as HTML. User-controlled prompt text influences model output; if model responses reflect user input verbatim, this is a reflected XSS surface.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (lines 103-113)
- Current mitigation: On-device models generate responses locally; no external data source. The risk is theoretical in the current scope.
- Recommendations: If the app is extended with cloud APIs or shared prompts, switch to a sanitization library (DOMPurify). Add a code comment explaining the trust boundary and the conditions under which the bypass is safe.

**Vendored Action Dependencies Not Audited:**

- Risk: `.github/actions/paths-filter/node_modules/` contains `undici@5.x` and `tunnel@0.0.6`. `undici` has had CVEs in the 5.x series. These are not scanned by `npm audit` run at the workspace root.
- Files: `.github/actions/paths-filter/node_modules/`
- Current mitigation: The action runs in a sandboxed GitHub Actions runner with read-only file access to the repository. The `undici` version is transitive via `@actions/http-client`.
- Recommendations: Add a `.github/dependabot.yml` file with a separate `npm` entry pointing to `.github/actions/paths-filter`. Alternatively, run `npm audit --prefix .github/actions/paths-filter` as a CI step in the `format` job.

**CI Workflow Permissions Are Broad:**

- Risk: `.github/workflows/ci.yml` line 16 grants `packages: write` at the workflow level. This permission is only needed by the `build-chrome-image` job (pushing to GHCR). All other jobs (format, lint, test) inherit it unnecessarily.
- Files: `.github/workflows/ci.yml` (lines 13-17)
- Current mitigation: GitHub Actions token is scoped to the repository; `packages: write` cannot be used outside it.
- Recommendations: Move `packages: write` to the `build-chrome-image` job scope using `permissions:` at the job level and remove it from the top-level permissions block. This follows the principle of least privilege.

**No CODEOWNERS or Branch Protection Review:**

- Risk: No `.github/CODEOWNERS` file exists. Force-push to main could bypass code review.
- Files: `.github/` (missing CODEOWNERS)
- Current mitigation: Single-developer repository; code review is informal.
- Recommendations: Add branch protection rules for `main` (require pull request, status checks, no force push). Add a `CODEOWNERS` file if the project gains contributors.

**actions/checkout@v6 Uses Unpinned Major Version:**

- Risk: All `uses: actions/checkout@v6` references in `.github/workflows/ci.yml` are pinned to a major version tag, not a commit SHA. A compromised or accidentally updated major-version tag could alter CI behavior without notice.
- Files: `.github/workflows/ci.yml` (lines 28, 60, 79, 100, 163, 189, 235, 311)
- Current mitigation: GitHub's first-party actions are maintained by GitHub; the risk of tag manipulation is low compared to third-party actions.
- Recommendations: For higher-security projects, pin to commit SHAs (e.g., `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` for v4). Not required for this project's risk profile, but worth noting.

## Performance Bottlenecks

**Cold-Start Inference on ARM64 CI:**

- Problem: Edge Dev's Phi-4 Mini has a measured cold-start of 23-110 minutes on `windows-11-arm` CI when the profile cache misses. The warm-up in CI fixtures (lines 70-103 of `fixtures.ts`) can approach the 3-hour step timeout.
- Files:
  - `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (line 114, 3-hour timeout)
  - `.github/workflows/ci.yml` (`test-edge` job, `timeout-minutes: 180`)
- Cause: ONNX Runtime on ARM64 must compile inference kernels at first run. No GPU acceleration available. Subsequent runs benefit from cached `adapter_cache.bin` + `encoder_cache.bin`.
- Improvement path: Profile caching via GitHub Actions `actions/cache` is already implemented. On cache miss, the cost is unavoidable without pre-warming (separate nightly job + artifact distribution). Current setup is correctly designed.

**CI npm install on ARM64 (Native Compilation):**

- Problem: `windows-11-arm` jobs use `npm install --no-save --prefer-offline` (not `npm ci`) on cache miss. Native module compilation (e.g., `@swc/core`) takes significantly longer on ARM64 than x86_64 due to QEMU emulation absence but slower native compilation.
- Files: `.github/workflows/ci.yml` (lines 258-259, 337-338)
- Cause: Node.js `node_modules` cache is used to avoid repeated compilation. On cache miss (new `package-lock.json`), full compilation runs.
- Improvement path: Current node_modules caching is already implemented. No structural improvement available without switching to a different native module (e.g., a pre-built binary).

**Profile Directory Caching Complexity:**

- Problem: Both Chrome (`OptGuideOnDeviceModel` directory) and Edge (`EdgeLLMOnDeviceModel` directory) cache profile directories in CI. Profile size is large (~500 MB - 2 GB per browser). GitHub Actions cache limit is 10 GB. Current usage is approximately 1.6-4.9 GB (node_modules + Chrome + Edge profiles).
- Files: `.github/workflows/ci.yml` (cache save/restore steps for `msedge-dev-e2e-edge-v1-*` and `msedge-dev-test-edge-v1-*`)
- Improvement path: Monitor cache usage growth. If approaching 10 GB limit, split cache keys by runner or consider S3/GCS for large AI model profiles.

## Fragile Areas

**CI Image Tag Relies on sha256sum of Dockerfile:**

- Files: `.github/workflows/ci.yml` (lines 104-111)
- Why fragile: The Docker image tag is computed as `v${PLAYWRIGHT_VERSION}-node${NODE_VERSION}-${DF_HASH}` where `DF_HASH` is the first 8 characters of the SHA256 hash of the Dockerfile. If the Dockerfile contains platform-specific line endings or trailing whitespace differences between developer machines and CI, the hash changes unexpectedly, forcing unnecessary image rebuilds.
- Safe modification: Always edit the Dockerfile in a Unix line-ending context. Do not convert line endings to CRLF. The `.gitattributes` file (if it exists) should mark `*.Dockerfile` as `text eol=lf`.
- Test coverage: No test verifies the image tag generation logic. If the hash logic changes, the skip-rebuild optimization silently breaks (it rebuilds every run).

**paths-filter Action Uses YAML-Like Parser, Not Real YAML:**

- Files: `.github/actions/paths-filter/index.mjs` (lines 12-43)
- Why fragile: The `parseFilters()` function implements a custom "YAML-like" parser (not a real YAML parser). It handles only the specific format used in `ci.yml` filters. Complex patterns with special characters, inline comments, or multi-line patterns would be silently ignored or misinterpreted. For example, a filter pattern with a colon in the path (`src/foo:bar`) would be misidentified as a filter name.
- Safe modification: Only add filter patterns in the simple `- 'pattern'` format currently used. Do not add patterns containing colons, inline comments, or complex globs outside single quotes. If the filter format needs to grow, replace `parseFilters()` with a real YAML library (e.g., `js-yaml`).

**Vitest Persistent Context with Multiple Browser Instances:**

- Files:
  - `apps/in-browser-ai-coding-agent/vitest.config.mts`
  - `apps/in-browser-ai-coding-agent/vitest.shared.mts`
- Why fragile: The `vitest.workspace.ts` configuration loads both `vitest.config.mts` (all browsers) and per-browser overrides. Changing `vitest.shared.mts` affects all three targets. The `browser.instances` setting controls how many concurrent browser processes run; misconfiguring this can cause profile locks or resource exhaustion.
- Safe modification: Always make changes to `vitest.shared.mts` (the factory function), not individual per-browser configs. Test both single-browser and multi-browser targets.

**Global Setup File Dependencies (Import Chain):**

- Files:
  - `apps/in-browser-ai-coding-agent/global-setup.ts`
  - `apps/in-browser-ai-coding-agent/global-setup.shared.ts`
  - `apps/in-browser-ai-coding-agent/global-setup.chrome.ts`
  - `apps/in-browser-ai-coding-agent/global-setup.edge.ts`
- Why fragile: Global setup files must use relative imports with `eslint-disable-next-line @nx/enforce-module-boundaries` because Nx plugins parse these files before Vite resolves tsconfig paths. A developer unfamiliar with this constraint may add a tsconfig alias import and break setup silently.
- Safe modification: Keep imports in global-setup files minimal. Complex logic belongs in `libs/shared/browser-profiles`. Test locally with `npm test` after any import change.

**Browser Profile Directory Synchronization:**

- Files: `libs/shared/browser-profiles/src/lib/browser-profiles.ts` (`allProfiles` definitions)
- Why fragile: `allProfiles` is the contract between Playwright tests, Vitest configuration, and bootstrap scripts. Adding a new browser requires updating: the `allProfiles` array, `vitest.config.*.mts` files, global setup files, CI workflow, and the bootstrap script's `browserConfig`. Missing any step causes silent failures.
- Safe modification: Document the full checklist for adding a new browser in `AGENTS.md`. Add a validation check that all `allProfiles` entries have corresponding Vitest instance configs.

**Model Availability Enum Inconsistency:**

- Files:
  - `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` (lines 3-7)
  - `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (lines 15-36)
- Why fragile: `ModelAvailability` is a string union type. TypeScript does not enforce exhaustiveness on switch statements over string unions. If a fifth state is added, the switch falls through silently.
- Safe modification: Convert to a TypeScript `const enum` or use a discriminated union with an exhaustiveness check helper (`assertNever()`).

**E2E Tests Share a Warm-up Page with Test Pages:**

- Files: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (lines 73, 120-123)
- Why fragile: The fixture reuses `context.pages()[0]` as both the warm-up page and the test page (`persistentPage`). After warm-up, the page has navigated to the app root. If a test navigates away and the second test expects `pages()[0]` to be at the app root, the state is inherited from the prior test.
- Safe modification: Always call `page.goto(baseURL)` at the start of each test, or create a fresh page per test with `context.newPage()`. Do not rely on initial navigation state from the warm-up.

## CI/CD Concerns

**Single Monolithic Workflow File:**

- Files: `.github/workflows/ci.yml` (426 lines, 7 jobs)
- Issue: The entire CI pipeline is one file with 7 jobs. The `e2e-edge` and `test-edge` jobs are nearly identical (70% duplicated YAML). New jobs must be added to this single file, increasing merge conflict risk and reducing readability.
- Impact: Maintenance burden grows linearly with new test targets. Reviewers must read 400+ lines to understand the full pipeline.
- Fix approach: Extract `e2e-edge` and `test-edge` common steps into a composite action (`.github/actions/edge-test-setup/`). Consider splitting the workflow into `build.yml` and `test.yml` for clearer ownership.

**No Scheduled Workflow for Profile Pre-warming:**

- Files: `.github/workflows/ci.yml` (no `schedule:` trigger)
- Issue: Profile caches are only warmed during PR and push runs. On cache miss (after dependency update or cache eviction), the next CI run pays the full cold-start penalty (23-110 min). There is no nightly or weekly job that pre-warms profiles.
- Impact: Dependency updates reliably invalidate the model cache (cache key includes `package-lock.json` hash), causing CI slowdowns on every dependency bump.
- Fix approach: Add a `schedule:` cron trigger (e.g., weekly on Sunday) that runs only the bootstrap step and saves the profile. This decouples cache warming from PR runs.

**Docker Image Build Skips on Cache Hit Using `latest` Tag:**

- Files: `.github/workflows/ci.yml` (lines 123-155)
- Issue: When the versioned image tag already exists, the `latest` tag is NOT updated (build is skipped entirely). If the `build-chrome-image` job ran previously and built `latest` at an older version, `e2e-chrome` and `test-chrome` jobs use `image:latest` (line 161, 186) which could point to an outdated image after a partial rebuild.
- Impact: If someone manually deletes the versioned tag but not the `latest` tag, tests run on mismatched image versions.
- Fix approach: Use the versioned tag in the `container.image` reference instead of `latest`. Pass the computed tag as a job output from `build-chrome-image` and reference it in downstream jobs. The output already exists (`steps.meta.outputs.image` provides the repo, but the tag is not threaded through).

**ARM64 CI Dependency on `windows-11-arm` Runner Availability:**

- Files: `.github/workflows/ci.yml` (lines 230, 309 -- `runs-on: windows-11-arm`)
- Issue: `windows-11-arm` is a GitHub-hosted runner available on specific GitHub plans. If runner capacity is exhausted or the runner type is deprecated/renamed, both `e2e-edge` and `test-edge` jobs fail immediately without a fallback.
- Impact: CI becomes fully blocked on Edge tests during runner capacity issues.
- Fix approach: Add a `continue-on-error: true` flag or a fallback self-hosted runner. Document the runner dependency in `AGENTS.md`.

**No CI Notification on Model Cache Eviction:**

- Files: `.github/workflows/ci.yml` (cache restore steps)
- Issue: When the GitHub Actions cache for AI model profiles is evicted (due to 10 GB quota, 7-day expiry, or LRU eviction), CI silently runs the full bootstrap. There is no alert or notification that a cache miss occurred and why.
- Impact: Developers may not realize a slow CI run was caused by cache eviction rather than a genuine problem. Hard to distinguish "cache miss cold-start" from "model broke".
- Fix approach: Add a step that checks `steps.model-cache.outputs.cache-hit` and writes a warning to the job summary (`GITHUB_STEP_SUMMARY`) when the cache is missed. Include the cache key in the warning for debugging.

## Claude Code Config Concerns (.claude/)

**settings.json Enables Third-Party Nx Plugin Marketplace:**

- Files: `.claude/settings.json`
- Issue: `settings.json` enables the `nx@nx-claude-plugins` plugin from an `extraKnownMarketplaces` source pointing to `github:nrwl/nx-ai-agents-config`. This installs skills and tools from a third-party GitHub repository. If the `nrwl/nx-ai-agents-config` repository is compromised or changes without notice, Claude Code would load malicious or incorrect tooling.
- Impact: Claude Code agents running in this repo context load external skills at session start. Malicious skill instructions could cause unintended file writes or command executions.
- Recommendations: Pin the skill source to a specific commit SHA or tag rather than a branch. Periodically audit `.claude/skills/` content against the upstream source.

**Skill References Mention Template-Driven Forms as Legitimate Option:**

- Files: `.claude/skills/angular-developer/SKILL.md` (lines 78-81), `.claude/skills/angular-developer/references/template-driven-forms.md`
- Issue: The `AGENTS.md` code style section explicitly states "Use Reactive forms, not Template-driven forms." However, the `angular-developer` SKILL.md (line 78-81) presents template-driven forms as a valid choice for "older applications or when working with existing forms," and includes a reference file for template-driven forms. A Claude Code instance reading the skill without the project's `AGENTS.md` context could suggest template-driven forms.
- Impact: Instruction drift between project style rules and skill guidance. Agents using this skill without project context may generate non-compliant form code.
- Recommendations: Add an explicit note in `SKILL.md` section "Forms" stating: "This project uses Reactive forms per `AGENTS.md`. Template-driven form guidance is for general Angular projects only."

**Skill File References `ng build` Instead of `nx run`:**

- Files: `.claude/skills/angular-developer/SKILL.md` (line 16)
- Issue: The skill instructs: "run `ng build` to ensure there are no build errors." In this Nx workspace, the correct command is `npm exec nx -- build in-browser-ai-coding-agent` or `npm run build`. Running bare `ng build` may not respect Nx project configuration, caching, or affected detection.
- Impact: An agent following this skill instruction would run a command that either fails (no global `ng`) or bypasses Nx caching, making the build slower and ignoring workspace configuration.
- Recommendations: Add a project-level override note in the skill or in `AGENTS.md` clarifying that all build/lint/test commands must go through `npm exec nx`.

**Skill Recommends Signal Forms for New Projects (Not Available in This Angular Version):**

- Files: `.claude/skills/angular-developer/SKILL.md` (line 23)
- Issue: The skill states "Use Signals Forms for form management in new projects (available in Angular v21 and newer)." This project is on Angular 21 (~21.2.0). Signal forms may be in developer preview / experimental status in 21.x. Recommending them for production code in an Angular 21.2 project without flagging the stability level is risky.
- Impact: An agent might generate signal forms code that works in development but has API stability caveats or is not recommended for production in Angular 21.2.
- Recommendations: Verify the stability tier of signal forms in Angular 21.2. If experimental, add a note in the skill and in `AGENTS.md` code style section indicating whether signal forms are approved for use in this specific project.

**No `.claude/commands/` Directory for Project-Specific Commands:**

- Files: `.claude/` (directory listing)
- Issue: The `.claude/` directory contains only `settings.json` and `skills/`. There are no project-specific slash commands (`.claude/commands/`). Common workflows like "run the full CI pipeline locally" or "bootstrap the Edge model" must be described in `AGENTS.md` prose rather than as invocable commands.
- Impact: Agents must parse prose instructions for common multi-step workflows rather than calling a structured command. This increases the risk of command errors (e.g., wrong flags or missing steps).
- Recommendations: Add `.claude/commands/` with at minimum: `bootstrap-edge.md` (wraps the bootstrap script invocation) and `ci.md` (runs the full local CI pipeline). Low priority for a single-developer repo.

**Skill Source is Google-Authored but Maintained in Third-Party Repo:**

- Files: `.claude/skills/angular-developer/SKILL.md` (line 3: `license: MIT`, line 5: `author: Copyright 2026 Google LLC`)
- Issue: The `angular-developer` skill claims copyright by Google LLC but is distributed via `nrwl/nx-ai-agents-config` (an Nx/Nrwl repository). The canonical source and update mechanism is not clear. If Google updates the Angular developer skill via a separate channel, the version in `nrwl/nx-ai-agents-config` may lag or diverge.
- Impact: Agents may receive outdated Angular best practices, especially for rapidly evolving features (signals, resource API, signal forms).
- Recommendations: Periodically compare the installed skill content against upstream Angular documentation. After major Angular version bumps, manually review skill reference files for accuracy.

## Security Considerations

**DomSanitizer Bypass in Model Status Component:**

- Risk: `model-status.component.ts` uses `sanitizer.bypassSecurityTrustHtml()` (line 110) to render model responses as HTML via `marked.parse()`. If user-controlled prompt text is reflected verbatim in model output, this creates a potential XSS surface.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (lines 103-113)
- Current mitigation: On-device inference generates output locally; no external data traverses the trust boundary.
- Recommendations: Add DOMPurify as a sanitization layer before `bypassSecurityTrustHtml()` if the feature is extended to cloud APIs or shared prompts.

**Global LanguageModel API Availability Check:**

- Risk: `language-model.service.ts` relies on `typeof LanguageModel !== 'undefined'` at runtime. No TypeScript type guard pattern is used. The `@types/dom-chromium-ai` package provides the type declarations.
- Files: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` (lines 11-13)
- Current mitigation: Service throws clear errors when API is unavailable. UI handles errors gracefully.
- Recommendations: No action required. The check is appropriate for an experimental browser API.

**No Rate Limiting on Inference:**

- Risk: The UI allows rapid prompt submissions. No debounce or rate limiting. The submit button is disabled while `prompting()` is true, which provides basic backpressure.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (lines 146-166)
- Current mitigation: Single-threaded JavaScript serializes requests. Button is disabled during inference.
- Recommendations: Acceptable for the current scope. Add explicit rate limiting if the feature becomes public-facing.

## Scaling Limits

**Single Worker E2E Testing:**

- Current state: E2E tests run with `workers: 1` in `playwright.config.ts` to avoid ProcessSingleton lock contention.
- Limit: As the test suite grows, serial execution becomes a bottleneck. Ten tests at 60 seconds each = 10 minutes minimum.
- Scaling path: Increase `workers` setting and provide each worker a separate profile directory. Accept additional cold-start overhead. Monitor for ProcessSingleton errors.

**Profile Cache Size Growth:**

- Current state: ~500 MB - 2 GB per browser model cache.
- Limit: GitHub Actions cache quota is 10 GB per repository. Current usage is approximately 1.6-4.9 GB (node_modules + Chrome + Edge profiles).
- Scaling path: Implement per-runner cache buckets. Use `restore-keys` patterns. Consider external artifact storage if a third browser is added.

**RAM and Disk on ARM64 CI Runner:**

- Current state: `windows-11-arm` runner has approximately 16 GB RAM and 50-60 GB disk.
- Limit: A single Phi-4 Mini inference session uses approximately 9-12 GB RAM. Two concurrent sessions would exceed total RAM.
- Scaling path: Keep separate CI jobs for E2E vs unit tests (currently done). Do not run multiple model-using jobs concurrently on the same runner.

## Dependencies at Risk

**LanguageModel API (W3C Prompt API) - Experimental Standard:**

- Risk: The LanguageModel API is an unfinished W3C standard implemented only in Chrome Beta and Edge Dev. Future versions could change the API surface (method names, event types, error codes).
- Impact: Browser auto-updates could break inference without a code change. Tests fail on new browser versions before the change is understood.
- Migration plan: Monitor Chrome AI dev preview discussion group. Pin browser versions in CI if stability is critical. Maintain a cloud API fallback option as a safety net.

**Playwright - Persistent Context API:**

- Risk: Playwright may change `launchPersistentContext` API in future major versions.
- Impact: All E2E and Vitest tests depend on this feature. A major version bump could require rewriting the fixture architecture.
- Migration plan: Monitor Playwright release notes. Test major version upgrades in a feature branch.

**@vitest/browser-playwright - Underdocumented Configuration:**

- Risk: Relatively new runner with limited documentation. Configuration options are less stable than Vitest core.
- Impact: Updating Vitest or Playwright could break persistent context setup or browser instance configuration.
- Migration plan: Test Vitest major version upgrades in CI before merging. Keep comments in `vitest.config.mts` explaining each non-obvious setting.

**marked@17 - Markdown Rendering:**

- Risk: `marked` is used for rendering LLM responses as HTML (combined with `bypassSecurityTrustHtml`). The `marked` package has had XSS-related issues in older major versions. Version 17 is current and uses async: false in the call site.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` (line 111)
- Impact: A `marked` vulnerability could enable HTML injection in the response display.
- Migration plan: Keep `marked` updated. Consider adding DOMPurify as a defense-in-depth measure regardless of the trust model.

## Missing Critical Features

**Error Recovery and Retry Logic for Model Inference:**

- Problem: If a prompt fails (transient ONNX Runtime error, memory pressure, browser crash), there is no automatic retry. The test fails immediately.
- Impact: Transient errors on CI cause flaky test failures that pass on re-run. Wastes CI time and obscures real failures.
- Blocks: Reliable CI/CD pipeline.
- Recommendation: Add exponential backoff retry logic to `language-model.service.ts` `prompt()` method. Retry up to 3 times with 5-30 second delays.

**Graceful Degradation Without On-Device Model:**

- Problem: The app requires the LanguageModel API to function meaningfully. Users without Chrome Beta or Edge Dev see only "Model is not available."
- Impact: Contributors without specialized browsers cannot evaluate app behavior.
- Recommendation: Integrate a cloud API fallback as a developer-mode option. Keep the on-device path as default.

**Automated Profile Warm-up and Pre-caching:**

- Problem: CI pays the full cold-start penalty on every cache miss (23-110 min). Cache invalidation is triggered by any `package-lock.json` change.
- Impact: Dependency updates cause unacceptable CI slowdowns.
- Recommendation: Implement a separate scheduled "profile warmer" CI job that runs on a `schedule:` trigger, warms profiles, and saves them to the cache. PR runs then always find a warm cache. This decouples dependency updates from model cold-start.

## Test Coverage Gaps

**LanguageModel API Error Handling:**

- What's not tested: Explicit error scenarios (model download failures, session creation errors, inference timeouts).
- Files: `apps/in-browser-ai-coding-agent/src/app/language-model.service.spec.ts`
- Risk: If error handling in `prompt()` or `downloadModel()` has a bug, tests won't catch it.
- Priority: Medium. Error handling is straightforward (re-throw exceptions), but edge cases are untested.
- Recommendation: Add tests that mock `LanguageModel.create()` to throw, then verify correct propagation.

**Model Availability Polling Logic:**

- What's not tested: The polling loop in `model-status.component.ts` `ngOnInit()` lines 122-126. If status never changes from "downloading", the loop runs indefinitely.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.spec.ts`
- Risk: A hanging component in production could block Angular's change detection.
- Priority: High if polling is kept; Medium if replaced with RxJS observables.
- Recommendation: Add a test mock that simulates model transitioning from "downloading" to "available" and verify the polling stops. Use `vi.useFakeTimers()` for deterministic timing.

**UI Error State Handling:**

- What's not tested: Error paths in `onDownload()` and `onSubmit()` methods.
- Files: `apps/in-browser-ai-coding-agent/src/app/model-status.component.spec.ts`
- Risk: An error could silently occur without being displayed to the user.
- Priority: Medium.
- Recommendation: Mock the service to throw errors and verify that the error signal is set and displayed correctly.

**E2E Fixture Retry Logic:**

- What's not tested: The 5-attempt retry loop in `fixtures.ts` lines 50-68. Linux CI never hits the ProcessSingleton path.
- Files: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`
- Risk: On Windows, if the retry logic has a bug, tests could silently hang.
- Priority: Low. CI logs provide evidence that retries work.

---

_Concerns audit: 2026-03-24_
