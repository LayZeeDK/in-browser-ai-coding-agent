# Coding Conventions

**Analysis Date:** 2026-03-23

## Naming Patterns

**Files:**

- Components: `[name].component.ts` (e.g., `model-status.component.ts`)
- Services: `[name].service.ts` (e.g., `language-model.service.ts`)
- Test files: `[name].spec.ts` co-located with source (e.g., `language-model.service.spec.ts`)
- Routes: `app.routes.ts`
- Configuration: `app.config.ts`
- Browser setup: `browser-warmup.ts`, `global-setup.ts`
- Directories: kebab-case (e.g., `in-browser-ai-coding-agent`, `browser-profiles`)

**Functions:**

- camelCase for all functions, methods, and async functions
- Private methods with `private` or `protected` keywords
- Service methods exposed as public (no prefix)
- Example: `checkAvailability()`, `downloadModel()`, `prompt()`, `getLaunchOptions()`, `seedLocalState()`

**Variables:**

- camelCase for all variable declarations
- Signal-based state: lowercase names, e.g., `loading = signal(true)`, `availability = signal<ModelAvailability>('unavailable')`
- Constants: UPPER_SNAKE_CASE (e.g., `PLAYWRIGHT_DISABLE_FEATURES`, `AI_IGNORE_DEFAULT_ARGS`)
- Example: `availablity`, `downloading`, `downloadProgress`, `promptText`, `responseHtml`, `onProgress`

**Types:**

- PascalCase for interfaces and type definitions
- Union types: PascalCase (e.g., `ModelAvailability`)
- Type suffixes: use `Type` suffix for exported types, no suffix for union types used inline
- Example: `BrowserProfile` (interface), `ModelAvailability` (union type = 'available' | 'downloadable' | 'downloading' | 'unavailable')

## Code Style

**Formatting:**

- Single quotes for strings (`'hello'`, not `"hello"`)
- Prettier configured with `singleQuote: true`
- Enforce via pre-commit hook (`.githooks/pre-commit` runs `nx format` on staged files)

**Linting:**

- ESLint with Nx flat config (`eslint.config.mjs`)
- Rules: Nx base + TypeScript + JavaScript presets
- Module boundary enforcement: `@nx/enforce-module-boundaries` restricts cross-scope dependencies
- Scopes: `scope:shared`, `scope:shop`, `scope:api`
- Ignores: `dist/`, `.playwright-profiles/`, Vite timestamp files

## Import Organization

**Order:**

1. Node.js built-in imports (`node:fs`, `node:path`, etc.)
2. Third-party imports (Angular, @nx, Playwright, etc.)
3. Local imports (relative paths or aliases)

**Path Aliases:**

- `@layzeedk/browser-profiles`: maps to `libs/shared/browser-profiles/src/index.ts`
- Aliases configured in `tsconfig.base.json`
- Used across E2E, Vitest, and scripts

**Example pattern** (from `language-model.service.ts`):

```typescript
import { Injectable } from '@angular/core';

export type ModelAvailability = ...;

@Injectable({ providedIn: 'root' })
export class LanguageModelService { ... }
```

## Error Handling

**Patterns:**

- Throw explicit `Error` with descriptive messages for API unavailability (e.g., `throw new Error('LanguageModel API is not available')`)
- Async methods that may fail: try/catch in consuming code, not in service
- Error UI display: catch at component level, store in signal for rendering
- Example in `model-status.component.ts`:

  ```typescript
  try {
    const result = await this.languageModel.prompt(text);
    this.response.set(result);
  } catch (e) {
    this.error.set(e instanceof Error ? e.message : String(e));
  } finally {
    this.prompting.set(false);
  }
  ```

- Graceful degradation: check API availability before calling
  - `if (!this.isApiSupported) { return 'unavailable'; }`
  - Services return "unavailable" status rather than throwing when API is missing

## Logging

**Framework:** `console` (no logging framework)

**Patterns:**

- `console.log()` for informational messages
- `console.warn()` for warnings (e.g., model warm-up failures)
- Prefixed messages for context: `[browser-warmup]`, `[fixtures]`, `[unit]`, `[unit-response]`
- Long-running operations logged with start/end timestamps in ISO format
- Example from `browser-warmup.ts`:
  ```typescript
  console.log('[browser-warmup] warming up model (first inference may take minutes)...');
  const start = Date.now();
  // ... operation
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[browser-warmup] warm-up complete (${duration}s)`);
  ```

## Comments

**When to Comment:**

- JSDoc comments for exported functions, types, and classes
- Inline comments for non-obvious logic or constraints
- Comments for multi-step processes (e.g., model warm-up, profile seeding)
- Example from `browser-profiles.ts`:
  ```typescript
  /**
   * Seed the profile's Local State with required chrome://flags entries
   * and enable internal debug pages. Creates the profile directory if
   * it doesn't exist (e.g., container with cache miss and no bootstrap).
   */
  export function seedLocalState(profile: BrowserProfile) { ... }
  ```

**JSDoc/TSDoc:**

- Function parameter types in JSDoc (TSDoc for Angular)
- Return type documentation
- `@param` and `@returns` tags
- Example from `vitest.shared.mts`:
  ```typescript
  /**
   * Creates a Vitest config for on-device AI browser testing.
   *
   * @param options.instanceFilter - Instance name to select a single browser.
   *   When omitted, all instances run.
   * @param options.globalSetup - Path to the globalSetup file that seeds the
   *   profile and runs diagnostics. Defaults to the all-browsers setup.
   */
  export function createVitestConfig(options?: { ... }) { ... }
  ```

## Function Design

**Size:**

- Prefer small, focused functions (typically <30 lines)
- Services keep business logic separate from UI concerns
- Utilities (e.g., `seedLocalState()`) perform single responsibility

**Parameters:**

- Named object parameters for functions with multiple options
- Example: `createVitestConfig(options?: { instanceFilter?: string; globalSetup?: string })`
- Async callbacks for long operations: `(loaded: number, total: number) => void`

**Return Values:**

- Explicit return types in all public functions
- Use discriminated unions for status checks (e.g., `ModelAvailability`)
- Avoid `any`, use `unknown` when type is uncertain
- Return plain values, not wrapped objects (services don't return Result<T>)

## Module Design

**Exports:**

- All public APIs use `export` keyword
- Interfaces and types marked as `export`
- Services decorated with `@Injectable({ providedIn: 'root' })`

**Barrel Files:**

- Single source of truth pattern: `index.ts` re-exports from `lib/` subdirectories
- Example: `libs/shared/browser-profiles/src/index.ts` exports from `lib/browser-profiles.ts`
- Used to create clean import paths via tsconfig aliases

**Example structure** (`browser-profiles` lib):

- `src/index.ts` - Public API (barrel export)
- `src/lib/browser-profiles.ts` - Implementation
- Used throughout codebase as single import: `import { allProfiles, getLaunchOptions } from '@layzeedk/browser-profiles'`

## Angular-Specific Conventions

**Components:**

- All components are standalone (Angular 21+ default)
- Use `@Component` decorator with inline templates for single-responsibility components
- Template uses native control flow: `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`, `*ngSwitch`)
- Styles in `styles` property for co-located styling
- `changeDetection: ChangeDetectionStrategy.OnPush` recommended (though not always set, observe in existing code)

**Signals:**

- Use `signal()` for all component state
- Mutable state: `signal(initialValue)` with `.set()` or `.update()`
- Derived state: `computed()` for transformations (e.g., `responseHtml`)
- No `.mutate()` method used

**Services:**

- Inject dependencies via `inject()` function, not constructor injection
- Example: `private readonly languageModel = inject(LanguageModelService);`
- Single responsibility per service

---

_Convention analysis: 2026-03-23_
