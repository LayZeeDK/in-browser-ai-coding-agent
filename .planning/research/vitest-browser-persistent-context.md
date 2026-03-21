# Vitest Browser Mode: Persistent Context for Pre-Downloaded AI Models

**Researched:** 2026-03-21
**Overall confidence:** HIGH
**Verdict:** Upgrade to `@vitest/browser-playwright` v4.1.0+ -- native `persistentContext` option solves this exactly.

## Problem Statement

`@vitest/browser-playwright` v4.0.9 (currently installed) uses `browserType.launch()` internally
(line 823 of `dist/index.js`). Playwright's `launch()` rejects the `--user-data-dir` Chrome arg with:

> "Pass userDataDir parameter to 'browserType.launchPersistentContext(userDataDir, options)' instead."

We need tests to use `.playwright-profiles/msedge-dev` because it contains a pre-downloaded
Phi-4-mini AI model (~4-6 GB via EdgeLLMOnDeviceModel) plus the ONNX runtime DLLs. Without the
persistent profile, each test run re-downloads the model.

## Solution: Upgrade to v4.1.0

### The `persistentContext` Option (v4.1.0+)

Vitest v4.1.0 (released 2026-03-12) added native persistent context support via PR
[#9229](https://github.com/vitest-dev/vitest/pull/9229), resolving issue
[#9036](https://github.com/vitest-dev/vitest/issues/9036).

**Type:** `boolean | string`
**Default:** `false`

- `true` -- stores user data in `./node_modules/.cache/vitest-playwright-user-data`
- `string` -- uses the string value as the path to the user data directory

**Source:** [Vitest Playwright Provider Docs](https://vitest.dev/config/browser/playwright)

### Configuration for This Project

After upgrading, the vitest config becomes:

```typescript
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances: [
        {
          browser: 'chromium',
          name: 'edge-phi4-mini',
          provider: playwright({
            persistentContext: '.playwright-profiles/msedge-dev',
            launchOptions: {
              channel: 'msedge-dev',
              args: ['--enable-features=AIPromptAPI', '--disable-features=OnDeviceModelPerformanceParams', DISABLE_FEATURES_WITHOUT_OPT_HINTS],
              ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
            },
          }),
        },
      ],
    },
  },
});
```

### How It Works Internally (from PR #9229 diff)

When `persistentContext` is set:

1. Instead of `playwright[browserName].launch(launchOptions)`, it calls
   `playwright[browserName].launchPersistentContext(userDataDir, { ...launchOptions, ...contextOptions })`
2. The returned context is stored as `this.persistentContext`
3. The browser is obtained via `this.persistentContext.browser()`
4. When creating contexts for test files, it reuses `this.persistentContext` instead of calling
   `browser.newContext()`
5. On close, it calls `this.persistentContext.close()` instead of closing individual contexts

### Critical Limitation: No Parallel Sessions

The `persistentContext` option is **ignored when tests run in parallel** (headless with
`fileParallelism` enabled). A warning is logged:

> "The persistentContext option is ignored because tests are running in parallel."

This is a Playwright limitation: `launchPersistentContext` returns a single `BrowserContext` tied
to one browser instance. Multiple parallel sessions cannot share the same user data directory.

**Impact for this project:** The AI model tests are inherently sequential (single GPU/NPU, single
model instance), so this limitation is acceptable. Set `fileParallelism: false` in the browser test
config or run headed (which disables parallelism by default).

### Breaking Change: `openPage` Signature

In v4.1.0, the `BrowserProvider.openPage` signature changed:

```typescript
// v4.0.9
openPage(sessionId: string, url: string): Promise<void>

// v4.1.0
openPage(sessionId: string, url: string, options: { parallel: boolean }): Promise<void>
```

The third `options` parameter is how Vitest tells the provider whether parallel sessions are active,
so the provider can decide whether to use persistent context or fall back to regular context. This
change means custom providers written for v4.0.x need updating.

## Package Versions to Upgrade

Current:

- `vitest`: `4.0.9`
- `@vitest/browser-playwright`: `^4.0.9`
- `@vitest/coverage-v8`: `4.0.9`
- `@vitest/ui`: `4.0.9`

Target:

- `vitest`: `4.1.0`
- `@vitest/browser-playwright`: `^4.1.0`
- `@vitest/coverage-v8`: `4.1.0`
- `@vitest/ui`: `4.1.0`

All vitest packages should be upgraded together since they share internal protocols.

## Alternative Approaches (if upgrade is not possible)

### Option A: Custom Browser Provider Wrapping PlaywrightBrowserProvider

Write a custom provider that imports from `@vitest/browser-playwright`, extends
`PlaywrightBrowserProvider`, and overrides `openBrowser()` to call `launchPersistentContext`.

**Problem:** The `openBrowser()` method is private in the class. The `defineBrowserProvider` API is
"highly experimental and can change between patches." Not recommended.

**Confidence:** LOW -- fragile, would break on any minor version update.

### Option B: Monkey-Patch the Provider at Runtime

In a Vitest plugin or setup file, intercept the provider instance and replace the `openBrowser`
method.

```typescript
// Conceptual -- NOT RECOMMENDED
const originalOpenBrowser = provider.openBrowser.bind(provider);
provider.openBrowser = async function () {
  // call launchPersistentContext instead
};
```

**Problem:** `openBrowser` is a private method called internally. The provider instance is not
easily accessible from plugin hooks. This is extremely fragile.

**Confidence:** LOW -- hacky, untestable, breaks on any update.

### Option C: Vitest Plugin Intercepting Browser Launch

Vitest does not expose a hook for intercepting browser launch. The browser provider is instantiated
inside `@vitest/browser`'s server creation code, not accessible via Vite plugin hooks.

**Confidence:** LOW -- no viable hook exists.

### Option D: Pre-Copy Model Files to Default Cache Location

Instead of using a persistent context, copy the model files into the location where Edge Dev expects
them within a fresh profile. This avoids the need for persistent context entirely.

**Problem:** Edge stores model data in `EdgeLLMOnDeviceModel/` and `EdgeLLMRuntime/` under the
user data directory. The exact paths depend on browser internals and may change. Model discovery
also relies on component registration state stored in browser preferences (not just file presence).
Simply copying files is insufficient -- the browser needs to have registered the component.

**Confidence:** LOW -- model registration state is complex, not just file placement.

### Option E: Connect to Pre-Launched Browser via CDP

Launch the browser manually with `--remote-debugging-port` and a persistent profile, then use
Playwright's `connectOverCDP` to connect Vitest to it.

```typescript
provider: playwright({
  connectOptions: {
    wsEndpoint: 'ws://localhost:9222',
  },
}),
```

**Problem:** Requires external browser lifecycle management (launch before tests, kill after).
The `connectOptions` approach bypasses `launchOptions` entirely, including `channel`,
`ignoreDefaultArgs`, and `args`. Also, `connectOptions` takes precedence over `launchOptions`
and logs a warning.

**Confidence:** MEDIUM -- technically works but adds significant operational complexity.

## Recommendation

**Upgrade to v4.1.0.** This is the clear path forward because:

1. Native support with zero custom code
2. The feature was designed for exactly this use case (PR #9036 describes preserving browser state)
3. The `persistentContext` option accepts a custom string path, matching our `.playwright-profiles/msedge-dev` layout
4. The `channel` option works with `launchPersistentContext` (confirmed in Playwright docs -- `msedge-dev` is a supported channel)
5. Vitest 4.1.0 has no breaking changes from 4.0.9 (same major version, additive features only)
6. The `@nx/vitest` plugin (v22.6.0 in this project) should be compatible with vitest 4.1.0 since it targets the v4 API

## Caveats After Upgrade

1. **`fileParallelism` must be disabled** for persistent context to work. Set `fileParallelism: false` in the browser test config or rely on headed mode (which disables it by default).

2. **Single browser instance per profile.** Cannot launch multiple test instances sharing the same `.playwright-profiles/msedge-dev` directory simultaneously. If the Chrome Gemini Nano instance also needs persistent context, it needs its own separate profile directory.

3. **Lock files.** Chromium creates lock files in the user data directory. If a previous test run crashes, stale lock files may prevent the next run from starting. Add cleanup logic or use `--no-first-run` flag.

4. **Profile corruption.** If tests modify browser state (cookies, localStorage), this persists across runs. Tests should not rely on a clean browser state when using persistent context, or should clean up explicitly.

5. **The "about:blank" page.** The PR includes a TODO comment: "how to avoid default 'about' page?" -- `launchPersistentContext` opens a default blank page. Vitest navigates to the test URL after context creation, so this should not be a practical issue, but it may appear briefly in headed mode.

## Sources

- [Vitest Playwright Provider Configuration](https://vitest.dev/config/browser/playwright) -- Official docs for `persistentContext` option
- [PR #9229: feat(browser): support playwright persistent context](https://github.com/vitest-dev/vitest/pull/9229) -- Implementation PR with full diff
- [Issue #9036: DevTools: Preserve devtools settings between sessions](https://github.com/vitest-dev/vitest/issues/9036) -- Original feature request
- [Vitest v4.1.0 Release Notes](https://github.com/vitest-dev/vitest/releases/tag/v4.1.0) -- Release containing the feature
- [Vitest 4.1 Blog Post](https://vitest.dev/blog/vitest-4-1) -- Feature announcement
- [Playwright BrowserType API](https://playwright.dev/docs/api/class-browsertype) -- `launchPersistentContext` docs, confirms `channel` support
- [Discussion #4866](https://github.com/vitest-dev/vitest/discussions/4866) -- Original discussion showing the `--user-data-dir` error
- [Issue #9780](https://github.com/vitest-dev/vitest/issues/9780) -- Related: branded browser support in Vitest
