/skill-creator:skill-creator Improve the angular-developer skill's **Routing** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Routing** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md) — do not modify those files.

## Focus: Routing (9 reference files)

After reading every routing reference file, the quality is more varied than line counts suggest. Some files are solid for their scope; others have specific gaps.

### Current files — what's actually in them and what's missing

**`define-routes.md` (67 lines)** — Covers basic config, URL paths (static, params, wildcard), redirects, titles, route data, nested routes. Missing: `pathMatch: 'full'` vs `'prefix'` explanation (common source of redirect bugs), `provideRouter()` feature functions list.

**`loading-strategies.md` (61 lines)** — Covers eager, lazy (`loadComponent`, `loadChildren`), injection context in loaders. Missing: preloading strategies (`PreloadAllModules`, custom `PreloadingStrategy`), `withPreloading()` router feature.

**`show-routes-with-outlets.md` (68 lines)** — Actually solid. Covers nested outlets, named outlets, lifecycle events (activate/deactivate/attach/detach), `routerOutletData` with `ROUTER_OUTLET_DATA` injection. Gaps are minor.

**`navigate-to-routes.md` (69 lines)** — Covers RouterLink, Router.navigate/navigateByUrl, query params, matrix params. Missing: `withComponentInputBinding()` (documented in data-resolvers.md instead — should be here or cross-referenced), relative navigation depth, `NavigationExtras` options (`state`, `replaceUrl`, `skipLocationChange`).

**`route-guards.md` (52 lines)** — Covers all guard types, functional pattern, return values. Missing: `RedirectCommand` (only mentioned in data-resolvers.md), `CanMatch` vs `CanActivate` decision guidance (when to use which), composing multiple guards.

**`data-resolvers.md` (67 lines)** — Actually good. Has functional resolvers, `withComponentInputBinding()` for component inputs, error handling with `RedirectCommand` and `withNavigationErrorHandler`. Gaps are minor.

**`router-lifecycle.md` (45 lines)** — Clean chronological event list, subscribing pattern, `withDebugTracing()`. Missing: `NavigationSkipped` event, `withRouterConfig()` options.

**`rendering-strategies.md` (44 lines)** — Good CSR/SSG/SSR decision matrix with hydration overview. Missing: `provideClientHydration()` setup (covered in performance.md but should be cross-referenced), incremental hydration + `@defer` interaction.

**`route-animations.md` (56 lines)** — Good View Transitions API coverage with `withViewTransitions()`, CSS customization, `onViewTransitionCreated`. Missing: per-element `view-transition-name` for shared element transitions.

### How to improve

1. Fetch content from angular.dev/guide/routing sub-pages for each file with identified gaps
2. Write 2-3 test prompts (e.g., "Set up lazy-loaded feature routes with PreloadAllModules and a canActivate auth guard that uses RedirectCommand", "Configure withComponentInputBinding so route params and resolved data bind directly to component inputs", "Add pathMatch: 'full' to fix a redirect that's matching too eagerly")
3. Run evals (with-skill vs baseline) to measure current pass rate
4. Enrich files — focus effort on `loading-strategies.md` (preloading), `navigate-to-routes.md` (input binding cross-ref), and `route-guards.md` (RedirectCommand). Lighter touch on already-solid files.
5. Re-run evals with improved skill across 10 runs to measure variance
6. Commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/routing
- https://angular.dev/guide/routing/define-routes
- https://angular.dev/guide/routing/loading-strategies
- https://angular.dev/guide/routing/show-routes
- https://angular.dev/guide/routing/navigate-to-routes
- https://angular.dev/guide/routing/route-guards
- https://angular.dev/guide/routing/data-resolvers
- https://angular.dev/guide/routing/router-lifecycle
- https://angular.dev/guide/routing/rendering-strategies
- https://angular.dev/guide/routing/route-animations

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md routing section
- Keep each reference under 150 lines
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
