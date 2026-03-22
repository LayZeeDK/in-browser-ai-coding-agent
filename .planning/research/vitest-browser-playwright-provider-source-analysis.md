# @vitest/browser-playwright v4.1.0 Provider Source Analysis

**Researched:** 2026-03-22
**Confidence:** HIGH (read complete source code from installed package)

## Purpose

Deep analysis of the `PlaywrightBrowserProvider` class to understand browser lifecycle management, launch path selection, and extensibility points for potential browser sharing.

## Source Location

`node_modules/@vitest/browser-playwright/dist/index.js` (1221 lines, single bundled file)

## Class: PlaywrightBrowserProvider

### Properties

```typescript
class PlaywrightBrowserProvider {
  name = 'playwright';
  supportsParallelism = true;
  browser = null; // Browser | null -- singleton
  persistentContext = null; // BrowserContext | null -- when persistentContext option enabled
  contexts = new Map(); // Map<sessionId, BrowserContext>
  pages = new Map(); // Map<sessionId, Page>
  mocker; // Route-based module mocking
  browserName; // "chromium" | "firefox" | "webkit"
  browserPromise = null; // Promise<Browser> | null -- dedup concurrent openBrowser() calls
  closing = false; // guards against operations during teardown
  tracingContexts = new Set(); // Set<sessionId> -- tracks active traces
  pendingTraces = new Map(); // Map<tracePath, sessionId>
  initScripts = [resolve(distRoot, 'locators.js')];
}
```

### openBrowser() -- The Critical Method

```
openBrowser(openBrowserOptions: { parallel: boolean })
  |
  +-- Already resolved? Return this.browser
  +-- Promise in flight? Return this.browserPromise
  +-- Neither? Start launch sequence:
        |
        +-- Build launchOptions from:
        |     - this.options.launchOptions (user-provided)
        |     - options.headless (from Vitest config)
        |     - inspector port (if debugging enabled)
        |     - --start-maximized (if UI mode + chromium)
        |
        +-- BRANCH 1: connectOptions set?
        |     YES --> playwright[browserName].connect(wsEndpoint, { headers })
        |             launchOptions serialized into x-playwright-launch-options header
        |             RETURN (never checks persistentContext)
        |
        +-- BRANCH 2: persistentContext set AND NOT parallel?
        |     YES --> playwright[browserName].launchPersistentContext(userDataDir, {
        |               ...launchOptions, ...contextOptions
        |             })
        |             this.persistentContext = result
        |             this.browser = result.browser()
        |
        +-- BRANCH 3: default
              --> playwright[browserName].launch(launchOptions)
```

**Key insight:** Branch 1 (connectOptions) returns early and never reaches Branch 2 (persistentContext). They are mutually exclusive by code structure, not by validation. This means you cannot connect to a remote Playwright server AND use a persistent profile.

### createContext(sessionId) -- Context Strategy

```
createContext(sessionId, openBrowserOptions)
  |
  +-- Already exists? Return cached context
  +-- Ensure browser is open (openBrowser)
  +-- this.persistentContext exists?
  |     YES --> return this.persistentContext (all test files share one context)
  |     NO  --> browser.newContext(options) (fresh context per test file)
```

When `persistentContext` is active, ALL test files share the same `BrowserContext`. This means cookies, localStorage, and page state leak between test files. The project already handles this via `fileParallelism: false`.

### openBrowserPage(sessionId) -- Page Lifecycle

Each test file gets its own `Page` within the shared context. Pages are created via `context.newPage()` and navigated to Vitest's test orchestrator URL. Test code runs inside an iframe (`data-vitest="true"`) within that page.

### getCDPSession(sessionId) -- CDP Access

```typescript
async getCDPSession(sessionid) {
  const page = this.getPage(sessionid);
  const cdp = await page.context().newCDPSession(page);
  return { send, on, off, once };
}
```

This provides a CDP session for the Vitest debugging inspector. It does NOT enable connecting to an existing browser -- it creates a CDP session within the already-launched browser.

### close() -- Teardown

```
close()
  |
  +-- Set this.closing = true
  +-- Wait for browserPromise if pending
  +-- Close all pages
  +-- If persistentContext: close it (closes browser too)
  +-- Else: close all contexts, then close browser
```

Important: closing a persistent context automatically closes the browser. This means the browser dies when Vitest finishes.

## Extensibility Analysis

### Can PlaywrightBrowserProvider Be Subclassed?

Yes. The class and the `playwright()` factory are both exported:

```typescript
export { PlaywrightBrowserProvider, playwright };
```

A custom provider could extend it:

```typescript
import { PlaywrightBrowserProvider } from '@vitest/browser-playwright';

class CDPConnectProvider extends PlaywrightBrowserProvider {
  async openBrowser() {
    const pw = await import('playwright');
    this.browser = await pw.chromium.connectOverCDP('http://localhost:9222');
    return this.browser;
  }
}
```

**But:** The `defineBrowserProvider` wrapper and Vitest's internal provider loading expect the `playwright()` factory function pattern. A custom provider must implement the full `BrowserProvider` interface and be registered via the config, not via class inheritance.

### Can the Factory Options Be Abused?

The `options` object passed to `playwright()` is stored as `this.options` and used throughout. There is no validation beyond Playwright's own validation of launch/connect options. You could theoretically pass `connectOptions` with a `wsEndpoint` pointing to a pre-launched browser, but:

- The pre-launched browser would need to be started with `playwright run-server` (not just `--remote-debugging-port`)
- Launch options are forwarded via HTTP header, not applied locally
- Persistent context is bypassed when `connectOptions` is set

### What About the Vitest Plugin API?

Vitest does not expose hooks for intercepting browser launch. The browser provider is instantiated inside `@vitest/browser`'s server creation code, not accessible via Vite plugin hooks. There is no `beforeBrowserLaunch` or `afterBrowserLaunch` hook.

## Implications for Browser Sharing

1. **Profile sharing via disk is the only viable path within the current provider architecture.** Both test suites use `persistentContext` pointing to the same profile directory, but launch separate browser processes sequentially.

2. **CDP bridge would require bypassing the provider entirely.** You would need a custom provider that calls `connectOverCDP()` instead of any of the three standard paths. This is technically possible but fragile.

3. **The `connectOptions` path is designed for remote Playwright servers (Docker), not for connecting to arbitrary running browsers.** It expects the `playwright run-server` protocol, not raw CDP.

4. **Playwright's `launchServer()` does not support persistent contexts** ([Issue #1523](https://github.com/microsoft/playwright/issues/1523)). This is the fundamental blocker: you cannot create a Playwright BrowserServer that uses a user data directory. The issue has been open since 2020 with no resolution.

## Sources

- `node_modules/@vitest/browser-playwright/dist/index.js` (v4.1.0, actual installed source)
- [Playwright Issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- [Vitest Custom Browser Provider API](https://vitest.dev/config/browser/provider)
- [Vitest Issue #7316: Custom provider module support](https://github.com/vitest-dev/vitest/issues/7316)
