/skill-creator:skill-creator Improve the angular-developer skill's **Components** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Components** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Components (4 reference files)

After reading every component reference file, the quality is better than expected. `inputs.md` and `outputs.md` are solid — they cover the modern signal APIs (`input()`, `input.required()`, `model()`, `output()`, `OutputEmitterRef`), transforms, aliases, and legacy decorators for migration. `host-elements.md` covers `host` metadata, binding collisions, and `HostAttributeToken`. The main gap is in `components.md` which is missing several core topics.

### Current files — what's actually in them and what's missing

**`components.md` (201 lines)** — Covers component definition, metadata options, using components, template control flow (@if/@for/@switch with exhaustive checking), core concepts (host element, view, standalone, component tree), and style guide conventions (protected for template-only, readonly for Angular-initialized, event handler naming, lifecycle method simplicity, avoid complex template logic). Missing: **content projection** (`<ng-content>`, `select` attribute, multi-slot projection, `@ContentChild`/`@ContentChildren`), **view queries** (`viewChild()`/`viewChildren()` signal API — critical since these are used constantly), **lifecycle hooks** (only `ngOnInit` shown — missing the full list with timing: `ngOnChanges`, `ngDoCheck`, `ngAfterViewInit`, `ngOnDestroy`, etc.), **`@defer` blocks** (covered in performance.md but not mentioned here — should cross-reference).

**`inputs.md` (107 lines)** — Solid. Covers `input()`, `input.required<T>()`, config options (alias, transform with `booleanAttribute`), `model()` for two-way binding, legacy `@Input`, best practices (readonly, required, pure transforms). Missing: `componentRef.setInput()` for setting inputs on dynamically created components.

**`outputs.md` (91 lines)** — Solid. Covers `output()`, `OutputEmitterRef`, alias, programmatic subscription via `viewContainerRef.createComponent()`. Missing: `outputFromObservable()` and `outputToObservable()` for RxJS interop — useful when wrapping Observable-based services.

**`host-elements.md` (80 lines)** — Solid. Covers `host` metadata object with static attrs, attribute/class/style/property/event bindings, legacy decorators, binding collision rules, `HostAttributeToken` with `inject()`. Gaps are minor.

### How to improve

1. Fetch content from angular.dev/guide/components sub-pages for content projection, view queries, and lifecycle hooks
2. Write 2-3 test prompts (e.g., "Create a card component with multi-slot content projection for header, body, and actions using ng-content select", "Build a tabs component that uses viewChildren() to query tab panels and contentChildren() to discover projected tab items", "Create a component that uses ngAfterViewInit to measure its rendered height and ngOnDestroy to clean up a ResizeObserver")
3. Run evals (with-skill vs baseline) to measure current pass rate — content projection and viewChild signals are where models commonly produce outdated patterns
4. Focus improvement on `components.md` (content projection, view queries, lifecycle hooks, @defer cross-reference). Lighter touch on the already-solid `inputs.md` (add setInput), `outputs.md` (add RxJS interop), `host-elements.md` (minimal changes).
5. Re-run evals with improved skill across 10 runs to measure variance
6. Commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/components
- https://angular.dev/guide/components/content-projection
- https://angular.dev/guide/components/queries
- https://angular.dev/guide/components/lifecycle
- https://angular.dev/guide/defer

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md Components section
- `components.md` can grow to 300 lines; other files stay under 150
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
