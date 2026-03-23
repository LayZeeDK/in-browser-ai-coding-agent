# Research: Nx-Conventional Approach for Sharing TypeScript Between App Projects

**Domain:** Nx monorepo code sharing
**Researched:** 2026-03-23
**Overall confidence:** HIGH

## Executive Summary

The Nx-conventional way to share a TypeScript module between two app projects is to extract it into a **library project** under `libs/`. This is not just a convention -- it is a hard requirement imposed by the `@nx/enforce-module-boundaries` ESLint rule, which:

1. **Forbids relative/absolute imports across project boundaries** (error: `noRelativeOrAbsoluteImportsAcrossLibraries`)
2. **Forbids importing from app projects** (error: `noImportsOfApps`)
3. **Forbids importing from e2e projects** (error: `noImportsOfE2e`)

A bare `tsconfig.base.json` path alias without a corresponding Nx project in the project graph will NOT satisfy `enforce-module-boundaries`. The rule resolves imports against the Nx project graph, not the TypeScript compiler. If an import resolves to a path inside another project (via relative path or file resolution), the rule flags it.

## Key Findings

### 1. Create a Library with `@nx/js:lib` -- Not `@nx/node:lib`

Use `@nx/js:lib` because the file (`browser-profiles.ts`) is plain TypeScript with Node.js APIs. `@nx/node:lib` adds unnecessary Node.js application scaffolding (Express, etc.). `@nx/js:lib` is the canonical choice for framework-agnostic TypeScript.

**Recommended command:**

```bash
npm exec nx -- g @nx/js:lib libs/shared/browser-profiles \
  --bundler=none \
  --unitTestRunner=none \
  --tags="scope:shared" \
  --minimal
```

This creates a non-buildable library (no build step, no test runner). The `--bundler=none` flag means the library is consumed directly via TypeScript path aliases -- no compilation step required. This is the lightest-weight option.

**What gets generated:**

- `libs/shared/browser-profiles/src/index.ts` -- barrel file (re-exports)
- `libs/shared/browser-profiles/src/lib/` -- source directory (move `browser-profiles.ts` here)
- `libs/shared/browser-profiles/project.json` -- registers project in Nx graph
- `libs/shared/browser-profiles/tsconfig.json` -- project tsconfig
- `libs/shared/browser-profiles/tsconfig.lib.json` -- build tsconfig
- `tsconfig.base.json` -- updated with path alias

**What gets added to `tsconfig.base.json`:**

```json
{
  "compilerOptions": {
    "paths": {
      "@in-browser-ai-coding-agent/shared/browser-profiles": ["libs/shared/browser-profiles/src/index.ts"]
    }
  }
}
```

### 2. Minimal Lib Setup

For sharing a single TypeScript file, the minimal setup is:

```
libs/shared/browser-profiles/
  src/
    index.ts              # export * from './lib/browser-profiles';
    lib/
      browser-profiles.ts # the actual file (moved from apps/)
  project.json            # { "name": "shared-browser-profiles", "projectType": "library", "tags": ["scope:shared"] }
  tsconfig.json           # extends ../../tsconfig.base.json
  tsconfig.lib.json       # for type checking
```

The barrel file (`index.ts`) is critical -- `enforce-module-boundaries` uses it to determine what is publicly exported from the library. Anything not re-exported from `index.ts` is considered private.

### 3. A Bare tsconfig Path Alias Does NOT Satisfy `enforce-module-boundaries`

**Verified by reading the rule source code (v22.6.0).**

The rule works as follows:

1. For each import statement, it extracts the import specifier string (`imp`)
2. It checks the `allow` whitelist first -- if matched, all checks are skipped
3. For relative imports, it resolves the target file and maps it to a project using `projectRootMappings`
4. For npm-scope imports, it uses `targetProjectLocator` to find the project
5. If the target resolves to a different project, it reports `noRelativeOrAbsoluteImportsAcrossLibraries`
6. If the target project type is `app`, it reports `noImportsOfApps`
7. If the target project type is `e2e`, it reports `noImportsOfE2e`

A tsconfig path alias pointing to a directory without a `project.json` either:

- **Is not in the project graph**, so the rule cannot find it as a target project, or
- **Resolves into another project's root**, triggering the cross-project import error

Either way, it does not work. You need a real Nx library project.

### 4. The `allow` Option Can Bypass All Checks, But Should Not Be Used Here

The `allow` array in the ESLint config matches against the raw import specifier string. If matched, the import skips ALL boundary checks (including the app/e2e import bans).

**Current config already uses `allow`:**

```javascript
allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'];
```

You _could_ add a pattern like `'^\\.\\./.*/browser-profiles$'` to whitelist the relative import. But this:

- Defeats the purpose of module boundaries
- Creates a precedent for bypassing rules
- Does not scale as more shared code emerges
- Silences ALL checks for the matched import (circular deps, tag constraints, etc.)

**Verdict:** Do not use `allow` for this. Create a library.

### 5. Tag Configuration for `enforce-module-boundaries`

The current workspace has these `depConstraints`:

```javascript
depConstraints: [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:shop', onlyDependOnLibsWithTags: ['scope:shop', 'scope:shared'] },
  { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'] },
  { sourceTag: 'type:data', onlyDependOnLibsWithTags: ['type:data'] },
];
```

**Current app project tags:** Both `in-browser-ai-coding-agent` and `in-browser-ai-coding-agent-e2e` have `tags: []` (empty). Projects without tags matching any constraint are allowed to depend on any project (the rule only fires when a matching `sourceTag` constraint exists and the target violates `onlyDependOnLibsWithTags`).

**However**, the `noImportsOfApps` and `noImportsOfE2e` checks fire REGARDLESS of tags. These are hard-coded checks that run after the `allow` whitelist and before tag constraint checks.

**Recommended tags for the new lib:** `scope:shared`

This ensures:

- The library can only depend on other `scope:shared` libraries (not on app code)
- Both app projects can import from it (since they have no constraints blocking `scope:shared`)

### 6. What About the E2E Project Importing From the Lib?

The current e2e project has `projectType: "application"`. It has no `sourceTag` matching any constraint, so `depConstraints` won't block it from importing the shared lib. The only issue was the cross-project relative import, which is resolved by extracting to a library with a tsconfig path alias.

## Recommended Approach

1. Generate the library:

   ```bash
   npm exec nx -- g @nx/js:lib libs/shared/browser-profiles \
     --bundler=none --unitTestRunner=none --tags="scope:shared" --minimal
   ```

2. Move `browser-profiles.ts` to `libs/shared/browser-profiles/src/lib/browser-profiles.ts`

3. Update the barrel file `libs/shared/browser-profiles/src/index.ts`:

   ```typescript
   export * from './lib/browser-profiles';
   ```

4. Update imports in consuming projects:

   ```typescript
   // Before (violates enforce-module-boundaries):
   import { ... } from '../../in-browser-ai-coding-agent/browser-profiles';

   // After:
   import { ... } from '@in-browser-ai-coding-agent/shared/browser-profiles';
   ```

5. The within-app imports change too:

   ```typescript
   // Before:
   import { ... } from './browser-profiles';

   // After:
   import { ... } from '@in-browser-ai-coding-agent/shared/browser-profiles';
   ```

## Alternatives Considered and Rejected

| Approach                            | Why Rejected                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Bare tsconfig path alias            | Does not create an Nx project; `enforce-module-boundaries` won't recognize it |
| `allow` whitelist in ESLint         | Bypasses ALL boundary checks; doesn't scale                                   |
| `@nx/node:lib` generator            | Unnecessary Node.js scaffolding; `@nx/js:lib` is lighter                      |
| Keep in app, duplicate in e2e       | Violates DRY; drift risk                                                      |
| Disable `enforce-module-boundaries` | Loses all boundary enforcement                                                |

## `enforceBuildableLibDependency` Consideration

The workspace has `enforceBuildableLibDependency: true`. Using `--bundler=none` creates a non-buildable library. This means a **buildable** library cannot import from this library. However, neither the app nor the e2e project is a library, so this constraint does not apply here. If a buildable library later needs to import `browser-profiles`, the lib would need a bundler (use `--bundler=tsc`).

## Sources

- [Enforce Module Boundaries | Nx](https://nx.dev/docs/features/enforce-module-boundaries) -- HIGH confidence
- [Enforce Module Boundaries ESLint Rule | Nx](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries) -- HIGH confidence
- [@nx/js:library Generator | Nx](https://nx.dev/nx-api/js/generators/library) -- HIGH confidence
- [TypeScript Project Linking | Nx](https://nx.dev/docs/concepts/typescript-project-linking) -- HIGH confidence
- Source code: `node_modules/@nx/eslint-plugin/src/rules/enforce-module-boundaries.js` (v22.6.0) -- HIGH confidence (direct verification)
- Source code: `node_modules/@nx/eslint-plugin/src/utils/runtime-lint-utils.js` (v22.6.0) -- HIGH confidence
