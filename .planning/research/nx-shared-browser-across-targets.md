# Research: Nx Shared Browser Across Test Targets

**Researched:** 2026-03-22
**Confidence:** MEDIUM

## Problem Statement

The project has three Nx test targets per browser: `e2e`, `test` (both browsers), `test-chrome`, `test-edge`. Each target independently launches a browser and performs model warm-up. Can Nx be configured to share a browser process across these targets?

## Short Answer

No. Nx targets run as separate OS processes. There is no built-in mechanism to share an in-process resource (like a browser WebSocket handle) between targets. However, Nx can orchestrate sequential execution so that the second target benefits from warm-up artifacts left on disk by the first.

## Approaches Analyzed

### Approach 1: `dependsOn` for Sequencing

```json
// project.json
{
  "test-edge": {
    "dependsOn": ["e2e"]
  }
}
```

**What it does:** Ensures E2E runs before unit tests. E2E warms the model (session data, ONNX cache files written to the persistent profile). Unit tests launch against the same profile and may benefit from faster warm-up.

**Limitation:** Each target still launches its own browser process. The E2E browser is closed before unit tests start. The "sharing" is via disk state (profile directory), not via a live process.

**Already in use:** The project's CI workflow already runs E2E before unit tests. This is the `dependsOn` approach implemented at the workflow level rather than the Nx config level. The `AGENTS.md` explicitly states: "E2E before unit tests: E2E warm-up initializes inference pipeline; unit tests reuse warm model."

### Approach 2: nx:run-commands (Sequential Commands)

```json
{
  "test-all-edge": {
    "executor": "nx:run-commands",
    "options": {
      "commands": ["nx run app:e2e -- --project=edge-phi4-mini", "nx run app:test-edge"],
      "parallel": false
    }
  }
}
```

**What it does:** Runs both targets sequentially in a single Nx target. Simplifies CI configuration.

**Limitation:** Same as Approach 1 -- separate processes, no browser sharing. Just a convenience wrapper.

**Value:** Marginal. The CI workflow already orchestrates this sequence.

### Approach 3: Custom Executor with runExecutor

```typescript
import { runExecutor } from '@nx/devkit';

export default async function* testAllEdge(options, context) {
  for await (const result of await runExecutor({ project: context.projectName, target: 'e2e' }, { project: 'edge-phi4-mini' }, context)) {
    if (!result.success) {
      yield { success: false };
      return;
    }
  }

  for await (const result of await runExecutor({ project: context.projectName, target: 'test-edge' }, {}, context)) {
    yield result;
  }
}
```

**What it does:** Programmatically runs both targets from a single executor. Could theoretically manage browser lifecycle around both.

**Key limitations:**

1. `runExecutor` does NOT run dependent targets (`dependsOn`) -- it only runs the target itself ([Issue #19531](https://github.com/nrwl/nx/issues/19531))
2. Each invoked target still runs as a subprocess with its own process space
3. No API to pass handles (WebSocket endpoints, CDP URLs) between the targets
4. Error handling is more complex than simple CI step sequencing

**Not recommended.** Adds complexity without enabling browser sharing.

### Approach 4: Custom Executor with Embedded Browser Lifecycle

A hypothetical executor that:

1. Launches the browser using Playwright's `chromium.launchPersistentContext()`
2. Exposes the browser's CDP WebSocket URL
3. Spawns Playwright tests configured to `connectOverCDP`
4. Spawns Vitest tests configured with a custom provider that connects via CDP
5. Closes the browser

**Blockers:**

- Playwright's `launchServer()` does not support persistent contexts ([Issue #1523](https://github.com/microsoft/playwright/issues/1523))
- Vitest's `connectOptions` expects a Playwright WebSocket server, not raw CDP
- `connectOverCDP` is "lower fidelity" -- some Playwright features may not work
- Both test frameworks expect to manage their own browser lifecycle
- The executor would need to configure both frameworks' test configs dynamically (pass the CDP URL)

**Not recommended.** Too much custom infrastructure for incremental benefit.

### Approach 5: parallelism: false for Shared Resources

Nx 19.5+ supports `"parallelism": false` on targets to prevent them from running concurrently:

```json
{
  "test-edge": {
    "parallelism": false
  },
  "e2e": {
    "parallelism": false
  }
}
```

**What it does:** Prevents both targets from running at the same time on the same machine. Relevant when using `nx run-many` or `nx affected`.

**Value:** Prevents ProcessSingleton conflicts if both targets try to use the same profile directory. Already handled by the CI workflow's sequential execution, but useful as a safety net for local development.

## Recommendation

**Use `dependsOn` plus `parallelism: false` for safety.** This is the simplest approach that ensures correct ordering and prevents profile directory conflicts:

```json
{
  "test-edge": {
    "dependsOn": ["e2e"],
    "parallelism": false
  },
  "e2e": {
    "parallelism": false
  }
}
```

Do not build a custom executor. The complexity-to-benefit ratio is extreme for true browser process sharing. The current architecture (sequential execution, shared profile directory) is correct.

## Future Possibility: Nx Task Graph Plugin

If Nx adds support for "setup/teardown" targets that share resources with downstream targets (analogous to Playwright's `webServer` config), this could enable:

1. A "launch-browser" target that starts the browser and outputs a CDP URL
2. Both test targets depend on "launch-browser" and receive the CDP URL
3. A "teardown-browser" target that runs after both tests complete

This does not exist today and is not on the Nx roadmap. It is a speculative future possibility.

## Sources

- [Nx: Compose Executors](https://nx.dev/docs/extending-nx/compose-executors)
- [Nx: runExecutor API](https://nx.dev/nx-api/devkit/documents/runExecutor)
- [Nx: Run Tasks](https://nx.dev/docs/features/run-tasks)
- [Nx Issue #19531: runExecutor and dependsOn](https://github.com/nrwl/nx/issues/19531)
- [Nx Issue #16133: Combining project targets](https://github.com/nrwl/nx/issues/16133)
- [Nx Issue #10343: Alternative to runExecutor](https://github.com/nrwl/nx/issues/10343)
