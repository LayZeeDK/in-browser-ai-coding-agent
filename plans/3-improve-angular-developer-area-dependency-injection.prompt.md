/skill-creator:skill-creator Improve the angular-developer skill's **Dependency Injection** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Dependency Injection** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Dependency Injection (5 reference files)

After reading every DI reference file, the quality is better than line counts suggested. `defining-providers.md` at 72 lines is surprisingly complete (InjectionToken with factory, multi, useExisting, library `provide*` pattern). The main gaps cluster around `DestroyRef`/`takeUntilDestroyed()` (missing entirely) and overlap between `di-fundamentals.md` and `injection-context.md`.

### Current files — what's actually in them and what's missing

**`di-fundamentals.md` (120 lines)** — Covers how DI works (providing vs injecting), service creation with `providedIn: 'root'`, `inject()` function, and where `inject()` is valid (field initializers, constructors, guards, factories). Overlaps significantly with `injection-context.md`. Missing: `DestroyRef` for cleanup (critical gap — this is the modern replacement for `OnDestroy` in services and functional contexts), `takeUntilDestroyed()` RxJS operator.

**`creating-services.md` (97 lines)** — Covers CLI generation, `providedIn: 'root'`, tree-shaking explanation, injecting into components and other services. Missing: `providedIn` options beyond `'root'` (`'platform'`, `'any'`), service lifecycle (when services are created/destroyed), service instance scoping guidance.

**`defining-providers.md` (72 lines)** — Surprisingly complete. Has `InjectionToken` with `providedIn: 'root'` + factory, `useClass`, `useValue`, `useFactory` with `inject()`, `useExisting`, `multi: true`, scopes table, and `provide*` library pattern. Missing: `APP_INITIALIZER` pattern (commonly needed), `ENVIRONMENT_INITIALIZER`.

**`injection-context.md` (63 lines)** — Good coverage of where injection context exists, `runInInjectionContext()` with `EnvironmentInjector`, `assertInInjectionContext()`. Missing: `DestroyRef` + `takeUntilDestroyed()` (should live here since it's about using `inject()` in functional contexts).

**`hierarchical-injectors.md` (43 lines)** — Covers two hierarchy types, resolution phases, resolution modifiers (optional, self, skipSelf, host), providers vs viewProviders. Missing: practical `viewProviders` example with content projection showing the isolation behavior, `createEnvironmentInjector()`.

### How to improve

1. Fetch content from angular.dev/guide/di sub-pages for `DestroyRef` and `takeUntilDestroyed()` patterns
2. Write 2-3 test prompts (e.g., "Create a service that subscribes to an Observable and cleans up properly using DestroyRef and takeUntilDestroyed", "Use viewProviders to isolate a form state service from projected content in a reusable form wrapper component", "Create an APP_INITIALIZER that loads remote configuration before the app starts")
3. Run evals (with-skill vs without-skill) to measure current pass rate — use the eval viewer (`generate_review.py`) so I can review outputs qualitatively, then **WAIT for my review before proceeding**
4. After I approve, focus improvement on `injection-context.md` (add DestroyRef/takeUntilDestroyed), `hierarchical-injectors.md` (viewProviders content projection example), and `defining-providers.md` (APP_INITIALIZER). Reduce overlap between `di-fundamentals.md` and `injection-context.md`.
5. Re-run evals with improved skill — 10 with-skill runs AND 10 without-skill runs to measure variance and comparative lift — generate the eval viewer and **WAIT for my review before proceeding**
6. After I approve the benchmark results, commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/di
- https://angular.dev/guide/di/creating-injectable-service
- https://angular.dev/guide/di/defining-dependency-providers
- https://angular.dev/guide/di/dependency-injection-context
- https://angular.dev/guide/di/hierarchical-dependency-injection

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md DI section
- Keep each reference under 150 lines
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
