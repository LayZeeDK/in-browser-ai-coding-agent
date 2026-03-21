# Research: Vitest Browser Instance Filtering with Angular's `@angular/build:unit-test`

**Researched:** 2026-03-21
**Overall confidence:** HIGH (verified against Angular CLI source code + Vitest source code)

## Executive Summary

When `vitest.config.mts` defines multiple `browser.instances`, the Angular builder's `@angular/build:unit-test` executor passes the Nx project name as a `--project` filter to Vitest's `startVitest()`. Vitest's `resolveBrowserProjects()` function explicitly keeps ALL browser instances when the parent project name matches the filter. This is by design in Vitest -- filtering individual instances requires using the instance's own `name` property with `--project`.

The solution is to either: (A) use environment variables in `vitest.config.mts` to conditionally define only one instance, or (B) split into separate Nx targets with separate vitest configs per browser, or (C) use Nx configurations that swap the `runnerConfig` path.

## Root Cause Analysis (Source-Code Verified)

### Flow: Angular Builder to Vitest

1. **Angular executor** (`executor.ts` line 228-267): Calls `startVitest('test', undefined, { project: projectName, ... })` where `projectName` is the Nx project name (`"in-browser-ai-coding-agent"`).

2. **Angular config plugin** (`plugins.ts` line 142-156): Creates a Vitest project with `test.name = projectName`. The external config's `test.browser` (with `instances`) is merged into this project via `mergeConfig`.

3. **Vitest project resolution** (`resolveProjects.ts`): After resolving the project, `resolveBrowserProjects()` is called.

4. **The critical logic** (`resolveProjects.ts`, `resolveBrowserProjects` function):

   ```typescript
   const originalName = project.config.name;
   // if original name is in the --project=name filter, keep all instances
   const filteredInstances = vitest.matchesProjectFilter(originalName)
     ? instances // <-- ALL instances kept when parent name matches
     : instances.filter((instance) => {
         const newName = instance.name!;
         return vitest.matchesProjectFilter(newName);
       });
   ```

5. **Filter matching** (`base.ts`, `wildcardPatternToRegExp`): Converts `"in-browser-ai-coding-agent"` to regex `/^in\-browser\-ai\-coding\-agent$/i` -- exact match. Since the parent project name IS `"in-browser-ai-coding-agent"`, `matchesProjectFilter` returns `true`, and ALL instances are kept.

### Why `--project=edge-phi4-mini` Does NOT Work Through Nx

The `--project` flag is intercepted by Nx, which treats it as an Nx project selector (not a Vitest project selector). Nx does not forward unrecognized flags to the underlying executor because `@angular/build:unit-test` is not `nx:run-commands` -- it's a compiled executor that only processes its own schema options.

The Angular builder's schema (`schema.json`) does NOT have a `project` option. It has: `buildTarget`, `tsConfig`, `runner`, `runnerConfig`, `browsers`, `include`, `exclude`, `filter`, `watch`, `debug`, `ui`, `coverage`, `reporters`, `outputFile`, `providersFile`, `setupFiles`, `progress`, `listTests`, `dumpVirtualFiles`.

### The Angular Builder's Own `browsers` Option vs. External Config

There are two completely separate paths for browser configuration:

| Path                                  | Source                 | How Processed                                                                                                            |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `browsers` in `angular.json`          | Builder schema option  | `setupBrowserConfiguration()` creates `BrowserConfigOptions` and passes to `createVitestConfigPlugin` as `browser` param |
| `test.browser` in `vitest.config.mts` | External runner config | Loaded by Vite as `config.test`, merged into project via `mergeConfig(projectBase, projectOverrides)`                    |

In this project, `browsers` is NOT set in `angular.json` -- only `runnerConfig` points to the external config. So `setupBrowserConfiguration()` returns `{}`, and the entire browser config comes from the external `vitest.config.mts`.

## Solutions (Ranked by Recommendation)

### Solution 1: Environment Variable in `vitest.config.mts` (RECOMMENDED)

Use an environment variable to conditionally include browser instances. This is the simplest approach that works with the existing Angular builder without modifications.

**vitest.config.mts:**

```typescript
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// ... (existing constants) ...

const chromeGeminiNano = {
  browser: 'chromium' as const,
  name: 'chrome-gemini-nano',
  provider: playwright({
    launchOptions: {
      channel: 'chrome-beta',
      args: ['--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano', DISABLE_FEATURES_WITHOUT_OPT_HINTS],
      ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
    },
  }),
};

const edgePhi4Mini = {
  browser: 'chromium' as const,
  name: 'edge-phi4-mini',
  provider: playwright({
    launchOptions: {
      channel: 'msedge-dev',
      args: ['--enable-features=AIPromptAPI', '--disable-features=OnDeviceModelPerformanceParams', DISABLE_FEATURES_WITHOUT_OPT_HINTS],
      ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
    },
  }),
};

const allInstances = [chromeGeminiNano, edgePhi4Mini];

function getInstances() {
  const filter = process.env['VITEST_BROWSER_INSTANCE'];

  if (!filter) {
    return allInstances;
  }

  const filtered = allInstances.filter((i) => i.name === filter);

  if (filtered.length === 0) {
    throw new Error(`Unknown VITEST_BROWSER_INSTANCE="${filter}". ` + `Available: ${allInstances.map((i) => i.name).join(', ')}`);
  }

  return filtered;
}

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances: getInstances(),
    },
  },
});
```

**Nx project.json -- add configurations:**

```json
{
  "test": {
    "executor": "@angular/build:unit-test",
    "options": {
      "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.config.mts"
    },
    "configurations": {
      "chrome-gemini-nano": {},
      "edge-phi4-mini": {}
    }
  }
}
```

**Nx nx.json -- set env per configuration:**
Unfortunately, `@angular/build:unit-test` does not have an `env` option. The environment variable must be set externally.

**Usage from CLI:**

```bash
# Run only edge-phi4-mini
VITEST_BROWSER_INSTANCE=edge-phi4-mini npm exec nx -- test in-browser-ai-coding-agent

# Run only chrome-gemini-nano
VITEST_BROWSER_INSTANCE=chrome-gemini-nano npm exec nx -- test in-browser-ai-coding-agent

# Run both (default)
npm exec nx -- test in-browser-ai-coding-agent
```

**Usage in CI (GitHub Actions):**

```yaml
- name: Test Edge Phi-4-mini
  env:
    VITEST_BROWSER_INSTANCE: edge-phi4-mini
  run: npx nx test in-browser-ai-coding-agent
```

**Pros:**

- No config duplication
- Works with current Angular builder
- Clean CI integration via env vars
- Backward compatible (no env var = run all)

**Cons:**

- Cannot use Nx configurations alone (need external env var)
- Slight runtime overhead from env var check

### Solution 2: Separate Vitest Configs + Nx Configurations

Create separate vitest config files per browser instance, and use Nx configurations to select them.

**vitest.chrome-gemini-nano.config.mts:**

```typescript
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
// ... shared constants ...

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances: [
        {
          browser: 'chromium',
          name: 'chrome-gemini-nano',
          provider: playwright({
            /* ... */
          }),
        },
      ],
    },
  },
});
```

**vitest.edge-phi4-mini.config.mts:**

```typescript
// Same structure, single instance for edge
```

**project.json:**

```json
{
  "test": {
    "executor": "@angular/build:unit-test",
    "options": {
      "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.config.mts"
    },
    "configurations": {
      "chrome-gemini-nano": {
        "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.chrome-gemini-nano.config.mts"
      },
      "edge-phi4-mini": {
        "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.edge-phi4-mini.config.mts"
      }
    }
  }
}
```

**Usage:**

```bash
# Run only edge-phi4-mini
npm exec nx -- test in-browser-ai-coding-agent -c edge-phi4-mini

# Run only chrome-gemini-nano
npm exec nx -- test in-browser-ai-coding-agent -c chrome-gemini-nano

# Run both (default options)
npm exec nx -- test in-browser-ai-coding-agent
```

**Pros:**

- Pure Nx configurations, no env vars needed
- Each config is self-contained and clear
- Works with `nx affected` and caching
- CI can use `-c` flag directly

**Cons:**

- Config duplication (shared constants must be imported from a shared file)
- Three config files to maintain instead of one

### Solution 3: Shared Config with Per-Instance Configs (Best of Both)

Create a shared base module and thin per-instance configs.

**vitest.shared.mts** (not a vitest config, just exports):

```typescript
import { playwright } from '@vitest/browser-playwright';

// ... all shared constants ...

export const chromeGeminiNanoInstance = {
  /* ... */
};
export const edgePhi4MiniInstance = {
  /* ... */
};
export const allInstances = [chromeGeminiNanoInstance, edgePhi4MiniInstance];
```

**vitest.config.mts** (default -- all instances):

```typescript
import { defineConfig } from 'vitest/config';
import { allInstances } from './vitest.shared.mts';

export default defineConfig({
  test: { browser: { enabled: true, instances: allInstances } },
});
```

**vitest.chrome-gemini-nano.config.mts:**

```typescript
import { defineConfig } from 'vitest/config';
import { chromeGeminiNanoInstance } from './vitest.shared.mts';

export default defineConfig({
  test: { browser: { enabled: true, instances: [chromeGeminiNanoInstance] } },
});
```

**vitest.edge-phi4-mini.config.mts:**

```typescript
import { defineConfig } from 'vitest/config';
import { edgePhi4MiniInstance } from './vitest.shared.mts';

export default defineConfig({
  test: { browser: { enabled: true, instances: [edgePhi4MiniInstance] } },
});
```

**project.json:** Same as Solution 2.

**Pros:**

- No duplication of browser config constants
- Clean Nx configuration-based selection
- Each config file is minimal (3-5 lines)

**Cons:**

- Four files instead of one (but each is small)
- `.mts` imports between config files can occasionally cause issues with bundlers

### Solution 4: Separate Nx Targets (Alternative)

Define separate test targets entirely.

**project.json:**

```json
{
  "test": {
    "executor": "@angular/build:unit-test",
    "options": {
      "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.config.mts"
    }
  },
  "test-chrome-gemini-nano": {
    "executor": "@angular/build:unit-test",
    "options": {
      "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.chrome-gemini-nano.config.mts"
    }
  },
  "test-edge-phi4-mini": {
    "executor": "@angular/build:unit-test",
    "options": {
      "runnerConfig": "apps/in-browser-ai-coding-agent/vitest.edge-phi4-mini.config.mts"
    }
  }
}
```

**Pros:**

- Completely independent targets
- Can have different `inputs`, `dependsOn`, caching

**Cons:**

- More verbose project.json
- `nx run-many --target=test` would only run the default (all instances)
- Requires explicit target names in CI

## What Does NOT Work

### Passing `--project` through Nx to Vitest

Nx intercepts `--project` as its own flag. Even if it could be forwarded, the Angular builder's schema doesn't accept it, so it would be ignored. The builder hardcodes `project: projectName` in the `startVitest` call.

### Using the `browsers` Builder Option

The `browsers` option in `angular.json` only supports simple browser names (e.g., `["chromium", "firefox"]`). It creates instances via `setupBrowserConfiguration()` which uses the default `playwright()` provider without custom launch options. You cannot specify `channel`, `args`, or `ignoreDefaultArgs` through this option. The custom Playwright launch options (required for on-device AI model access) can only come from a `runnerConfig` file.

### Vitest's `--project` Flag Directly

Even if you could pass `--project=edge-phi4-mini` to Vitest, the `resolveBrowserProjects` function first checks whether the PARENT project name matches. Since the Angular builder also sets `project: "in-browser-ai-coding-agent"` in the CLI options, the filter would be `["in-browser-ai-coding-agent", "edge-phi4-mini"]` -- the parent name still matches, so all instances still run.

The only way to filter would be to NOT pass the parent project name AND pass the instance name. But the Angular builder always passes the parent project name.

### Using `test.projects` in the External Config

The Angular builder's `createVitestConfigPlugin` explicitly warns and DELETES `test.projects` from the external config:

```typescript
if (testConfig?.projects?.length) {
  this.warn('The "test.projects" option in the Vitest configuration file is not supported.');
  delete testConfig.projects;
}
```

## Recommendation

**Use Solution 1 (env var)** for immediate implementation with minimal changes. It requires changing only `vitest.config.mts` and setting an env var in CI.

**Migrate to Solution 3 (shared + per-instance configs)** if you want pure Nx configuration support without env vars. This is the cleanest long-term approach because:

- Nx configurations (`-c edge-phi4-mini`) are a first-class concept
- CI workflows can use configuration names directly
- Nx caching treats different configurations as separate cache entries
- No external state (env vars) needed

## Key Vitest Concepts (for Context)

### Browser Instances as Projects

Vitest 4.x transforms each `browser.instances` entry into a separate Vitest "project" (TestProject). Each gets a name:

- If instance has `name: "foo"` -> project name is `"foo"`
- If instance has no name, browser name is used -> project name is `"chromium"`
- If parent project has `name: "bar"` and instance has no name -> project name is `"bar (chromium)"`
- If parent project has `name: "bar"` and instance has `name: "foo"` -> project name is `"foo"` (custom name overrides)

### The `--project` Filter

Vitest's `--project` flag uses `wildcardPatternToRegExp` for matching:

- Exact match: `--project=foo` matches only `"foo"` (regex: `/^foo$/i`)
- Wildcard: `--project=foo*` matches `"foo"`, `"foobar"`, `"foo (chromium)"` (regex: `/^foo.*$/i`)
- Negation: `--project=!foo` excludes `"foo"`
- Case insensitive

### `startVitest` API

The Angular builder calls `startVitest(mode, cliFilters, cliOptions, viteOverrides)`:

- `cliOptions.project` is a string (or string array) that maps to `--project`
- `viteOverrides` provides Vite config that takes precedence over file-based config
- The Angular builder passes its own plugins via `viteOverrides.plugins`

## Sources

### Primary (Source Code -- HIGH Confidence)

- Angular CLI `executor.ts`: `D:\projects\github\angular\angular-cli\packages\angular\build\src\builders\unit-test\runners\vitest\executor.ts`
- Angular CLI `plugins.ts`: `D:\projects\github\angular\angular-cli\packages\angular\build\src\builders\unit-test\runners\vitest\plugins.ts`
- Angular CLI `browser-provider.ts`: `D:\projects\github\angular\angular-cli\packages\angular\build\src\builders\unit-test\runners\vitest\browser-provider.ts`
- Angular CLI `options.ts`: `D:\projects\github\angular\angular-cli\packages\angular\build\src\builders\unit-test\options.ts`
- Angular CLI `schema.json`: `D:\projects\github\angular\angular-cli\packages\angular\build\src\builders\unit-test\schema.json`
- Vitest `resolveProjects.ts`: https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/projects/resolveProjects.ts
- Vitest `core.ts` (`matchesProjectFilter`): https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/core.ts
- Vitest `base.ts` (`wildcardPatternToRegExp`): https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/utils/base.ts

### Secondary (Official Docs -- HIGH Confidence)

- [Vitest Browser Mode: Multiple Setups](https://vitest.dev/guide/browser/multiple-setups)
- [Vitest browser.instances Config](https://vitest.dev/config/browser/instances)
- [Vitest CLI Reference](https://vitest.dev/guide/cli)
- [Vitest Test Projects Guide](https://vitest.dev/guide/projects)
- [Vitest Advanced API](https://vitest.dev/advanced/api)

### Tertiary (Community -- MEDIUM Confidence)

- [Vitest Issue #7916: browser.instances fileParallelism](https://github.com/vitest-dev/vitest/issues/7916) -- confirms `--project` workaround for per-instance runs
- [Angular CLI Issue #30429: Configurable vitest](https://github.com/angular/angular-cli/issues/30429)
- [Storybook Issue #32427: browser instances project name conflict](https://github.com/storybookjs/storybook/issues/32427) -- confirms naming behavior
- [Nx: Pass Args to Commands](https://nx.dev/recipes/running-tasks/pass-args-to-commands)
