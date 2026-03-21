# Research: Chrome Persistent Context Profile Lock on Windows

**Researched:** 2026-03-21
**Overall confidence:** HIGH (multiple sources converge on the same root cause)

## Executive Summary

The "Protocol error (Browser.getWindowForTarget): Browser window not found" error when reusing a Chrome profile directory between Playwright's `globalSetup` and test fixtures is caused by **Chrome's `lockfile` mechanism on Windows not releasing fast enough** after `context.close()`. Chrome creates a `lockfile` in the user data directory with `FILE_FLAG_DELETE_ON_CLOSE`, but child processes (particularly `chrome_crashpad_handler`) can hold open handles that delay the file's actual deletion. When the second Chrome instance tries to launch, it finds the lockfile still exists (or in "delete pending" state) and exits cleanly with code 0 -- which Playwright then reports as "Browser window not found".

## Root Cause Analysis

### 1. Chrome's Windows Profile Locking Mechanism

**Confidence: HIGH** (Chromium source code, Puppeteer implementation)

Chrome on Windows uses `ProcessSingleton` (implemented in `process_singleton_win.cc`) which:

1. Creates a file called `lockfile` in the user data directory using `CreateFile` with:
   - `FILE_SHARE_READ` (no write sharing)
   - `CREATE_NEW` (fail if exists)
   - `FILE_FLAG_DELETE_ON_CLOSE` (auto-delete when all handles close)
2. Uses a named mutex (`Local\ChromeProcessSingletonStartup!`) for startup coordination
3. Searches for an existing Chrome window via `chrome::FindRunningChromeWindow`

When the second Chrome instance launches and finds the lockfile exists, it interprets this as "another instance owns this profile" and exits with code 0 (not a crash -- a deliberate single-instance enforcement exit).

**This explains why the exit code is 0.** Chrome is not crashing; it is deliberately exiting because it detects profile contention.

Sources:

- [Chromium process_singleton_win.cc](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/process_singleton_win.cc)
- [Puppeteer lockfile detection commit](https://github.com/puppeteer/puppeteer/commit/8d3a60b99629ec345b34dae9687057d3a9261dc5)

### 2. Why the Lockfile Persists After `context.close()`

**Confidence: HIGH** (Playwright issue #6123, Chromium crashpad-dev group)

`context.close()` sends a shutdown signal to Chrome's main process, but **Chrome spawns child processes that outlive the main process**:

- **`chrome_crashpad_handler`**: Monitors crash state. It exits when ALL connected clients (including child processes it monitors) have exited. If any Chrome child process inherits the crashpad connection, the handler stays alive.
- **GPU process**: On ARM64 Windows, Chrome may spawn a separate GPU process that takes additional time to shut down.
- **Utility processes**: Background networking, component updater, etc.

The `lockfile` uses `FILE_FLAG_DELETE_ON_CLOSE`, which means:

1. Windows marks the file for deletion when the **last handle** is closed
2. If any child process inherited a handle to the lockfile (or holds open handles to files that keep the lockfile's directory entry locked), the file enters a "delete pending" state
3. In "delete pending" state, `CreateFile` with `CREATE_NEW` fails with `ERROR_ACCESS_DENIED` -- and Chrome interprets this as "profile in use"

**The 2-second delay works because it gives child processes time to exit and release their handles.**

Sources:

- [Playwright #6123: Chromium not closed in headful mode](https://github.com/microsoft/playwright/issues/6123) -- documents `chrome_crashpad_handler` holding locks on profile files after `browser.close()`
- [Crashpad-dev: handler behavior with child processes](https://groups.google.com/a/chromium.org/g/crashpad-dev/c/Wpb6JjA75Vo)
- [Windows FILE_FLAG_DELETE_ON_CLOSE behavior](https://microsoft.public.win32.programmer.kernel.narkive.com/tQthfaul/behavior-of-file-flag-delete-on-close)

### 3. Why Edge Dev Does NOT Have This Issue

**Confidence: MEDIUM** (inference from behavioral evidence)

Edge Dev likely handles profile singleton differently or has a faster crashpad shutdown path. Possible reasons:

- Edge may use a different crashpad configuration that does not inherit handles to children
- Edge Dev may have a shorter or synchronous crashpad shutdown sequence
- Edge's `ProcessSingleton` implementation may use a named mutex with a timeout rather than the lockfile approach
- Edge may not spawn the same GPU/utility process tree on ARM64 Windows

This is the least-researched area. The behavioral evidence (Edge works, Chrome does not) is solid, but the precise mechanism is speculative.

### 4. The `--remote-debugging-pipe` Angle

**Confidence: MEDIUM**

There is a tracked Chromium bug ([crbug #40746300](https://issues.chromium.org/issues/40746300)) about Chrome launched with `--remote-debugging-pipe` failing in certain scenarios. The pipe mechanism uses file descriptors 3 and 4, and if these are inherited by child processes, the pipe cleanup may not complete before the profile lock is checked by the next instance.

However, this is likely a contributing factor rather than the root cause. The primary issue is the lockfile/child process lifecycle.

### 5. The `--enable-unsafe-swiftshader` Flag

**Confidence: HIGH** (Chromium docs, Playwright issues)

Playwright adds `--enable-unsafe-swiftshader` by default. On ARM64 Windows:

- SwiftShader is a CPU-based Vulkan/OpenGL ES implementation
- On ARM64, SwiftShader may take longer to initialize or fail differently than on x86_64
- Chrome 130+ deprecated automatic SwiftShader fallback; the flag opts back in
- If SwiftShader initialization races with profile lock acquisition, it could cause the GPU process to exit abnormally

**However, this is unlikely to be the primary cause** because the error is specifically about profile locking (Chrome exits with code 0, indicating a clean singleton-enforcement exit), not a SwiftShader crash.

Sources:

- [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)
- [Intent to Remove: SwiftShader Fallback](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM)

### 6. `DestroyProfileOnBrowserClose` Is Correctly Disabled

**Confidence: HIGH**

Disabling `DestroyProfileOnBrowserClose` is correct and necessary for persistent contexts. This flag controls whether Chrome deletes profile data on exit -- you want the profile data to persist. Disabling it does NOT affect the `lockfile` mechanism, which is part of `ProcessSingleton`, not profile data cleanup.

Sources:

- [Playwright blog: Running codegen with existing profiles](https://dev.to/mxschmitt/running-playwright-codegen-with-existing-chromium-profiles-5g7k)
- [Playwright #22186: ignore_default_args with --disable-features](https://github.com/microsoft/playwright/issues/22186)

## Recommended Fixes (Ranked by Reliability)

### Fix 1: Keep the Persistent Context Open Across globalSetup and Tests (BEST)

**Do not close the context in globalSetup.** Instead, use Playwright's `globalSetup`/`globalTeardown` to keep the browser alive and pass the CDP endpoint to test fixtures.

```typescript
// global-setup.ts
import { chromium, type FullConfig } from '@playwright/test';

let context: BrowserContext;

export default async function globalSetup(config: FullConfig) {
  // Launch persistent context, do warm-up work...
  context = await chromium.launchPersistentContext(profileDir, { ... });

  // Do warm-up, then keep the context alive
  // Store the WebSocket endpoint for the fixture to connect
  const wsEndpoint = (context as any)._browser?.wsEndpoint?.();

  // Write endpoint to a file or env var for fixtures
  // NOTE: This approach may not work with persistent contexts
  // because they don't expose a wsEndpoint the same way.
}
```

**Problem:** Playwright persistent contexts do not expose a WebSocket endpoint for reconnection. This approach works with `browser.launch()` but not with `launchPersistentContext`. You cannot "hand off" a persistent context between globalSetup and test workers.

**Verdict: Not feasible with persistent contexts.**

### Fix 2: Poll for Lock Release Instead of Fixed Delay (RECOMMENDED)

Replace the fixed 2-second delay with an active poll that checks whether the lockfile has been released.

```typescript
// global-setup.ts -- after context.close()
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function waitForProfileUnlock(profileDir: string, timeoutMs = 10_000) {
  const lockfile = join(profileDir, 'lockfile');
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (!existsSync(lockfile)) {
      return; // Lock released
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  // If we get here, try to proceed anyway -- the lockfile
  // might be in "delete pending" state which existsSync
  // could misreport. A short additional delay helps.
  await new Promise((r) => setTimeout(r, 500));
}

// Usage in warmUpModel():
await context.close();
await waitForProfileUnlock(profile.profileDir);
```

**Why this is better than a fixed delay:**

- Adapts to actual system speed (fast on SSD, slower on CI)
- On "delete pending" state, `existsSync` returns `true` but the file cannot be opened -- the fallback delay handles this
- Timeout prevents infinite waits

### Fix 3: Kill Lingering Chrome Processes (AGGRESSIVE)

After `context.close()`, explicitly kill any lingering Chrome child processes for the profile.

```typescript
import { execSync } from 'node:child_process';

async function forceCleanup(profileDir: string) {
  await context.close();

  // Give Chrome 1 second to shut down gracefully
  await new Promise((r) => setTimeout(r, 1_000));

  // Kill any lingering crashpad handlers
  try {
    // Windows: find and kill chrome_crashpad_handler processes
    execSync('taskkill /F /IM chrome_crashpad_handler.exe 2>nul', { stdio: 'ignore' });
  } catch {
    // Process may not exist, that's fine
  }

  // Wait for lockfile release
  await waitForProfileUnlock(profileDir);
}
```

**Downside:** `taskkill` is a blunt instrument -- it kills ALL crashpad handlers, not just the one for your profile. Fine for CI, risky in development if the user has Chrome open.

### Fix 4: Use Separate Profile Directories (ALTERNATIVE)

Use a copy of the profile for globalSetup warm-up, and the original for tests.

```typescript
// global-setup.ts
import { cpSync, mkdirSync } from 'node:fs';

const warmUpDir = profileDir + '-warmup';
mkdirSync(warmUpDir, { recursive: true });
cpSync(profileDir, warmUpDir, { recursive: true });

const context = await chromium.launchPersistentContext(warmUpDir, { ... });
// warm up...
await context.close();
// No need to wait -- tests use the ORIGINAL profileDir
```

**Downside:** The warm-up work (model download, state changes) happens in the copy, not the original. This defeats the purpose if globalSetup is meant to prepare the profile for tests. You would need to copy the warm-up profile BACK after close, which reintroduces the timing issue.

### Fix 5: Keep the Fixed Delay but Make It Robust (PRAGMATIC)

The current 2-second delay is a valid approach. Make it more robust:

```typescript
await context.close();

// Chrome on Windows: child processes (crashpad handler, GPU process)
// may hold the profile lockfile open after context.close().
// The lockfile uses FILE_FLAG_DELETE_ON_CLOSE, so it auto-deletes
// when ALL handles close. Poll for release with a generous timeout.
const lockfile = join(profile.profileDir, 'lockfile');
const deadline = Date.now() + 10_000;

while (existsSync(lockfile) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
}

// Additional buffer for "delete pending" -> fully deleted transition
await new Promise((r) => setTimeout(r, 500));
```

## Recommendation

**Use Fix 2 (poll for lock release)** as the primary solution. It is:

- Deterministic: waits only as long as needed
- Observable: you can log when the lock releases for debugging
- Bounded: has a timeout to prevent infinite waits
- Compatible: works with the existing architecture (globalSetup closes, fixture reopens)

If the poll alone is insufficient (the "delete pending" state can cause `existsSync` to return `true` even though Chrome has exited), combine with a brief post-poll delay (500ms) as shown above.

**Do NOT switch to `storageState` or project dependencies** for this use case. Those patterns are designed for auth state reuse, not for on-device AI model warm-up that requires a real persistent context with chrome:// page access.

## Known Playwright Issues (Reference)

| Issue                                                                         | Description                                                           | Status                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| [#2828](https://github.com/microsoft/playwright/issues/2828)                  | Multiple calls to `launchPersistentContext` fail                      | Closed (2020), core issue acknowledged |
| [#6123](https://github.com/microsoft/playwright/issues/6123)                  | Chromium not closed in headful mode, crashpad holds locks             | Closed, tagged as upstream browser bug |
| [#6310](https://github.com/microsoft/playwright/issues/6310)                  | `launchPersistentContext` Chromium error "cannot read data directory" | Closed                                 |
| [#12830](https://github.com/microsoft/playwright/issues/12830)                | `launchPersistentContext` hangs when used twice (Firefox)             | Closed                                 |
| [#15597](https://github.com/microsoft/playwright/issues/15597)                | Timeout when data directory already exists                            | Closed                                 |
| [#48 (playwright-mcp)](https://github.com/microsoft/playwright-mcp/issues/48) | "Browser window not found" in headless mode                           | Open                                   |

## Windows ARM64-Specific Considerations

1. **QEMU emulation**: If Chrome Beta is an x86_64 binary running under QEMU/Prism emulation on ARM64 Windows, process lifecycle timing is slower. The 2-second delay may be insufficient; polling is more appropriate.
2. **ReFS (Dev Drive)**: The project is on a Dev Drive (ReFS). ReFS handles `FILE_FLAG_DELETE_ON_CLOSE` identically to NTFS, so this is not a factor.
3. **NPU/GPU initialization**: Chrome's TensorFlow Lite XNNPACK delegate log message suggests CPU-based ML inference. The XNNPACK initialization does not affect profile locking.

## Summary of Answers to Research Questions

| Question                           | Answer                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Profile locking on Windows**     | Chrome uses `lockfile` with `FILE_FLAG_DELETE_ON_CLOSE`. Child processes (crashpad) delay the delete. |
| **Known Playwright issues**        | Yes, multiple issues (#2828, #6123, #6310, #12830). Long-standing, acknowledged as browser-level.     |
| **`--remote-debugging-pipe`**      | Minor contributor. Pipe FD inheritance may delay cleanup, but lockfile is the primary blocker.        |
| **`DestroyProfileOnBrowserClose`** | Correctly disabled. Does not affect lockfile mechanism.                                               |
| **`--enable-unsafe-swiftshader`**  | Not the cause. Chrome exits with code 0 (singleton enforcement), not a SwiftShader crash.             |
| **Recommended pattern**            | Poll for lockfile deletion after `context.close()`, with timeout and post-poll buffer.                |
