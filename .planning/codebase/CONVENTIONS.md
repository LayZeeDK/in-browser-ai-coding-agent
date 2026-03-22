# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**

- TypeScript service classes: PascalCase + `.service.ts` suffix (e.g., `language-model.service.ts`)
- Angular components: PascalCase + `.component.ts` suffix (e.g., `model-status.component.ts`)
- Test files: Base name + `.spec.ts` suffix (e.g., `language-model.service.spec.ts`)
- Configuration files: kebab-case + config name (e.g., `playwright.config.ts`, `vitest.config.mts`)
- Utility/setup files: descriptive camelCase (e.g., `global-setup.ts`, `fixtures.ts`)

**Functions/Methods:**

- camelCase for all functions, methods, and variables
- Async functions are declared as `async` with full type annotations
- Getters/computed properties: camelCase, no `get` prefix (e.g., `protected readonly response = signal('')`)
- Event handlers: `on` + PascalCase action (e.g., `onSubmit()`, `onDownload()`)

**Variables:**

- camelCase for all variable declarations
- Signal names match their domain without suffix: `loading`, `availability`, `response`, `error` (not `loadingSignal`)
- Protected/private members: `private readonly` or `protected readonly` prefix with camelCase name
- Type/interface-related variables: PascalCase (e.g., `ModelAvailability`)

**Types & Interfaces:**

- PascalCase for all types and interfaces (e.g., `type ModelAvailability`, `interface BrowserInstance`)
- Type unions: line breaks after `|` for readability with aligned names
- Generic type parameters: PascalCase (e.g., `<T>`, `<BrowserContext>`)

## Code Style

**Formatting:**

- Tool: Prettier 3.6.2
- Key setting: `"singleQuote": true` (single quotes for string literals, not double quotes)
- Indentation: 2 spaces (Prettier default)
- Line length: Prettier default (80 chars recommended, 100 char soft limit)

**Linting:**

- Tool: ESLint 9.8.0 with Nx plugin + TypeScript ESLint
- Base configs: `@nx/eslint-plugin` flat config (`flat/base`, `flat/typescript`, `flat/javascript`)
- Key rules: Module boundary enforcement via `@nx/enforce-module-boundaries`
- Playwright-specific: `eslint-plugin-playwright` for e2e test best practices

## Import Organization

**Order:**

1. Node.js built-in modules (`node:fs`, `node:path`, `node:crypto`)
2. Third-party npm packages (`@angular/core`, `@playwright/test`, `vitest`)
3. Internal application code (relative or aliased imports)

**Path Aliases:**

- No path aliases configured (baseUrl exists but paths object is empty)
- Use relative imports: `import { ModelStatusComponent } from './model-status.component'`
- Barrel files: Not used; direct imports from component/service files

**Destructuring:**

- Prefer named imports over default imports: `import { TestBed } from '@angular/core/testing'`
- Avoid star imports; use specific named imports

## Error Handling

**Patterns:**

- Async functions use `try`/`catch` blocks with meaningful error messages
- Type guards: `e instanceof Error ? e.message : String(e)` for error type checking (see `model-status.component.ts` line 140)
- Service-level validation: Return early with guard clauses (e.g., `if (!this.isApiSupported) { throw new Error(...) }`)
- Promise-based: Use `finally` blocks to ensure cleanup (e.g., `session.destroy()` in `language-model.service.ts` line 62)

**Blank line placement:**

- Insert blank line before and after `if`/`else` blocks (control flow separation)
- Insert blank line before `return` statements (visual break)
- Skip blank line at start or end of block
- Consecutive control flow statements may be grouped without separation if logically related

## Logging

**Framework:** `console.*` (no logging library; browser context)

**Patterns:**

- Prefixed console output: `[unit]`, `[unit-response]`, `[e2e]`, `[global-setup]`, `[fixtures]` prefixes identify log source in CI
- Structured delimiters for parsed content: `[unit-response]...[/unit-response]` wraps model output (square brackets prevent collision with quotes/backticks in output)
- Diagnostic prefix format: `[component] context: message` (e.g., `[fixtures] chrome-gemini-nano: launching...`)
- No emoji in output (Windows console compatibility)

## Comments

**When to Comment:**

- Document non-obvious architectural decisions (e.g., why ProcessSingleton retry loop exists)
- Explain complex regex patterns or browser API quirks
- Mark workarounds with their tracking issue or context
- Browser-specific behavior differences (Chrome vs Edge)

**JSDoc/TSDoc:**

- Used for function documentation in setup/fixture files
- Document parameter types and return types
- Example: `async function warmUpModel(instance: BrowserInstance)` with context comment above

**Comments on configuration constants:**

- Required: Playwright constants that must match exactly (`PLAYWRIGHT_DISABLE_FEATURES`, `AI_IGNORE_DEFAULT_ARGS`)
- Explain why values are used (e.g., "`@1` not `@2` -- Chrome 147 auto-detects CPU via `@1`")

## Function Design

**Size:**

- Small to medium (prefer < 30 lines for testable units)
- Complex setup: Extract into named helper functions (e.g., `enableInternalDebugPages()`, `warmUpModel()`)

**Parameters:**

- Named parameters preferred; avoid large positional argument lists
- Optional parameters: Use object destructuring with defaults (e.g., `{ onProgress?: (loaded: number, total: number) => void }`)
- Timeout/deadline parameters: Use milliseconds (const TIMEOUT_MS = 600_000)

**Return Values:**

- Async functions return `Promise<T>` explicitly
- Errors propagate via exceptions (throw in sync, Promise rejection in async)
- Type-safe: Use specific union types (e.g., `Promise<ModelAvailability>`) not generic `Promise<any>`

**Async Flow:**

- Use `async`/`await` consistently; avoid `.then()` chains
- Retry loops: `for` with `try`/`catch` and exponential backoff or fixed delay
- No global state; parameters drive behavior

## Module Design

**Exports:**

- Named exports preferred: `export class LanguageModelService`, `export type ModelAvailability`
- Default exports: Only for config files (`export default defineConfig(...)`)
- Service files: Export the service class + any related types/interfaces

**Barrel Files:**

- Not used in this codebase
- Import directly from source files: `import { LanguageModelService } from './language-model.service'`

**Service Structure:**

- Singleton pattern: `@Injectable({ providedIn: 'root' })` for application-wide services
- Method naming: Domain-specific actions (e.g., `checkAvailability()`, `downloadModel()`, `prompt()`)
- Type exports: Group types at top of service file (e.g., `ModelAvailability` union type)

## Angular-Specific Patterns

**Component Structure:**

- Standalone components with `imports: [...]` array
- Inline templates and styles using backtick templates (see `model-status.component.ts`)
- Signal-based reactive state: `signal()`, `computed()`, no RxJS subscriptions in this app
- Template control flow: `@if`, `@switch`, `@case` (Angular 17+)

**Dependency Injection:**

- `inject()` pattern instead of constructor parameters: `private readonly service = inject(ServiceClass)`
- Guard against missing API with service method checks: `if (!this.isApiSupported) { throw ... }`

**Styling:**

- Component-scoped styles in `styles` property
- Data attributes for testing: `[data-testid="status-result"]`, `[data-status]="availability()"`
- Conditional CSS classes: `[attr.data-status]="availability()"`

## Test-Specific Conventions

**Vitest (Unit Tests):**

- Import from `vitest`: `import { describe, it, expect, beforeEach } from 'vitest'`
- Test suite structure: `describe('ClassName', () => { it('should...', () => { ... }) })`
- Test timeouts: `300_000` (5 min) for prompt tests, `30_000` (30 sec) for UI tests, default for others
- Guard tests: Run first in describe block to fail fast before expensive operations

**Playwright (E2E Tests):**

- Custom fixture import: `import { test, expect } from './fixtures'` (not `@playwright/test`)
- Test naming: `test('should...', async ({ persistentPage }) => { ... })`
- Timeout override: `test.setTimeout(600_000)` for long-running tests
- Conditional logic disabling: `// eslint-disable-next-line playwright/no-conditional-in-test` when branching based on model state

**Test Attributes:**

- Use `data-testid` for test selectors (not class names or IDs)
- Query patterns: `page.getByTestId()`, `fixture.nativeElement.querySelector('[data-testid="..."]')`

---

_Convention analysis: 2026-03-22_
