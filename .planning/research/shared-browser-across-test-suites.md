# Research: Sharing a Browser Process Across Test Suites

**Domain:** Test infrastructure -- sharing warm browser between Playwright E2E and Vitest browser-mode unit tests
**Researched:** 2026-03-22
**Overall confidence:** MEDIUM
**Mode:** Feasibility

## Executive Summary

This project runs two test suites (Playwright E2E, Vitest browser mode) against branded browsers (Chrome Beta, Edge Dev) with persistent profiles containing multi-GB AI models. Each suite independently launches a browser, performs a 3-phase warm-up (model registration, status polling, first inference), and only then runs tests. The warm-up takes 12+ minutes on ARM64 and ~20s on x86_64 for Chrome.

The core question: can both suites share a single warm browser process, eliminating duplicate warm-up?

**Verdict: NO off-the-shelf solution exists.** But five architectural approaches are viable, ordered by practicality:

1. **Consolidate under one runner** (eliminate the problem) -- HIGH confidence
2. **Vitest `persistentContext` path sharing** (leverage warm profile) -- HIGH confidence
3. **CDP bridge with pre-launched browser** (true process sharing) -- MEDIUM confidence
4. **Custom Nx executor orchestrating both suites** (single-step execution) -- MEDIUM confidence
5. **Custom Vitest browser provider** (connect to existing browser) -- LOW confidence

## Question 1: Can Playwright Run Vitest-Style Unit Tests via page.evaluate()?

**Answer: Yes, technically. No, practically.**

Playwright's `page.evaluate()` can execute arbitrary JavaScript in the browser, including Angular service methods. You could theoretically:

```typescript
// Inside a Playwright E2E test
const result = await page.evaluate(async () => {
  // Access Angular's injector from the running app
  const injector = (window as any).ng?.getInjector?.();
  const service = injector?.get(LanguageModelService);
  return service?.isSupported();
});
```

**Problems:**

- No test framework inside the browser -- no assertions, no test lifecycle, no reporting
- Angular's dependency injection is not easily accessible from `page.evaluate()` in production builds (tree-shaking removes debug APIs)
- No Vitest features: no mocking, no module isolation, no coverage, no test filtering
- Test code cannot import TypeScript modules -- everything must be serialized into `page.evaluate()` strings
- Playwright's component testing (`@playwright/experimental-ct-*`) exists but is experimental and only supports React, Svelte, and Vue -- not Angular

**Community patterns:** No established pattern for running unit tests via `page.evaluate()`. Playwright component testing is the closest analog, but it does not support Angular. The recommended approach (Epic Web Dev, Playwright docs) is to use Vitest browser mode for component/service tests and Playwright for E2E.

**Confidence:** HIGH -- this is well-documented territory. The approach is technically possible but architecturally wrong.

**Sources:**

- [Vitest Browser Mode vs Playwright | Epic Web Dev](https://www.epicweb.dev/vitest-browser-mode-vs-playwright)
- [Playwright Component Testing (experimental)](https://playwright.dev/docs/test-components)

## Question 2: Can Vitest Browser Mode Connect to an Existing Playwright Persistent Context?

**Answer: Not directly. The launch paths are mutually exclusive.**

Analyzed the actual `@vitest/browser-playwright` v4.1.0 source code (`dist/index.js`, 1221 lines). The `PlaywrightBrowserProvider.openBrowser()` method has three mutually exclusive paths:

```
if (connectOptions) {
  // Path A: playwright[browserName].connect(wsEndpoint, ...)
  // Uses browser.newContext() for each test file -- NOT persistent
} else if (persistentContext) {
  // Path B: playwright[browserName].launchPersistentContext(userDataDir, ...)
  // Launches a NEW browser with the profile
} else {
  // Path C: playwright[browserName].launch(launchOptions)
  // Standard launch, newContext() per test file
}
```

**Key finding: `connectOptions` and `persistentContext` cannot be used together.** When `connectOptions` is set, it returns early before checking `persistentContext`. The connected browser always creates fresh contexts via `browser.newContext()`.

**What `connectOptions.wsEndpoint` actually does:**

- Connects to a Playwright BrowserServer started via `playwright run-server` CLI
- Passes `launchOptions` to the remote server via `x-playwright-launch-options` HTTP header
- The remote server calls `browserType.launch()` (not `launchPersistentContext()`)
- No way to tell the remote server to use a persistent context

**What `persistentContext` actually does:**

- Calls `playwright[browserName].launchPersistentContext(userDataDir, options)` locally
- Stores the returned context as `this.persistentContext`
- Reuses it for all test files instead of calling `browser.newContext()`
- Launches a NEW browser process -- does not connect to an existing one

**The gap:** There is no `connectToPersistentContext` option. Playwright's own `launchServer` does not support persistent contexts either ([GitHub Issue #1523](https://github.com/microsoft/playwright/issues/1523), open since 2020).

**Confidence:** HIGH -- verified by reading actual source code of the installed package.

**Sources:**

- [Vitest Playwright Provider Configuration](https://vitest.dev/config/browser/playwright)
- [Playwright Issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- Actual source: `node_modules/@vitest/browser-playwright/dist/index.js` lines 855-933

## Question 3: @vitest/browser-playwright Provider Architecture

**Answer: Thoroughly analyzed. No wsEndpoint-to-existing-browser support.**

### Architecture Overview

```
playwright() function
  |
  +-- defineBrowserProvider({ providerFactory })
        |
        +-- new PlaywrightBrowserProvider(project, options)
              |
              +-- openBrowser() -- launches or connects browser
              |     |
              |     +-- connectOptions? --> playwright[browser].connect(wsEndpoint)
              |     +-- persistentContext? --> playwright[browser].launchPersistentContext(path)
              |     +-- else --> playwright[browser].launch(launchOptions)
              |
              +-- createContext(sessionId) -- creates BrowserContext per test file
              |     |
              |     +-- this.persistentContext exists? --> reuse it
              |     +-- else --> browser.newContext(options)
              |
              +-- openBrowserPage(sessionId) -- creates Page in context
              +-- openPage(sessionId, url) -- navigates Page to Vitest test URL
              +-- close() -- tears down pages, contexts, browser
```

### Key Implementation Details

1. **Single browser per provider instance.** `this.browser` is a singleton. Multiple test files share it.
2. **Context per test file (non-persistent)** or **single context for all files (persistent).**
3. **No `connectOverCDP` support.** The provider only uses `playwright[browser].connect()` (WebSocket protocol), not `chromium.connectOverCDP()` (CDP protocol).
4. **CDP session available per page** via `getCDPSession(sessionId)` -- but this is for the Vitest debugging inspector, not for connecting to existing browsers.
5. **`ignoreDefaultArgs` and custom `args` flow through `launchOptions`** to either `launch()` or `launchPersistentContext()`. With `connectOptions`, they're serialized into a header for the remote server.

### Can It Be Extended?

The `PlaywrightBrowserProvider` class is exported (`export { PlaywrightBrowserProvider, playwright }`), but:

- `openBrowser()` is a public method -- could be overridden in a subclass
- The custom provider API (`defineBrowserProvider`) is "highly experimental and can change between patches"
- A custom provider could call `chromium.connectOverCDP()` instead, but this bypasses all of Vitest's launch option handling

**Confidence:** HIGH -- read the complete source code (1221 lines).

**Sources:**

- Actual source: `node_modules/@vitest/browser-playwright/dist/index.js`
- [Vitest Custom Browser Provider API](https://vitest.dev/config/browser/provider)
- [Vitest Issue #7316: Custom provider module support](https://github.com/vitest-dev/vitest/issues/7316)

## Question 4: Has Anyone Solved the "Share Warm Browser" Problem?

**Answer: No established pattern exists for cross-framework browser sharing. Several related patterns exist.**

### Closest Patterns Found

**Pattern A: Playwright's browser context reuse (within one framework)**
Playwright reuses a single browser process across all tests, creating isolated `BrowserContext` instances per test. This is "warm browser" sharing within a single framework. But it does not extend to Vitest.

**Pattern B: Session-scoped fixtures (pytest, xUnit)**
Frameworks like pytest use `@pytest.fixture(scope="session")` to create a shared browser that lives for the entire test session. This is the analog of what this project's `worker-scoped` Playwright fixture does. But it only works within one framework.

**Pattern C: ASP.NET Core shared browser fixtures ([dotnet/aspnetcore#31111](https://github.com/dotnet/aspnetcore/issues/31111))**
The ASP.NET Core team discussed reusing browser instances across tests to avoid expensive initialization. Their solution: a single shared fixture. Still single-framework.

**Pattern D: svitejs/vitest-plugin-playwright-e2e (archived)**
An archived Vitest plugin that ran Playwright-style E2E tests within Vitest. Had an open issue about resource optimization ([Issue #5](https://github.com/svitejs/vitest-plugin-playwright-e2e/issues/5)). Now superseded by Vitest's built-in browser mode.

**Pattern E: The Koi -- "Run Playwright within Vitest"**
A blog post showing how to launch Playwright's browser in Vitest's `beforeAll` and run E2E-style tests within Vitest. This eliminates the cross-framework problem by using one runner.

**No cross-framework pattern found.** The search terms "share browser process between playwright and vitest", "reuse browser instance multiple test suites", and "warm browser shared across test suites" returned no results for sharing a browser between two different test frameworks simultaneously.

**Confidence:** MEDIUM -- extensive search, but absence of evidence is not evidence of absence.

**Sources:**

- [Playwright Isolation Model](https://playwright.dev/docs/browser-contexts)
- [dotnet/aspnetcore#31111: Reuse browser instances](https://github.com/dotnet/aspnetcore/issues/31111)
- [svitejs/vitest-plugin-playwright-e2e Issue #5](https://github.com/svitejs/vitest-plugin-playwright-e2e/issues/5)
- [How to Run Playwright within Vitest | The Koi](https://www.the-koi.com/projects/how-to-run-playwright-within-vitest/)

## Question 5: Can Nx Orchestrate Both Suites in a Single Step?

**Answer: Yes, via a custom executor using `runExecutor`. But it cannot share an in-process browser.**

### Nx Composition Approaches

**Approach A: `nx:run-commands` (simplest)**

```json
{
  "test-all": {
    "executor": "nx:run-commands",
    "options": {
      "commands": ["nx run app:e2e", "nx run app:test-edge"],
      "parallel": false
    }
  }
}
```

This runs both suites sequentially in one Nx target. But each is a separate child process -- they cannot share a browser instance. The profile on disk IS shared (same `.playwright-profiles/msedge-dev`), so the warm model state persists between suites.

**Approach B: Custom executor with `runExecutor`**

```typescript
import { runExecutor } from '@nx/devkit';

export default async function testAllExecutor(options, context) {
  // Run E2E first (warms the model)
  for await (const result of await runExecutor({ project: context.projectName, target: 'e2e' }, {}, context)) {
    if (!result.success) throw new Error('E2E failed');
  }

  // Run unit tests (reuses warm profile on disk)
  for await (const result of await runExecutor({ project: context.projectName, target: 'test-edge' }, {}, context)) {
    if (!result.success) throw new Error('Unit tests failed');
  }

  return { success: true };
}
```

**Key limitation:** `runExecutor` spawns each target as a subprocess. The browser launched by `@playwright/test` lives in the E2E process and dies when E2E completes. The browser launched by Vitest lives in the Vitest process. There is no mechanism to pass a browser WebSocket handle between the two processes.

**Approach C: Custom executor with embedded browser lifecycle**
Write an executor that:

1. Launches the browser once via Playwright's `chromium.launchPersistentContext()`
2. Starts a Playwright BrowserServer-like WebSocket proxy
3. Runs E2E tests configured to `connectOverCDP` to the shared browser
4. Runs Vitest tests configured to `connectOptions.wsEndpoint`
5. Closes the browser

**Problem:** Playwright's `launchServer()` does not support persistent contexts ([Issue #1523](https://github.com/microsoft/playwright/issues/1523)). You would need to manually expose the CDP WebSocket URL from `launchPersistentContext()` and manage the connection yourself. This is highly custom and fragile.

**Approach D: `dependsOn` for sequencing (simplest viable)**

```json
{
  "test-edge": {
    "dependsOn": ["e2e"]
  }
}
```

This ensures E2E runs first, warming the model. Unit tests then launch against the same persistent profile. The warm-up time in unit tests' `globalSetup` would be reduced because the profile already has a warm model state on disk (depending on whether ONNX Runtime caches session data).

**Recommendation:** Approach A or D. Sequential execution with profile sharing via disk. True in-process browser sharing is not viable without significant custom infrastructure.

**Confidence:** MEDIUM -- Nx composition patterns are well-documented, but the cross-framework browser sharing is uncharted.

**Sources:**

- [Nx: Compose Executors](https://nx.dev/docs/extending-nx/compose-executors)
- [Nx: runExecutor API](https://nx.dev/nx-api/devkit/documents/runExecutor)
- [Nx Issue #10343: Alternative to runExecutor](https://github.com/nrwl/nx/issues/10343)
- [Nx Issue #19531: runExecutor doesn't run dependent tasks](https://github.com/nrwl/nx/issues/19531)

## Viable Architectural Approaches (Ranked)

### 1. Consolidate Under One Runner (Recommended)

**Approach:** Move E2E-style tests into Vitest browser mode, or move unit-style tests into Playwright.

**How:** Vitest browser mode already runs in a real browser with Playwright. E2E tests primarily do `page.goto()`, `page.click()`, and `page.evaluate()`. Vitest browser mode supports all of these through its locator API. The key difference is that Vitest manages the page lifecycle (opening to the Vitest test URL), while Playwright tests navigate freely.

**Trade-off:** Vitest browser mode opens a single page per test file. E2E-style navigation (goto, reload) would need to happen within `page.evaluate()` or via Vitest's browser commands. This is less natural than Playwright's test API for multi-page navigation flows.

**Benefit:** Single warm-up, single browser process, single framework, no coordination needed.

**Risk:** Vitest browser mode may not support all E2E patterns (multi-page navigation, request interception at the Playwright API level).

### 2. Leverage Vitest's persistentContext with Warm Profile (Already Implemented)

**Approach:** The current architecture already does this. E2E tests warm the profile, Vitest unit tests launch against the same profile directory. The second launch is faster because the model is already registered.

**How:** Already configured in `vitest.shared.mts`:

```typescript
persistentContext: resolve('.playwright-profiles/chrome-beta'),
```

**Benefit:** No changes needed. Each suite warms independently, but the second suite benefits from the first's warm-up artifacts on disk.

**Limitation:** "Warm profile" means model files and registration state are on disk. But the inference pipeline cold-start (ONNX Runtime session compilation) happens per-process. The warm-up is partially shared (model download + registration) but not fully shared (first inference still takes time in the second process).

### 3. CDP Bridge with Pre-Launched Browser

**Approach:** A wrapper script launches the browser with `--remote-debugging-port=9222` and the persistent profile. Both test suites connect via CDP.

```bash
# Pre-launch script
msedge-dev --remote-debugging-port=9222 \
  --user-data-dir=.playwright-profiles/msedge-dev \
  --enable-features=AIPromptAPI \
  --disable-features=OnDeviceModelPerformanceParams
```

Then:

- Playwright tests: `chromium.connectOverCDP('http://localhost:9222')`
- Vitest: Custom provider or `connectOptions` (requires custom work since `connectOptions` uses Playwright protocol, not CDP)

**Benefit:** True single browser process. Model warm-up happens once.

**Risk:**

- CDP connection is "lower fidelity" per Playwright docs -- may not support all Playwright features
- Unclear if Chrome flags (`--enable-features`) are preserved when connecting via CDP (they are set at launch, so yes -- but Playwright features like `ignoreDefaultArgs` would not apply)
- Requires external browser lifecycle management
- ProcessSingleton applies -- only one process can use the profile, which is satisfied by having a single pre-launched browser

### 4. Custom Nx Executor (Orchestration Only)

**Approach:** An Nx executor that launches the browser, runs E2E, then runs Vitest, then closes the browser. Both suites configured to connect to the running browser.

**Benefit:** Single `nx run app:test-all-edge` command. CI simplification.

**Risk:** Combines the complexity of approach 3 with Nx executor development. Does not add value beyond approach 3 unless CI pipeline simplification is important.

### 5. Custom Vitest Browser Provider (Most Fragile)

**Approach:** Extend `PlaywrightBrowserProvider` to override `openBrowser()` and call `chromium.connectOverCDP()` instead of `launch()`.

```typescript
class CDPBrowserProvider extends PlaywrightBrowserProvider {
  async openBrowser() {
    const playwright = await import('playwright');
    this.browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
    return this.browser;
  }
}
```

**Benefit:** Vitest connects to an existing browser without launching one.

**Risk:**

- Custom provider API is "highly experimental and can change between patches"
- `connectOverCDP` returns a `Browser` with reduced functionality
- Context options, `ignoreDefaultArgs`, and headless settings are meaningless for a connected browser
- Would break on any Vitest minor version update

## Recommendation

**Short term: Accept the current architecture.** The project already uses `persistentContext` with shared profile directories. The sequential execution (E2E then unit tests) means the second suite benefits from profile warm-up artifacts. The warm-up duplication is the cost of using two test frameworks.

**Medium term: Evaluate consolidating E2E tests into Vitest browser mode.** If the E2E tests are simple (navigate, check element, evaluate), they can likely run as Vitest browser-mode tests. This eliminates the cross-framework problem entirely. Flag this for deeper research: can Vitest browser mode handle `webServer` management and multi-page navigation?

**Do not pursue:** CDP bridge, custom providers, or custom Nx executors. The complexity-to-benefit ratio is too high given that the current architecture works and warm-up deduplication provides only incremental improvement.

## Sources

- [Vitest Browser Mode vs Playwright | Epic Web Dev](https://www.epicweb.dev/vitest-browser-mode-vs-playwright)
- [Vitest Playwright Provider Configuration](https://vitest.dev/config/browser/playwright)
- [Vitest Browser Mode Guide](https://vitest.dev/guide/browser/)
- [Vitest 4.0 Release Blog](https://vitest.dev/blog/vitest-4)
- [Vitest Issue #7316: Custom provider module support](https://github.com/vitest-dev/vitest/issues/7316)
- [Vitest Discussion #9306: Remote browser support](https://github.com/vitest-dev/vitest/discussions/9306)
- [Playwright Issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- [Playwright BrowserType API](https://playwright.dev/docs/api/class-browsertype)
- [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Nx: Compose Executors](https://nx.dev/docs/extending-nx/compose-executors)
- [Nx: runExecutor API](https://nx.dev/nx-api/devkit/documents/runExecutor)
- [How to Run Playwright within Vitest | The Koi](https://www.the-koi.com/projects/how-to-run-playwright-within-vitest/)
- [svitejs/vitest-plugin-playwright-e2e](https://github.com/svitejs/vitest-plugin-playwright-e2e)
- [Vitest Browser Mode vs Playwright | BrowserStack](https://www.browserstack.com/guide/vitest-vs-playwright)
- [Component Testing with Playwright and Vitest | The Candid Startup](https://www.thecandidstartup.org/2025/01/06/component-test-playwright-vitest.html)
