# Coding Conventions

**Analysis Date:** 2026-03-20

## Naming Patterns

**Files:**

- Components: `{name}.component.ts` (e.g., `model-status.component.ts`)
- Services: `{name}.service.ts` (e.g., `language-model.service.ts`)
- Tests: `{name}.spec.ts` (e.g., `app.spec.ts`)
- Configuration: `{name}.config.ts` (e.g., `app.config.ts`)
- Routes: `{name}.routes.ts` (e.g., `app.routes.ts`)
- E2E tests: `{name}.spec.ts` in e2e directory (e.g., `example.spec.ts`)

**Classes/Exports:**

- Components: PascalCase with "Component" suffix (e.g., `ModelStatusComponent`)
- Services: PascalCase with "Service" suffix (e.g., `LanguageModelService`)
- Types: PascalCase (e.g., `ModelAvailability`)
- Constants: camelCase or PascalCase depending on scope

**Functions:**

- camelCase for all function names (e.g., `checkAvailability`, `bootstrapApplication`)
- Event handlers and lifecycle hooks use native Angular naming (e.g., `ngOnInit`)

**Variables:**

- camelCase for all variables and properties (e.g., `loading`, `availability`)
- Private fields: camelCase with `private` keyword (e.g., `private readonly languageModel`)
- Protected fields: camelCase with `protected` keyword (e.g., `protected readonly loading`)

**Types:**

- Union types: PascalCase (e.g., `ModelAvailability`)
- Type names follow domain language

## Code Style

**Formatting:**

- Tool: Prettier 3.6.2
- Config: `.prettierrc`
- Single quotes enabled: `"singleQuote": true`

**Linting:**

- Tool: ESLint 9.8.0
- Config: `eslint.config.mjs` (flat config format)
- Base configs: `@nx/eslint-plugin` flat configs
  - `@nx/eslint-plugin/flat/base`
  - `@nx/eslint-plugin/flat/typescript`
  - `@nx/eslint-plugin/flat/javascript`
- Key rules:
  - `@nx/enforce-module-boundaries`: enabled with dependency constraints
  - Scope tags: `scope:shared`, `scope:shop`, `scope:api`
  - Type tags: `type:data`

**TypeScript Strict Mode:**

- Strict mode enabled at all levels
- `noImplicitOverride`: true
- `noPropertyAccessFromIndexSignature`: true
- `noImplicitReturns`: true
- `noFallthroughCasesInSwitch`: true
- Angular strict template checking enabled
- Angular strict injection parameters enabled

## Import Organization

**Order:**

1. Angular core/platform packages (e.g., `@angular/core`, `@angular/router`)
2. Other framework packages (e.g., RxJS with `@angular/common`, `@angular/forms`)
3. Local application imports (relative paths)

**Example:**

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LanguageModelService } from './language-model.service';
```

**Path Aliases:**

- Not currently configured in `tsconfig.base.json`
- Use relative paths or full paths from workspace root

## Error Handling

**Patterns:**

- Try-catch for async operations in component lifecycle hooks (implicit error handling in Bootstrap)
- Direct error propagation for service methods
- Async errors handled at component level during initialization
- Example from `main.ts`:
  ```typescript
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
  ```

**UI Error Display:**

- No explicit error UI implemented
- Fallback to safe defaults (e.g., `'unavailable'` for model status)

## Logging

**Framework:** `console` (native browser)

**Patterns:**

- Use `console.error()` for critical failures (e.g., bootstrap errors)
- No custom logging abstraction layer in place
- No structured logging configured

## Comments

**When to Comment:**

- Complex browser feature flag logic (e.g., `vitest.config.mts` Playwright config)
- Non-obvious business logic related to on-device AI APIs
- Configuration explanations for unusual setup (e.g., disabled browser features)

**JSDoc/TSDoc:**

- Not systematically used
- TypeScript types serve as documentation (e.g., `ModelAvailability` union type)

## Function Design

**Size:**

- Prefer small functions (most functions in this codebase are under 10 lines)
- Services have single responsibility (e.g., `LanguageModelService` only handles model availability)

**Parameters:**

- Minimal parameters, prefer dependency injection
- Services use constructor injection via `@Injectable({ providedIn: 'root' })`
- Components use `inject()` function for runtime injection (e.g., `private readonly languageModel = inject(LanguageModelService)`)

**Return Values:**

- Use type-safe returns (e.g., `Promise<ModelAvailability>` not `Promise<any>`)
- Prefer union types over nullable returns where appropriate
- Example: `async checkAvailability(): Promise<ModelAvailability>`

## Module Design

**Exports:**

- Each file has single primary export (class, constant, or interface)
- Export type definitions alongside implementation in service files
- Example: `export type ModelAvailability = 'available' | 'downloadable' | 'unavailable'`

**Component Structure:**

- Component imports and providers defined at component level
- Angular standalone components preferred (no `NgModule` usage)
- Example from `app.ts`:
  ```typescript
  @Component({
    imports: [ModelStatusComponent, RouterModule],
    selector: 'app-root',
    templateUrl: './app.html',
    styleUrl: './app.css',
  })
  ```

**Service Design:**

- Services are singletons provided at root level: `@Injectable({ providedIn: 'root' })`
- No constructor dependency chains

## State Management

**Angular Signals:**

- Used for component state (e.g., `signal(true)` for loading state)
- Type-safe signal declarations: `protected readonly loading = signal(true)`
- Updated via `signal.set(value)` method
- Read via function call: `loading()` in template

**Reactive Updates:**

- Signals used instead of RxJS for this codebase
- Template change detection automatic with signals
- Example from `model-status.component.ts`:

  ```typescript
  protected readonly loading = signal(true);
  protected readonly availability = signal<ModelAvailability>('unavailable');

  async ngOnInit(): Promise<void> {
    const status = await this.languageModel.checkAvailability();
    this.availability.set(status);
    this.loading.set(false);
  }
  ```

## Angular Specifics

**Template Syntax:**

- New control flow syntax: `@if`, `@else`, `@switch`, `@case` (Angular 17+)
- Inline templates preferred for small components
- Data binding attributes for testing: `[attr.data-status]`, `data-testid`

**Decorators:**

- `@Component`: with `imports` array, `selector`, `template`/`templateUrl`, and `styles`/`styleUrl`
- `@Injectable`: with `providedIn: 'root'` for singletons
- No `@Input`, `@Output` decorators used (signals-based approach in newer code)

---

_Convention analysis: 2026-03-20_
