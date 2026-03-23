# Nx: Preventing Concurrent Target Execution on Shared Resources

**Researched:** 2026-03-23
**Nx version:** 22.6.0
**Overall confidence:** HIGH (verified against Nx source code and official schema)

## Executive Summary

This research answers: "What is the correct Nx approach for preventing two targets from running concurrently when they share a resource?" Specifically, when `test` (Vitest browser mode) and `e2e` (Playwright) both need the same `.playwright-profiles/` browser profile directory, which enforces a single-process lock (Chrome ProcessSingleton).

Nx offers two mechanisms: **`parallelism: false`** (Nx 19.5+) and **`dependsOn`**. They solve different problems. `parallelism: false` provides mutual exclusion without ordering. `dependsOn` provides ordered sequencing (which implies mutual exclusion). **For this workspace, `dependsOn` with the object syntax is the correct approach**, because we want a specific ordering relationship (e2e depends on the app's test), not a blanket "nothing else runs while I run" lock.

## Question-by-Question Analysis

### Q1: Is `dependsOn: ["^test"]` on the e2e target the right pattern?

**Answer: Yes, this is the standard Nx pattern -- but use the object syntax for precision.**

The `^` (caret) means "run this target on all dependency projects." Since `in-browser-ai-coding-agent-e2e` has `implicitDependencies: ["in-browser-ai-coding-agent"]`, adding `dependsOn: ["^test"]` to the e2e target means: "before running e2e, run the `test` target on `in-browser-ai-coding-agent`."

This is **not** unconventional. Nx's own documentation shows e2e targets depending on dependency targets (e.g., `dependsOn: ["^build"]`). The `^test` pattern follows the same logic.

However, there is a subtlety. If the e2e project ever gains additional implicit or explicit dependencies, `^test` will require `test` on ALL of them. The object syntax is more precise:

```json
{
  "e2e": {
    "dependsOn": [
      {
        "projects": ["in-browser-ai-coding-agent"],
        "target": "test"
      }
    ]
  }
}
```

This explicitly names the project whose `test` target must complete first, avoiding unintended expansion if the dependency graph changes.

**Confidence: HIGH** -- verified against Nx project schema (v22.6.0) and official documentation.

### Q2: What is the Nx-recommended way to prevent concurrent execution of targets that share a resource?

**Answer: Nx provides `parallelism: false` (Nx 19.5+) for resource contention and `dependsOn` for ordered dependencies.**

There are two built-in mechanisms:

#### Option A: `parallelism: false` (mutual exclusion)

Set `parallelism: false` on any target that needs exclusive access to a shared resource. When any `parallelism: false` task is running, NO other task runs on that machine (not just other `parallelism: false` tasks -- nothing at all).

```json
{
  "targets": {
    "test": { "parallelism": false },
    "e2e": { "parallelism": false }
  }
}
```

**Pros:**

- No ordering constraint -- either can run first
- Declarative -- expresses "this task needs exclusive machine access"

**Cons:**

- Coarse-grained -- blocks ALL tasks, not just the conflicting pair
- No resource groups -- Nx has no concept of "these two targets share resource X"
- Overkill when you actually want ordering (e2e should run after test)

#### Option B: `dependsOn` (ordered sequencing)

Create an explicit dependency from one target to the other.

```json
{
  "targets": {
    "e2e": {
      "dependsOn": ["^test"]
    }
  }
}
```

**Pros:**

- Precise -- only the named targets are affected
- Expresses the actual intent -- e2e benefits from test having warmed the model
- Other targets (lint, build, typecheck) can still run in parallel
- Cached results mean `test` won't re-run if already completed

**Cons:**

- Creates a hard ordering -- `test` always runs before `e2e`, even when only `e2e` is requested
- Stronger than mutual exclusion (ordering implies exclusion, but not vice versa)

#### Recommendation

**Use `dependsOn` for this workspace.** The relationship is not just "don't run concurrently" -- there is a genuine dependency: e2e tests benefit from the model warm-up that unit tests perform. The ordering is desirable, not just tolerated.

**Confidence: HIGH** -- `parallelism` property verified in Nx schema and source code.

### Q3: Does `parallelism: false` in `nx.json` targetDefaults work? What exactly does it do?

**Answer: Yes, `parallelism: false` can be set in `targetDefaults`. It creates a global machine-level lock.**

The Nx JSON schema (v22.6.0) confirms `parallelism` is available in `targetDefaultsConfig`:

```json
// From node_modules/nx/schemas/nx-schema.json
{
  "definitions": {
    "targetDefaultsConfig": {
      "properties": {
        "parallelism": {
          "type": "boolean",
          "default": true,
          "description": "Whether this target can be run in parallel with other tasks"
        }
      }
    }
  }
}
```

Example in `nx.json`:

```json
{
  "targetDefaults": {
    "e2e": {
      "parallelism": false
    }
  }
}
```

The Nx 19.5 blog confirms that `@nx/playwright` and `@nx/cypress` plugins automatically set `parallelism: false` in `targetDefaults` for atomized e2e test targets (`e2e-ci--**/*`).

**Exact behavior (verified from Nx source code at `tasks-schedule.js`, lines 206-228):**

```javascript
canBeScheduled(taskId) {
    // ...dependencies check...

    // if there are no running tasks, can schedule anything
    if (this.runningTasks.size === 0) {
        return true;
    }

    const runningTasksNotSupportParallelism = Array.from(this.runningTasks)
        .some((taskId) => {
            return this.taskGraph.tasks[taskId].parallelism === false;
        });

    if (runningTasksNotSupportParallelism) {
        // if any running tasks do not support parallelism,
        // no other tasks can be scheduled
        return false;
    } else {
        // if all running tasks support parallelism,
        // can only schedule task with parallelism
        return this.taskGraph.tasks[taskId].parallelism === true;
    }
}
```

**Key semantics:**

1. If ANY currently running task has `parallelism: false`, NOTHING else can start.
2. If all running tasks have `parallelism: true`, only tasks with `parallelism: true` can start.
3. A `parallelism: false` task can only start when NO other task is running.

This means `parallelism: false` creates a **global exclusive lock** on the machine. It is NOT scoped to "other tasks with `parallelism: false`" -- it prevents ALL tasks from running alongside it.

**Confidence: HIGH** -- verified directly from Nx source code (`node_modules/nx/src/tasks-runner/tasks-schedule.js`).

### Q4: Can we use `nx.json` targetDefaults to define ordering between `test` and `e2e` across projects?

**Answer: Yes. `dependsOn` in `targetDefaults` applies to all matching targets across the workspace.**

```json
{
  "targetDefaults": {
    "e2e": {
      "dependsOn": ["^test"]
    }
  }
}
```

This means: for every project that has an `e2e` target, run the `test` target on that project's dependencies first.

Since `in-browser-ai-coding-agent-e2e` has `implicitDependencies: ["in-browser-ai-coding-agent"]`, this would make `in-browser-ai-coding-agent:test` run before `in-browser-ai-coding-agent-e2e:e2e`.

**Important caveat:** If you define `dependsOn` at the project level in `project.json`, it **overrides** (does not merge with) the `targetDefaults`. So if you add project-level `dependsOn` to the e2e target, you must re-include any global dependencies you want to keep.

**Alternative: project-level with object syntax (more explicit):**

```json
// apps/in-browser-ai-coding-agent-e2e/project.json
{
  "targets": {
    "e2e": {
      "dependsOn": [
        {
          "projects": ["in-browser-ai-coding-agent"],
          "target": "test"
        }
      ]
    }
  }
}
```

**Confidence: HIGH** -- `dependsOn` in `targetDefaults` is documented and widely used.

### Q5: What is the impact of `dependsOn: ["^test"]` on `nx e2e` -- does it force `test` to run first even when you only want e2e?

**Answer: Yes. `dependsOn` is unconditional -- it always runs prerequisites.**

When you run `nx e2e in-browser-ai-coding-agent-e2e`, Nx will:

1. Build the task graph for the `e2e` target.
2. See `dependsOn: ["^test"]`.
3. Resolve `^test` against `implicitDependencies: ["in-browser-ai-coding-agent"]`.
4. Schedule `in-browser-ai-coding-agent:test` as a prerequisite.
5. Run `test` first, THEN run `e2e`.

**This is by design.** Nx doesn't distinguish between "I explicitly asked for both targets" vs "I only asked for e2e." If `e2e` depends on `test`, `test` always runs first.

However, **caching mitigates this**. If `test` has already run and is cached, Nx will replay the cached result instantly (typically <1s) rather than re-executing. Since the `test` targets in this workspace have `cache: true`, a previously-passed test run will not add meaningful overhead.

**The real concern is the first run** or when `test` cache is invalidated. In that case, `nx e2e` will run the full test suite before starting e2e. For this workspace, that includes launching browsers and running inference -- which could add 1-15+ minutes depending on model warm-up state.

**Workaround if you need to skip test:**

```bash
# Run e2e without its dependencies
nx e2e in-browser-ai-coding-agent-e2e --exclude-task-dependencies
```

Note: `--exclude-task-dependencies` was added in Nx 16+. It skips `dependsOn` prerequisites, running only the target itself.

**Confidence: HIGH** -- this is fundamental Nx behavior.

### Q6: Is there a way to express "these targets can't run in parallel" without creating a hard dependency?

**Answer: Yes -- `parallelism: false`. But it has significant collateral effects.**

Setting `parallelism: false` on both `test` and `e2e` targets would prevent them from running concurrently without creating an ordering dependency. Either could run first, depending on Nx's scheduling.

But as verified from the source code, `parallelism: false` is a **global machine lock**:

- When a `parallelism: false` task runs, ALL other tasks are blocked (not just other `parallelism: false` tasks).
- A `parallelism: false` task cannot start until ALL other running tasks complete.

This means that during `nx run-many -t lint typecheck test build e2e`:

- `lint`, `typecheck`, and `build` would run in parallel (all have `parallelism: true` by default).
- Once those complete, `test` would run **alone** (nothing else can run alongside it).
- After `test` completes, `e2e` would run **alone**.
- The total pipeline time increases because `test` and `e2e` cannot overlap with parallelizable tasks like `lint` and `build`.

**There is no Nx-native concept of "resource groups" or "named locks."** You cannot say "test and e2e share resource X, so serialize those two but let them overlap with lint." The only granularity is the boolean `parallelism` flag.

**Nx does NOT offer:**

- Named mutex/semaphore for shared resources
- Resource group declarations
- Selective mutual exclusion between specific target pairs
- Per-resource parallelism limits

**Confidence: HIGH** -- verified from Nx schema, source code, and documentation. No resource-group feature exists in any searched sources.

## Comparison of Approaches

| Approach                            | Prevents Concurrency    | Creates Ordering     | Blocks Other Tasks | When to Use                             |
| ----------------------------------- | ----------------------- | -------------------- | ------------------ | --------------------------------------- |
| `dependsOn: ["^test"]`              | Yes (ordering implies)  | Yes                  | No                 | When ordering is desired                |
| `dependsOn: [{ projects, target }]` | Yes                     | Yes                  | No                 | When ordering is desired, more explicit |
| `parallelism: false` on both        | Yes                     | No (order undefined) | Yes (global lock)  | When no ordering preference, pure mutex |
| `--parallel=1` globally             | Yes (everything serial) | No                   | Yes (everything)   | Debugging, not for production           |

## Recommendation for This Workspace

**Use `dependsOn` with the object syntax on the e2e target.**

Rationale:

1. **Ordering is actually desirable** -- e2e warm-up benefits from test having exercised the model first.
2. **Minimal collateral** -- `lint`, `typecheck`, and `build` continue running in parallel.
3. **Explicit** -- the object syntax names exactly which project's test must complete.
4. **Cache-friendly** -- if test is already cached, the dependency resolves instantly.

### Recommended Configuration

```json
// apps/in-browser-ai-coding-agent-e2e/project.json
{
  "targets": {
    "e2e": {
      "dependsOn": [
        {
          "projects": ["in-browser-ai-coding-agent"],
          "target": "test"
        }
      ],
      "configurations": {
        "chrome": {
          "command": "playwright test --project=chrome-gemini-nano"
        },
        "edge": {
          "command": "playwright test --project=edge-phi4-mini"
        }
      }
    }
  }
}
```

### Alternative: Per-Browser Granularity

If you want Chrome e2e to depend only on Chrome test, and Edge e2e to depend only on Edge test, Nx configurations do NOT support different `dependsOn` per configuration. You would need separate targets:

```json
// apps/in-browser-ai-coding-agent-e2e/project.json
{
  "targets": {
    "e2e-chrome": {
      "dependsOn": [
        {
          "projects": ["in-browser-ai-coding-agent"],
          "target": "test-chrome"
        }
      ],
      "command": "playwright test --project=chrome-gemini-nano"
    },
    "e2e-edge": {
      "dependsOn": [
        {
          "projects": ["in-browser-ai-coding-agent"],
          "target": "test-edge"
        }
      ],
      "command": "playwright test --project=edge-phi4-mini"
    }
  }
}
```

This allows `test-chrome` + `e2e-chrome` to run in sequence while `test-edge` + `e2e-edge` runs in parallel on a different browser profile. However, this adds target proliferation -- evaluate whether the per-browser isolation is worth the complexity.

### What NOT to Do

1. **Do NOT set `parallelism: false` on test targets** -- it would block `lint`, `typecheck`, and `build` from running during test execution, significantly increasing total CI time.
2. **Do NOT use `--parallel=1`** -- serializes everything, defeating the purpose of Nx.
3. **Do NOT add `dependsOn: ["^test"]` in `targetDefaults` for `e2e`** unless you want ALL e2e projects in the workspace to depend on their dependencies' test targets. For a single e2e project, project-level configuration is cleaner.

## Impact on CI Pipeline

Current CI script: `nx format:check && nx run-many -t lint typecheck test build e2e`

With `dependsOn` on the e2e target:

```
Time -->
|-- lint ---------|
|-- typecheck ----|
|-- build --------|  (all parallel)
|-- test ---------|---> e2e ---------|
```

`test` runs in parallel with `lint`, `typecheck`, and `build`. Once `test` completes, `e2e` starts. This is correct -- e2e needs the profile directory free, and the model warmed.

Without any ordering (current state):

```
Time -->
|-- lint ---------|
|-- typecheck ----|
|-- build --------|
|-- test ---------| CONFLICT with e2e (same profile dir)
|-- e2e ----------| FAILS: ProcessSingleton lock
```

## Sources

- [Nx Project Configuration - parallelism property](https://nx.dev/docs/reference/project-configuration) -- HIGH confidence
- [Nx 19.5 Blog - parallelism introduction](https://nx.dev/blog/nx-19-5-adds-stackblitz-new-features-and-more) -- HIGH confidence
- [Nx nx.json Reference - targetDefaults](https://nx.dev/docs/reference/nx-json) -- HIGH confidence
- [Nx Task Pipeline Configuration](https://nx.dev/docs/concepts/task-pipeline-configuration) -- HIGH confidence
- [Nx Defining a Task Pipeline guide](https://nx.dev/docs/guides/tasks--caching/defining-task-pipeline) -- HIGH confidence
- [Nx source code: tasks-schedule.js](https://github.com/nrwl/nx/blob/master/packages/nx/src/tasks-runner/tasks-schedule.ts) -- HIGH confidence (verified against local `node_modules/nx/src/tasks-runner/tasks-schedule.js` v22.6.0)
- [Nx project-schema.json](https://github.com/nrwl/nx/blob/master/packages/nx/schemas/project-schema.json) -- HIGH confidence (verified locally)
- [Demystifying Nx dependsOn configuration](https://dev.to/frozer/demystifying-nxs-dependson-configuration-f4b) -- MEDIUM confidence
- [Implicit Dependencies Management with Nx](https://dev.to/this-is-learning/implicit-dependencies-management-with-nx-a-practical-guide-through-real-world-case-studies-59kd) -- MEDIUM confidence
