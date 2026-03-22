# Feasibility Assessment: Sharing a Browser Process Across Test Frameworks

**Verdict:** MAYBE with significant constraints
**Confidence:** HIGH (on the constraints), LOW (on the workaround viability)

## Summary

Sharing a single browser process between Playwright test runner and Vitest browser mode to avoid duplicate model warm-up is **not possible through supported APIs**. The two critical blockers are:

1. **Vitest's `connectOptions` uses `playwright[browser].connect()`, not `connectOverCDP()`**. This means Vitest can only connect to a Playwright server (`run-server`), not to a browser launched with `--remote-debugging-port`.

2. **`playwright run-server` does not support persistent contexts** (`userDataDir`). Playwright issue #1523 has been open since 2020 requesting this feature. Without persistent context, the browser server cannot access the model files, ONNX Runtime DLLs, or chrome://flags state stored in the profile directory.

A **workaround path exists** via a custom Vitest `BrowserProvider` that wraps `connectOverCDP()`, but this depends on an experimental API with no stability guarantees and faces known limitations around CDP context management. This approach has not been validated for the LanguageModel API specifically.

The **recommended approach** is to continue with sequential test execution, leveraging the fact that both frameworks already use the same profile directory. When E2E runs first and warms the model to readiness level 3, Vitest's subsequent warm-up should complete quickly (seconds) because the model state is persisted on disk.

## Requirements

| Requirement                              | Status            | Notes                                                                                            |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Connect Vitest to existing browser       | Partial           | `connectOptions.wsEndpoint` exists but uses Playwright protocol, not CDP                         |
| Persistent browser profile               | Available locally | `persistentContext: string` supports custom paths; not available via `connect()` or `run-server` |
| Branded browser (Chrome Beta / Edge Dev) | Available locally | Via `channel` option in `launchOptions`; works with `connectOverCDP` for any Chromium            |
| Headed mode                              | Available         | All connection methods support `headless: false`                                                 |
| `ignoreDefaultArgs` support              | Available locally | Via `launchOptions`; forwarded via header for `connect()`                                        |
| Custom browser args                      | Available locally | Via `launchOptions.args`                                                                         |
| Background browser in CI                 | Available         | Standard `--remote-debugging-port` pattern, background processes persist across CI steps         |
| LanguageModel API over CDP               | Unknown           | Not tested -- may have issues with browser-internal subsystems                                   |
| Custom Vitest browser provider           | Experimental      | API marked "highly experimental, can change between patches"                                     |

## Blockers

| Blocker                                                             | Severity     | Mitigation                                                                 |
| ------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `run-server` has no persistent context support                      | **Critical** | Cannot be mitigated -- Playwright architectural limitation (issue #1523)   |
| Vitest `connectOptions` maps to `connect()`, not `connectOverCDP()` | **Critical** | Custom `BrowserProvider` wrapping `connectOverCDP()` (experimental)        |
| CDP context management limitations                                  | **High**     | Vitest creates context per test file; CDP may not support `newContext()`   |
| Custom provider API instability                                     | **High**     | Pin versions, minimal implementation, accept maintenance burden            |
| LanguageModel API over CDP untested                                 | **Medium**   | Requires spike to verify before committing to approach                     |
| ProcessSingleton with shared profile                                | **Medium**   | Background browser owns profile; test frameworks connect without launching |

## Detailed Analysis: Four Approaches

### Approach A: `connectOptions` + `playwright run-server`

**Verdict: NOT VIABLE**

Vitest natively supports `connectOptions.wsEndpoint` to connect to a remote Playwright server. The `x-playwright-launch-options` header forwards `launchOptions` (including `channel`, `args`, `ignoreDefaultArgs`). However, `run-server` / `launchServer` does not support `userDataDir` or persistent contexts. The model files, ONNX Runtime DLLs, and chrome://flags state all reside in the persistent profile. Without profile access, the LanguageModel API is unavailable.

### Approach B: Background Chrome + `connectOverCDP` + Custom Vitest Provider

**Verdict: MAYBE -- requires spike**

1. Launch Chrome Beta manually: `chrome-beta --remote-debugging-port=9222 --user-data-dir=.playwright-profiles/chrome-beta --enable-features=... &`
2. Playwright E2E connects via `chromium.connectOverCDP('http://localhost:9222')`
3. Custom Vitest `BrowserProvider` also connects via `connectOverCDP`
4. Model warms up once via E2E; Vitest reuses warm browser

**Unknowns:**

- Does `connectOverCDP` support creating new contexts? (Vitest needs one per test file)
- Does `ignoreDefaultArgs` matter if we launch Chrome manually? (We control all args)
- Does the LanguageModel API work in a CDP-connected context?
- How does Vitest's iframe-based test runner interact with a CDP-connected browser?

### Approach C: Sequential Execution with Shared Profile (Current Architecture)

**Verdict: VIABLE -- already implemented, potentially optimizable**

Both Vitest and Playwright use `launchPersistentContext` with the same profile directory. E2E runs first, warms model to level 3. Vitest's globalSetup detects warm model and completes quickly. The PID-based warmup marker in `global-setup.shared.ts` already guards against redundant warm-up within the same process.

**Optimization opportunity:** If E2E warm-up persists model state to disk (which it does -- model files stay in the profile), Vitest's warm-up should be fast. The current warm-up still runs `LanguageModel.create()` + `session.prompt('warmup')` even when the model is already ready. Optimizing this detection could reduce Vitest warm-up from minutes to seconds.

### Approach D: Unified Test Framework

**Verdict: VIABLE but out of scope**

Run all tests (unit + E2E) through a single framework to avoid the sharing problem entirely. Either:

- Move component tests from Vitest to Playwright (possible but loses Vite integration)
- Move E2E tests from Playwright to Vitest browser mode (possible but loses Playwright's fixtures)

This trades the sharing problem for a migration problem.

## Recommendation

**Primary: Optimize Approach C (sequential execution with shared profile).** This requires no experimental APIs, no custom providers, and leverages the architecture already in place. The specific optimization is to make Vitest's globalSetup smarter about detecting an already-warm model and skipping redundant warm-up steps.

**Spike: Investigate Approach B (CDP custom provider)** only if Approach C optimization proves insufficient. The spike should:

1. Manually launch Chrome Beta with `--remote-debugging-port` and `--user-data-dir`
2. Connect via `connectOverCDP` in a standalone script
3. Verify `LanguageModel.availability()` and `session.prompt()` work over CDP
4. If successful, prototype the custom `BrowserProvider`

**Do not pursue Approach A.** It is blocked by an unimplemented Playwright feature with no workaround.

## Sources

- Vitest provider source: `node_modules/@vitest/browser-playwright/dist/index.js` (verified locally)
- [Vitest Playwright Configuration](https://vitest.dev/config/browser/playwright)
- [Playwright BrowserType API](https://playwright.dev/docs/api/class-browsertype)
- [Playwright issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- [Playwright issue #15370: CDP context management](https://github.com/microsoft/playwright/issues/15370)
- [Vitest Discussion #9306: Remote browser in Docker](https://github.com/vitest-dev/vitest/discussions/9306)
- [BrowserStack: Connecting Playwright to Existing Browser](https://www.browserstack.com/guide/playwright-connect-to-existing-browser)
- [Vitest 4.0 InfoQ article](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/)
- [Playwright Browser and Context Management (DeepWiki)](https://deepwiki.com/microsoft/playwright/3.1-browser-and-context-management)
