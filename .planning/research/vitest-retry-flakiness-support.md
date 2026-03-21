# Vitest Retry and Flakiness Detection for Browser-Mode Tests

**Researched:** 2026-03-21
**Vitest version:** 4.1.0
**Overall confidence:** HIGH (verified against official docs at vitest.dev)

## Executive Summary

Vitest 4.1 has comprehensive retry support with global config, per-test overrides, and CLI flags. Since 4.1, the `retry` option supports an object form with `count`, `delay`, and `condition` properties for fine-grained control. Vitest tracks a `flaky` boolean in its internal `TestDiagnostic` interface (tests that failed then passed on retry), but only the GitHub Actions reporter surfaces this in output -- the default terminal reporter does not visually distinguish flaky from passed tests. For browser-mode tests with `@vitest/browser-playwright`, retry operates at the test level (re-runs the test function) without relaunching the browser or persistent context, which is ideal for this project's on-device AI testing use case.

The Playwright e2e "mystery retries" in CI come from `@nx/playwright/preset` -- the `nxE2EPreset` function sets `retries: process.env.CI ? 2 : 0` at line 70 of its source.

---

## 1. Vitest Retry Configuration

**Confidence: HIGH** (verified via vitest.dev/config/retry)

### Global Config (`vitest.config.mts`)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Simple: retry all failed tests up to N times
    retry: 2,

    // Object form (Vitest 4.1+): fine-grained control
    retry: {
      count: 2,
      delay: 1000, // ms between retries
      condition: /ECONNREFUSED|ETIMEDOUT/, // only retry matching errors
    },
  },
});
```

### Per-Test Override

```typescript
// Number form -- as options object (second arg)
it('slow AI inference', { retry: 3 }, async () => {
  /* ... */
});

// Number form -- as last argument (legacy style, still works)
it(
  'slow AI inference',
  async () => {
    /* ... */
  },
  { retry: 3 },
);

// Object form with function condition (4.1+, MUST be in test file, not config)
it(
  'flaky network call',
  {
    retry: {
      count: 2,
      delay: 500,
      condition: (error) => error.message.includes('timeout'),
    },
  },
  async () => {
    /* ... */
  },
);
```

**Important caveat:** Function-based `condition` cannot be used in `vitest.config.mts` because the config is serialized when passed to worker threads. Functions lose their reference. Use `RegExp` in config; use functions only in test files.

### CLI Flags

```bash
vitest --retry 3
vitest --retry.count 3
vitest --retry.delay 1000
vitest --retry.condition "ECONNREFUSED|ETIMEDOUT"
```

All three are equivalent to the object properties in config.

### CI-Only Retry Pattern

```typescript
// vitest.config.mts
export default defineConfig({
  test: {
    retry: process.env['CI'] ? 2 : 0,
  },
});
```

Or via CLI in CI workflow only:

```yaml
# .github/workflows/ci.yml
- name: Run unit tests
  run: npx nx test in-browser-ai-coding-agent -- --retry 2
  env:
    CI_VITEST_BROWSER_INSTANCE: ${{ matrix.project }}
```

---

## 2. Flakiness Detection and Reporting

**Confidence: HIGH** (verified via vitest.dev/advanced/api/test-case and vitest.dev/guide/reporters)

### Internal Tracking: `TestDiagnostic`

Vitest tracks retry metadata in its `TestDiagnostic` interface:

```typescript
interface TestDiagnostic {
  readonly slow: boolean;
  readonly heap: number | undefined;
  readonly duration: number;
  readonly startTime: number;
  readonly retryCount: number; // how many times the test was retried
  readonly repeatCount: number; // how many times via `repeats` option
  readonly flaky: boolean; // true if test passed on a retry (not first attempt)
}
```

A test with `state: 'passed'` and `flaky: true` means it failed initially but passed on a subsequent retry -- this is the Vitest equivalent of Playwright's "flaky" designation.

**Note:** A passed test can still have errors attached in its result if `retry` was triggered at least once.

### Reporter Support for Flaky Tests

| Reporter               | Shows Flaky? | Details                                                                                  |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| **Default (terminal)** | No           | Tests that pass on retry appear as "passed" with no flaky indicator                      |
| **GitHub Actions**     | **Yes**      | Job Summary includes a dedicated flaky tests section with permalink URLs to source lines |
| **JUnit**              | No           | Standard pass/fail/skip XML output                                                       |
| **JSON**               | Partial      | Includes `retryCount` in task result but not explicitly labeled as flaky                 |
| **HTML**               | No           | Standard pass/fail display                                                               |

**Key insight:** Unlike Playwright, which prominently displays "N flaky" in its terminal summary, Vitest's default reporter silently treats retried-then-passed tests as simply "passed." The GitHub Actions reporter is the exception, which is good news since this project runs in GitHub Actions CI.

### Comparison with Playwright's Flakiness Reporting

| Capability                      | Playwright                      | Vitest                                              |
| ------------------------------- | ------------------------------- | --------------------------------------------------- |
| Terminal "N flaky" summary      | Yes, built-in                   | No                                                  |
| `flaky` metadata on test result | Yes                             | Yes (`TestDiagnostic.flaky`)                        |
| GitHub Actions summary          | Yes                             | Yes (via `github-actions` reporter)                 |
| Trace on first retry            | Yes (`trace: 'on-first-retry'`) | Yes (Vitest 4.0+ `browser.trace: 'on-first-retry'`) |
| Separate retry/flaky counts     | Yes                             | Only via custom/GH Actions reporter                 |

---

## 3. Browser Mode Specifics

**Confidence: MEDIUM** (inferred from architecture docs; no explicit retry-lifecycle docs for browser mode)

### Persistent Context and Retries

When using `@vitest/browser-playwright` with `persistentContext`, the browser context is created **per test file**, not per individual test. This means:

- **Retries do NOT relaunch the browser.** A retried test re-executes the test function within the same browser page/context.
- **Persistent context survives retries.** The browser profile directory (`.playwright-profiles/chrome-beta` etc.) remains intact. Cookies, localStorage, IndexedDB, and crucially the **downloaded AI model data** persist across retry attempts.
- **This is desirable for AI model tests** because model cold-start (downloading/loading the model) is the slow part. Re-running the test function after a transient timeout doesn't require re-downloading the model.

### Browser Trace on Retry

Vitest 4.0+ supports Playwright-style trace capture in browser mode:

```typescript
export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances,
      trace: 'on-first-retry', // capture trace only when retrying
    },
  },
});
```

Supported modes: `'on'`, `'off'`, `'on-first-retry'`, `'on-all-retries'`, `'retain-on-failure'`.

Trace files are saved to `__traces__/` next to test files. File naming includes retry count: `chrome-gemini-nano-my-test-0-1.trace.zip` (the last number is the retry index).

### fileParallelism and Retries

The current config already sets `fileParallelism: false` because persistent contexts cannot be shared. This is correct and compatible with retries -- there's no risk of parallel test files interfering with each other's retry cycles.

---

## 4. Best Practices for Slow Tests (AI Model Inference)

**Confidence: MEDIUM** (synthesized from community patterns and project-specific analysis)

### Timeout vs Retry: Different Problems, Different Solutions

| Problem                                                                                     | Solution                                   | Why                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Test is inherently slow (model inference takes 60-120s)                                     | **Increase `timeout`**                     | The test isn't flaky, it just needs time. Retrying a timeout just wastes time.   |
| Test occasionally fails due to transient issues (browser glitch, resource contention in CI) | **Use `retry`**                            | The test is fundamentally correct but CI environment introduces non-determinism. |
| Model cold-start makes first test slow but subsequent tests fast                            | **Use `beforeAll` warm-up** (already done) | Front-load the latency into a hook with a generous timeout.                      |
| Test times out in CI but passes locally                                                     | **Use CI-specific timeout AND retry**      | CI runners are slower. Increase timeout first, add retry as safety net.          |

### Recommended Pattern for This Project

The current approach of using `beforeAll` with 300s timeout for model warm-up is correct. The additional recommended configuration:

```typescript
export default defineConfig({
  test: {
    fileParallelism: false,
    // Retry transient failures in CI only
    retry: process.env['CI'] ? 1 : 0,
    // Increase default timeout in CI (model operations are slower on shared runners)
    testTimeout: process.env['CI'] ? 30_000 : 5_000,
    browser: {
      enabled: true,
      instances,
      // Capture Playwright traces on first retry for debugging CI failures
      trace: process.env['CI'] ? 'on-first-retry' : 'off',
    },
  },
});
```

**Why `retry: 1` not `retry: 2` or `3`:**

- AI model tests are either working or broken. If the model isn't loaded, retrying 3 times just wastes 3x the timeout.
- A single retry catches transient CI glitches (browser process hiccup, resource spike) without masking real failures.
- The persistent context survives the retry, so the model stays loaded.

### Using `retry.condition` for Targeted Retries

For even more precision, use condition-based retry to only retry timeout-related failures:

```typescript
export default defineConfig({
  test: {
    retry: process.env['CI'] ? { count: 1, condition: /timeout|ETIMEDOUT|not found within/i } : 0,
  },
});
```

This avoids retrying assertion failures (which indicate real bugs) while retrying timeout-related failures (which indicate CI slowness).

---

## 5. CI-Specific Retry Configuration

**Confidence: HIGH** (standard pattern, widely documented)

### Option A: Config-Level (Recommended)

```typescript
// vitest.config.mts
export default defineConfig({
  test: {
    retry: process.env['CI'] ? 1 : 0,
  },
});
```

GitHub Actions automatically sets `CI=true`, so this works out of the box.

### Option B: CLI-Level in Workflow

```yaml
# Only the CI workflow passes --retry
- name: Run unit tests (${{ matrix.project }})
  run: ${{ matrix.xvfb }} npm exec nx -- test in-browser-ai-coding-agent -- --retry 1
```

### Option C: Nx Target Configuration

In `project.json` or `nx.json`, add CI-specific config:

```json
{
  "targets": {
    "test": {
      "configurations": {
        "ci": {
          "retry": 1
        }
      }
    }
  }
}
```

**Recommendation:** Option A is simplest and self-documenting. The `process.env['CI']` check is idiomatic in both Vitest and Playwright ecosystems.

---

## 6. Playwright Retries Mystery: Solved

**Confidence: HIGH** (verified by reading source code)

### Source: `@nx/playwright/preset`

File: `node_modules/@nx/playwright/src/utils/preset.js`, line 70:

```javascript
function nxE2EPreset(pathToConfig, options) {
  // ...
  return defineConfig({
    testDir: options?.testDir ?? './src',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0, // <-- HERE: 2 retries in CI
    workers: process.env.CI ? 1 : undefined,
    reporter: [...reporters],
  });
}
```

The `nxE2EPreset` function sets `retries: process.env.CI ? 2 : 0`. Since the e2e config spreads this preset first:

```typescript
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    /* ... */
  },
  // ...
});
```

The preset's `retries: 2` applies in CI. The project config does not override it, so 2 retries are active.

### Nx Preset Also Sets

| Property        | CI Value | Local Value |
| --------------- | -------- | ----------- |
| `retries`       | 2        | 0           |
| `workers`       | 1        | auto        |
| `fullyParallel` | true     | true        |
| `forbidOnly`    | true     | false       |

To override, add `retries` after the spread:

```typescript
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  retries: process.env.CI ? 1 : 0, // override Nx default of 2
  // ...
});
```

---

## 7. Recommended Configuration for This Project

### Vitest Config (Unit Tests)

```typescript
// apps/in-browser-ai-coding-agent/vitest.config.mts
export default defineConfig({
  test: {
    fileParallelism: false,
    retry: process.env['CI'] ? 1 : 0,
    browser: {
      enabled: true,
      instances,
      trace: process.env['CI'] ? 'on-first-retry' : 'off',
    },
  },
});
```

### Per-Test Overrides (for Known Slow Tests)

```typescript
// Tests that do model inference should keep their large timeouts
// but also benefit from global retry.
// No per-test retry override needed if global is set.

it('should respond to a prompt', async () => {
  // ...
}, 300_000); // 5-minute timeout, global retry handles transient failures
```

### GitHub Actions Reporter

To surface flaky test information in CI job summaries, add the `github-actions` reporter:

```typescript
export default defineConfig({
  test: {
    reporters: process.env['CI'] ? ['default', 'github-actions'] : ['default'],
    // ...
  },
});
```

This will add annotations to the GitHub Actions job summary highlighting which tests were flaky (passed on retry).

---

## 8. Tradeoffs and Caveats

### Retry Masks Real Failures

Every retry mechanism risks hiding genuine bugs. Mitigations:

- Keep retry count low (1, not 3).
- Use `condition` to only retry timeouts, not assertion failures.
- Monitor the GitHub Actions flaky test summary to catch patterns.
- Periodically review: if a test consistently retries, fix the root cause.

### Browser Context State Leakage on Retry

Since the persistent context survives retries, state from a failed test attempt (DOM changes, localStorage writes) persists into the retry. This is generally fine for read-only tests (checking model availability, prompting) but could be problematic for tests that mutate browser state. The current test suite is read-only, so this is not a concern.

### `retryCount` Known Bug

There is a known issue (vitest-dev/vitest#3631) where `test.result.retryCount` reports `1` even when the test ran only once. This affects custom reporters but not the retry mechanism itself.

### Timeout Interaction in Browser Mode

In browser mode, `expect.element` and locator actions compute their timeout as `testTimeout - elapsedTime - 100ms`. This means:

- If `testTimeout` is 30s and the test has been running for 25s, assertions only get ~5s before timing out.
- For AI model tests, set generous per-test timeouts (already done with 300s).

---

## Sources

### Official Documentation (HIGH confidence)

- [Vitest retry config](https://vitest.dev/config/retry) -- retry option type, defaults, object form
- [Vitest Test API](https://vitest.dev/api/test) -- per-test retry syntax
- [Vitest CLI](https://vitest.dev/guide/cli) -- `--retry.*` flags
- [Vitest TestCase API](https://vitest.dev/advanced/api/test-case) -- `TestDiagnostic` interface with `flaky` boolean
- [Vitest Reporters](https://vitest.dev/guide/reporters) -- GitHub Actions reporter flaky test highlighting
- [Vitest Browser Trace](https://vitest.dev/config/browser/trace) -- `on-first-retry` trace capture
- [Vitest Trace View](https://vitest.dev/guide/browser/trace-view) -- trace file output and viewing
- [Vitest Browser Config](https://vitest.dev/config/browser) -- browser-specific configuration
- [Vitest Test Projects](https://vitest.dev/guide/projects) -- environment-specific config via projects

### GitHub Issues (MEDIUM confidence)

- [vitest-dev/vitest#1057](https://github.com/vitest-dev/vitest/issues/1057) -- original flaky test feature request (COMPLETED via retry)
- [vitest-dev/vitest#9179](https://github.com/vitest-dev/vitest/issues/9179) -- browser-specific retry config request (CLOSED, use projects)
- [vitest-dev/vitest#3631](https://github.com/vitest-dev/vitest/issues/3631) -- retryCount off-by-one bug
- [vitest-dev/vitest#7834](https://github.com/vitest-dev/vitest/issues/7834) -- retry in isolated environment proposal
- [vitest-dev/vitest#9751](https://github.com/vitest-dev/vitest/issues/9751) -- timeout unification proposal

### Project Source Code (HIGH confidence)

- `node_modules/@nx/playwright/src/utils/preset.js` line 70 -- source of Playwright CI retries
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` -- spreads nxE2EPreset
- `apps/in-browser-ai-coding-agent/vitest.config.mts` -- current vitest config (no retry set)
