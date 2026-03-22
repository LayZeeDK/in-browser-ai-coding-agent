# Vitest globalSetup Double Invocation in Browser Mode

**Researched:** 2026-03-22
**Vitest version:** 4.1.0
**Confidence:** HIGH (verified via Vitest TypeScript source code)

## Executive Summary

When `@angular/build:unit-test` runs Vitest with a custom `runnerConfig` that defines
`globalSetup`, the setup function is invoked **twice** -- once for the root project and
once for the browser project clone. This is not a workspace discovery issue. The root
cause is a combination of two factors:

1. **Angular's Vitest plugin merges user config into a `projects` array but does not
   clear `globalSetup` from the root config**, leaving the same `globalSetup` defined at
   both the root level and inside the project.
2. **Vitest always runs globalSetup for the root project** even when the root project has
   no test specs, because `initializeGlobalSetup()` unconditionally adds the root project
   to the set of projects whose globalSetup should run.

## Root Cause Analysis

### How the Angular Builder Invokes Vitest

The `@angular/build:unit-test` executor uses Vitest's Node API, not the CLI. In
`node_modules/@angular/build/src/builders/unit-test/runners/vitest/executor.js`:

```js
return startVitest('test', undefined, vitestConfig, vitestServerConfig);
```

Where:

- `vitestConfig.config` = path to `vitest.config.edge.mts` (the user's `runnerConfig`)
- `vitestServerConfig.plugins` = Angular's `createVitestConfigPlugin` (constructs projects)

### How the Config Gets Split

1. Vite loads `vitest.config.edge.mts` as the root config. This config defines:

   ```js
   test: {
     globalSetup: ['apps/.../global-setup.edge.ts'],
     browser: { instances: [{ name: 'edge-phi4-mini', ... }] },
     // ...
   }
   ```

2. Angular's `createVitestConfigPlugin` Vite plugin hook runs. It receives the loaded
   config and:
   - Takes `config.test` (including `globalSetup`) as `testConfig`
   - Merges `testConfig` into a new project config
   - Returns `{ test: { projects: [projectConfig], coverage: ..., reporters: ... } }`
   - **Does NOT return `test.globalSetup: []` to clear the root-level value**

3. Vite's config hook system **deep-merges** the returned object with the existing config.
   The root `test.globalSetup` from step 1 survives because the Angular plugin does not
   override it.

Result: Vitest sees:

- **Root config**: `test.globalSetup = ['...global-setup.edge.ts']`
- **projects[0]**: `test.globalSetup = ['...global-setup.edge.ts']`

### How Vitest Processes This

**Step 1: Project resolution.** In `packages/vitest/src/node/core.ts:528`:

```ts
private async resolveProjects(cliOptions: UserConfig): Promise<TestProject[]> {
    const names = new Set<string>()
    if (this.config.projects) {
        return resolveProjects(this, cliOptions, undefined, this.config.projects, names)
    }
    if ('workspace' in this.config) {
        throw new Error('The `test.workspace` option was removed in Vitest 4...')
    }
    // ...
}
```

**Step 2: Browser instance cloning.** `resolveBrowserProjects()` in
`packages/vitest/src/node/projects/resolveProjects.ts:203` takes the project (which has
`browser.instances`), creates a clone per browser instance via `deepClone(project.config)`,
and removes the original parent. Each clone inherits `globalSetup`.

**Step 3: GlobalSetup execution.** `initializeGlobalSetup()` in
`packages/vitest/src/node/core.ts:1117`:

```ts
private async initializeGlobalSetup(paths: TestSpecification[]): Promise<void> {
    const projects = new Set(paths.map(spec => spec.project))
    const coreProject = this.getRootProject()
    if (!projects.has(coreProject)) {
        projects.add(coreProject)  // <-- ALWAYS adds root project
    }
    for (const project of projects) {
        await project._initializeGlobalSetup()
    }
}
```

**The root project is unconditionally added.** So even if only the browser project clone
has test specs, the root project's `globalSetup` also runs. Since both the root project
and the browser project clone have the same `globalSetup` file, `setup()` is called twice.

### Per-Project `_initializeGlobalSetup` Has a Guard, But...

Each `TestProject._initializeGlobalSetup()` in
`packages/vitest/src/node/project.ts:233` has a guard:

```ts
async _initializeGlobalSetup() {
    if (this._globalSetups) {
        return  // guard: only run once per project instance
    }
    this._globalSetups = await loadGlobalSetupFiles(
        this.runner,
        this.config.globalSetup,
    )
    for (const globalSetupFile of this._globalSetups) {
        const teardown = await globalSetupFile.setup?.(this)
        // ...
    }
}
```

This guard prevents double invocation **within a single project instance** but does
nothing when **two different project instances** (root project + browser clone) both
reference the same `globalSetup` file.

### Why Module-Level Guards Don't Work

The `loadGlobalSetupFiles` function in `packages/vitest/src/node/globalSetup.ts:11` uses
`runner.import(file)` to load each globalSetup file. Each TestProject has its own
`runner` (a Vite `ModuleRunner` instance). `runner.import()` evaluates modules in a
fresh scope per runner -- there is no shared module cache between the root project's
runner and the browser clone project's runner.

This means the module-level `warmedInstances` Set in `global-setup.shared.ts` is
instantiated separately for each invocation. Each `setup()` call sees an empty Set, so
the guard is useless.

## The `vitest.workspace.ts` File Is Irrelevant

The `vitest.workspace.ts` at the repo root:

```ts
export default ['**/vite.config.{mjs,js,ts,mts}', '**/vitest.config.{mjs,js,ts,mts}'];
```

**This file is completely ignored in Vitest 4.** The `resolveProjects()` method in Vitest
4 only checks `this.config.projects` (set programmatically by Angular's plugin) or throws
if `workspace` is in the config. It does NOT scan for `vitest.workspace.ts` files. The
`workspace` config option was deprecated in Vitest 3.2 and removed in Vitest 4.0.

Source: `packages/vitest/src/node/core.ts:541`:

```ts
if ('workspace' in this.config) {
  throw new Error('The `test.workspace` option was removed in Vitest 4...');
}
```

There is zero workspace file auto-discovery code in Vitest 4's runtime.

## Answers to Research Questions

### 1. Does Vitest workspace take precedence over --config flag? Does it merge them?

**Not applicable in Vitest 4.** The `vitest.workspace.ts` file is completely ignored. The
`@angular/build:unit-test` executor does not use `--config` either -- it uses the Node API
`startVitest()` with `config: path` in the options object. The config file is loaded as
the root Vite config, then the Angular plugin's `config` hook reshapes it into `projects`.

### 2. In Vitest browser mode, does globalSetup run once per browser instance or once per test run?

**Once per project instance.** When `browser.instances` is defined, Vitest creates cloned
projects per instance via `resolveBrowserProjects()`. Each cloned project inherits
`globalSetup` from the parent via `deepClone(project.config)`. Additionally,
`initializeGlobalSetup()` ALWAYS adds the root project.

So the count is: **1 (root project) + N (browser project clones with test specs)**.
In this case: 1 root + 1 edge-phi4-mini clone = 2 invocations.

### 3. Is there a known issue with duplicate globalSetup invocations in Vitest 4.x?

Yes, multiple related issues exist:

- [Issue #3255](https://github.com/vitest-dev/vitest/issues/3255): All globalSetup from
  all projects executed when a single test runs (closed, partially fixed)
- [Issue #4174](https://github.com/vitest-dev/vitest/issues/4174): Rewrite global setup
  implementation (closed)
- [Issue #3181](https://github.com/vitest-dev/vitest/issues/3181): globalSetup teardown
  runs twice since v0.30.0

The specific pattern here (root project + browser clone both having globalSetup) may not
have an exact upstream issue. The `initializeGlobalSetup` always-add-root behavior is
intentional -- the comment in `project.ts:654` says:

```ts
// globalSetup can run even if core workspace is not part of the test run
```

This is by design for providing shared context, but it creates a double-invocation when
the root config and a project config share the same `globalSetup` file.

### 4. Would removing vitest.workspace.ts fix the duplicate? What side effects?

**No.** The `vitest.workspace.ts` file is already completely ignored by Vitest 4.1.0.
Removing it has no effect on the globalSetup double invocation. It can be safely removed
as dead configuration.

**Side effects of removal:** None in Vitest 4. If the project were to downgrade to Vitest
3.x (unlikely), the workspace file would be needed. The `@nx/vite` and `@nx/vitest`
plugins in the current version do not reference `vitest.workspace.ts` either.

### 5. Can we configure the workspace to not discover vitest.config.\*.mts files?

**Moot point.** The workspace file is ignored. The real fix addresses the Angular plugin's
config merging behavior. See "Fix Options" below.

## Fix Options

### Option A: Clear globalSetup from root config (Angular plugin fix) -- UPSTREAM

File an issue or PR against `@angular/build` to have `createVitestConfigPlugin` clear
`test.globalSetup` from the root config after merging it into the project:

```js
// In the config hook, after moving testConfig into projectConfig:
return {
    test: {
        globalSetup: [],  // <-- clear root-level globalSetup
        coverage: ...,
        reporters: ...,
        projects: [projectConfig],
    },
};
```

**Confidence:** HIGH -- this is the correct architectural fix.

### Option B: PID-based file marker (current workaround) -- SHIPPED

Use a PID-based marker file (e.g., `.warmup-pid`) in the profile directory to detect when
the same process calls `setup()` twice. Skip on the second invocation.

**Confidence:** HIGH -- already shipped and working. Robust because it uses `process.pid`
to distinguish same-process re-invocation from legitimate separate runs.

### Option C: Module-level singleton guard -- DOES NOT WORK

The existing `warmedInstances` Set in `global-setup.shared.ts` cannot guard against this
because each project's `runner.import()` creates a fresh module scope. The module-level
variable is instantiated independently for each invocation.

### Option D: File a Vitest upstream issue -- RECOMMENDED

The behavior at `core.ts:1120` -- always adding the root project to globalSetup -- is
questionable when the root config has the same globalSetup as a project. This could be
filed as a bug or feature request upstream.

**Recommended:** File an issue describing this interaction between:

1. Programmatic `projects` definition (via Vite plugin config hook)
2. Root config retaining `globalSetup` after the plugin moved it into projects
3. `initializeGlobalSetup()` unconditionally adding root project

## Recommendation for Upstream Issues

### Vitest Issue

**Yes, file a Vitest issue.** The behavior is a genuine bug in the interaction between:

- A Vite plugin that creates `test.projects` from the root `test` config
- The root config retaining `test.globalSetup` even after a plugin moved it into projects
- `initializeGlobalSetup()` always running root project's globalSetup

The fix in Vitest would be one of:

1. Deduplicate globalSetup files across projects (if two projects reference the same
   resolved file path, only run it once)
2. Skip root project's globalSetup when `test.projects` is defined and the root project
   has no test specs queued
3. Document that Vite plugins creating `test.projects` must also clear `test.globalSetup`

### Angular CLI Issue

Also file an `@angular/build` issue to clear `test.globalSetup` from the root config in
`createVitestConfigPlugin`. The plugin already clears `test.projects` and `test.include`
from the user config -- it should also clear `test.globalSetup` (and any other test-level
options that get fully migrated into the project).

### Dead Code Cleanup

The `vitest.workspace.ts` file at the repo root is dead configuration. It should be
removed and a note added to acknowledge that Vitest 4 uses `test.projects` instead.

## Sources

### Vitest Source Code (verified)

- `packages/vitest/src/node/core.ts`
  - `resolveProjects()` at line 528 -- project resolution entry point
  - `initializeGlobalSetup()` at line 1117 -- unconditional root project addition
- `packages/vitest/src/node/project.ts`
  - `_initializeGlobalSetup()` at line 233 -- per-project setup with guard
  - `_teardownGlobalSetup()` at line 262
- `packages/vitest/src/node/projects/resolveProjects.ts`
  - `resolveProjects()` at line 28 -- processes project definitions
  - `resolveBrowserProjects()` at line 203 -- clones projects per browser instance
  - `cloneConfig()` at line 272 -- deep-clones config including globalSetup
- `packages/vitest/src/node/globalSetup.ts`
  - `loadGlobalSetupFiles()` at line 11 -- uses runner.import() per project
- `packages/vitest/src/node/config/resolveConfig.ts`
  - globalSetup path resolution at line 319

### Angular Builder Source (verified)

- `node_modules/@angular/build/src/builders/unit-test/runners/vitest/`
  - `executor.js` -- `VitestExecutor.initializeVitest()` calls `startVitest()`
  - `plugins.js` -- `createVitestConfigPlugin()` moves testConfig into projects
  - `configuration.js` -- `findVitestBaseConfig()` searches for config files

### GitHub Issues

- [Vitest #3255](https://github.com/vitest-dev/vitest/issues/3255) -- all globalSetup from all projects executed
- [Vitest #4174](https://github.com/vitest-dev/vitest/issues/4174) -- rewrite global setup implementation
- [Vitest #3181](https://github.com/vitest-dev/vitest/issues/3181) -- globalSetup teardown runs twice
- [Vitest #5530](https://github.com/vitest-dev/vitest/issues/5530) -- multiple configs in single workspace package
- [Angular CLI #31810](https://github.com/angular/angular-cli/issues/31810) -- runnerConfig experimental status
- [Angular CLI #30429](https://github.com/angular/angular-cli/issues/30429) -- configurable vitest

### Documentation

- [Vitest Migration Guide](https://vitest.dev/guide/migration.html) -- workspace to projects
- [Vitest 3.2 Blog](https://vitest.dev/blog/vitest-3-2.html) -- workspace deprecation
- [Vitest globalSetup Docs](https://vitest.dev/config/globalsetup) -- official docs
- [Vitest Test Projects Guide](https://vitest.dev/guide/projects) -- projects configuration
- [Angular Testing Overview](https://angular.dev/guide/testing) -- unit-test builder
