# Coding Conventions

**Analysis Date:** 2026-03-24

## Naming Patterns

**Files:**

- Components: `[name].component.ts` (e.g., `model-status.component.ts`)
- Services: `[name].service.ts` (e.g., `language-model.service.ts`)
- Test files: `[name].spec.ts` co-located with source (e.g., `language-model.service.spec.ts`)
- Routes: `app.routes.ts`
- Configuration: `app.config.ts`
- Browser test setup: `browser-warmup.ts`, `global-setup.ts`, `global-setup.chrome.ts`, `global-setup.edge.ts`, `global-setup.shared.ts`
- Directories: kebab-case (e.g., `in-browser-ai-coding-agent`, `browser-profiles`)

**Functions:**

- camelCase for all functions, methods, and async functions
- `private readonly` prefix on injected dependencies in components
- `protected readonly` prefix on component state signals
- Service methods exposed as public (no access modifier)
- Examples: `checkAvailability()`, `downloadModel()`, `prompt()`, `getLaunchOptions()`, `seedLocalState()`

**Variables:**

- camelCase for all variable declarations
- Signal-based state: lowercase names, e.g., `loading = signal(true)`, `availability = signal<ModelAvailability>('unavailable')`
- Constants: UPPER_SNAKE_CASE (e.g., `PLAYWRIGHT_DISABLE_FEATURES`, `AI_IGNORE_DEFAULT_ARGS`, `DISABLE_FEATURES_WITHOUT_OPT_HINTS`)

**Types:**

- PascalCase for interfaces and type aliases
- Union string literal types: PascalCase (e.g., `ModelAvailability`)
- Interface suffix: none (use `BrowserProfile`, not `IBrowserProfile`)
- Examples: `BrowserProfile` (interface), `ModelAvailability` (union string literal type)

## Code Style

**Formatting:**

- Single quotes for strings (Prettier `singleQuote: true` in `.prettierrc`)
- Format enforced by pre-commit hook (`.githooks/pre-commit`) and CI `format` job
- Pre-commit auto-formats and re-stages: `npm exec nx -- format --files`
- Prettier ignores: `dist/`, `coverage/`, `.nx/`, `.angular/`

**Linting:**

- ESLint with Nx flat config (`eslint.config.mjs` at workspace root)
- Per-app configs extend workspace root: `apps/in-browser-ai-coding-agent/eslint.config.mjs`, `apps/in-browser-ai-coding-agent-e2e/eslint.config.mjs`
- Rules: Nx base + TypeScript + JavaScript + Angular + Angular Template presets
- Angular component selector rule: `app-` prefix, kebab-case element (`@angular-eslint/component-selector`)
- Angular directive selector rule: `app` prefix, camelCase attribute (`@angular-eslint/directive-selector`)
- Module boundary enforcement: `@nx/enforce-module-boundaries` with scope/type tag constraints:
  - `scope:shared` can only depend on `scope:shared`
  - `scope:shop` can depend on `scope:shop` and `scope:shared`
  - `scope:api` can depend on `scope:api` and `scope:shared`
  - `type:data` can only depend on `type:data`
- E2E tests use `eslint-plugin-playwright` (`flat/recommended`)
- Run lint: `npm exec nx -- run-many -t lint`

**TypeScript Strictness (from `apps/in-browser-ai-coding-agent/tsconfig.json`):**

- `"strict": true`
- `"noImplicitOverride": true`
- `"noPropertyAccessFromIndexSignature": true`
- `"noImplicitReturns": true`
- `"noFallthroughCasesInSwitch": true`
- `"isolatedModules": true`
- Angular compiler: `strictInjectionParameters`, `strictInputAccessModifiers`, `strictTemplates`
- Do not use `any`; use `unknown` when type is uncertain
- Prefer type inference when obvious; avoid redundant annotations

## Angular Component Conventions

**Decorators:**

- All components are standalone (Angular 21+ default) -- never set `standalone: true`
- Always set `changeDetection: ChangeDetectionStrategy.OnPush`
- Use `host` object for host bindings -- never `@HostBinding`/`@HostListener`
- Use `input()` and `output()` signal functions -- never `@Input`/`@Output` decorators
- Use `inject()` function for dependencies -- never constructor injection

**Templates:**

- Native control flow: `@if`, `@for`, `@switch` -- never `*ngIf`, `*ngFor`, `*ngSwitch`
- `class` bindings, not `ngClass`; `style` bindings, not `ngStyle`
- `async` pipe for observables
- `data-testid` attributes on interactive elements for test selectors

**State:**

- `signal()` for all component state; `computed()` for derived state
- Update signals with `.set()` or `.update()` -- never `.mutate()`
- Declare state signals as `protected readonly` in component class

**Example (from `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`):**

```typescript
@Component({
  selector: 'app-model-status',
  template: `...`,
  styles: `...`,
})
export class ModelStatusComponent implements OnInit {
  private readonly languageModel = inject(LanguageModelService);

  protected readonly loading = signal(true);
  protected readonly availability = signal<ModelAvailability>('unavailable');
  protected readonly responseHtml = computed(() => {
    const md = this.response();
    if (!md) {
      return '';
    }
    return this.sanitizer.bypassSecurityTrustHtml(marked.parse(md, { async: false }) as string);
  });
}
```

**Services:**

- `@Injectable({ providedIn: 'root' })` for singleton services
- Single responsibility per service
- Use `inject()` function, not constructor injection
- Check API availability before calling external APIs; throw descriptive `Error` or return sentinel values

## Import Organization

**Order:**

1. Node.js built-in imports (`node:fs`, `node:path`, etc.)
2. Third-party imports (`@angular/core`, `@nx/devkit`, `@playwright/test`, etc.)
3. Local/alias imports (`@layzeedk/browser-profiles`, relative paths)

**Path Aliases (from `tsconfig.base.json`):**

- `@layzeedk/browser-profiles` maps to `libs/shared/browser-profiles/src/index.ts`

**Module Boundary Workaround:**

- Vite-processed files (`vitest.config.mts`, `global-setup.*.ts`) cannot use tsconfig path aliases -- Nx plugins parse these before Vite resolves them
- Use relative imports with eslint-disable comment:
  ```typescript
  // eslint-disable-next-line @nx/enforce-module-boundaries
  import { allProfiles } from '../../libs/shared/browser-profiles/src/index';
  ```

## Error Handling

**Service layer:**

- Guard API availability and throw explicit `Error` with message:
  ```typescript
  if (!this.isApiSupported) {
    throw new Error('LanguageModel API is not available');
  }
  ```
- Services that check availability return sentinel values (`'unavailable'`) rather than throwing when the API is absent

**Component layer:**

- Catch at component level; store error message in signal for template rendering
- Pattern from `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`:
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
- `data-testid="prompt-error"` element surfaces error to users and tests

**E2E / infrastructure layer:**

- Retry loops with max attempts and delay for flaky OS-level operations (e.g., browser profile lock):
  ```typescript
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      context = await chromium.launchPersistentContext(...);
      break;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  ```
- `console.warn()` on recoverable failures; re-throw on exhausted retries

## Logging

**Framework:** `console` (no structured logging library)

**Prefix convention** -- all log messages carry a bracketed module prefix:

| Prefix                               | File                     | Used for                        |
| ------------------------------------ | ------------------------ | ------------------------------- |
| `[browser-warmup]`                   | `browser-warmup.ts`      | Model warm-up lifecycle         |
| `[fixtures]`                         | `fixtures.ts`            | E2E fixture launch and warm-up  |
| `[global-setup]`                     | `global-setup.shared.ts` | Profile seeding                 |
| `[unit]`                             | `*.spec.ts`              | Test prompt/response capture    |
| `[unit-response]...[/unit-response]` | `*.spec.ts`              | Response capture for CI summary |
| `[e2e]`                              | `prompt.spec.ts`         | E2E prompt/response capture     |

**Duration logging pattern:**

```typescript
const start = Date.now();
// ... operation
const duration = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[browser-warmup] warm-up complete (${duration}s)`);
```

**CI summary capture pattern** -- structured for GitHub Actions job summary extraction:

```typescript
console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);
```

## Comments

**When to comment:**

- JSDoc for all exported functions, interfaces, and classes
- Inline comments for non-obvious constraints (e.g., why a feature flag is set, why headless is forced false)
- Multi-step operations: comment each step
- Reference constraint sources (W3C Prompt API spec, Playwright GitHub issues)

**JSDoc pattern (from `apps/in-browser-ai-coding-agent/vitest.shared.mts`):**

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

**Constraint comments (from `apps/in-browser-ai-coding-agent/vitest.shared.mts`):**

```typescript
// LanguageModel API requires headed mode — headless Chrome exits
// immediately. Vitest defaults to headless in CI and overrides
// launchOptions.headless, so it must be set here.
headless: false,
```

## Function Design

**Size:** Prefer small, focused functions (typically under 30 lines)

**Parameters:**

- Named object parameters for functions with multiple optional options
- Example: `createVitestConfig(options?: { instanceFilter?: string; globalSetup?: string })`
- Optional callback for progress: `onProgress?: (loaded: number, total: number) => void`

**Return values:**

- Explicit return types on all public functions
- Discriminated union types for multi-state results (e.g., `ModelAvailability`)
- `void` return type for async fire-and-forget operations

## Module Design

**Exports:**

- All public APIs use named `export`
- Interfaces and types exported at declaration site

**Barrel files:**

- `src/index.ts` re-exports from `src/lib/` for libs
- Example: `libs/shared/browser-profiles/src/index.ts` exports from `lib/browser-profiles.ts`
- Enables clean import path via tsconfig alias: `import { allProfiles } from '@layzeedk/browser-profiles'`

## CI-Enforced Conventions (`.github/workflows/ci.yml`)

The CI pipeline enforces all conventions on every push to `main` and every pull request:

| Job                    | Command                                           | What it checks                                               |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `format`               | `npm exec nx -- format:check`                     | Prettier formatting (all files, always runs)                 |
| `lint-typecheck-build` | `npm exec nx -- run-many -t lint typecheck build` | ESLint, TypeScript, and build (skipped for non-code changes) |

**Path filter -- non-code files skip expensive jobs:**

Files under `.planning/**`, `.claude/**`, and `plans/**` are excluded from the `changes.code` filter. Commits that only touch these directories skip `lint-typecheck-build`, `build-chrome-image`, and all test jobs.

Custom GitHub Action: `.github/actions/paths-filter/index.mjs` -- computes `git diff --name-only` with pathspec exclusions and outputs a JSON boolean map.

## `.claude/` -- AI Agent Configuration

The `.claude/` directory configures Claude Code behavior for this project:

**`.claude/settings.json`:**

- Enables the `nx@nx-claude-plugins` plugin (Nx MCP server integration)
- Provides `nx-workspace`, `nx-generate` skills to Claude via the Nx AI agents marketplace

**`.claude/skills/angular-developer/SKILL.md`:**

- Invoked when creating components, services, or asking about Angular best practices
- References 40+ Angular-specific markdown docs in `.claude/skills/angular-developer/references/`
- Covers: signals, `linkedSignal`, `resource()`, AI design patterns, forms, DI, routing, accessibility, HTTP, error handling, performance, web workers, animations, Tailwind CSS, testing, CLI

**`.claude/skills/playwright-cli/SKILL.md`:**

- Invoked for E2E test generation and Playwright CLI operations
- References: request mocking, session management, storage state, test generation, tracing, video recording

**`.github/prompts/monitor-ci.prompt.md`:**

- `/monitor-ci` command: orchestrates Nx Cloud CI monitoring with self-healing fix support
- Spawns `ci-monitor-subagent` (`.github/agents/ci-monitor-subagent.agent.md`) to call MCP tools
- Deterministic decision scripts: `ci-poll-decide.mjs`, `ci-state-update.mjs`

## Pre-commit Hook (`.githooks/pre-commit`)

The hook runs automatically on `git commit`. It:

1. Collects staged files: `git diff --cached --name-only --diff-filter=d`
2. Checks formatting: `npm exec nx -- format:check --files <staged>`
3. If unformatted files exist: runs `npm exec nx -- format --files <staged>` then re-stages them with `git add`

This means commits may silently include formatting-only changes. The hook is installed via `npm run prepare` (which runs on `npm install`).

---

_Convention analysis: 2026-03-24_
