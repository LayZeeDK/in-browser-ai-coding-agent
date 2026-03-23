/skill-creator:skill-creator Improve the angular-developer skill's **Security, Accessibility, Error Handling, and Performance** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Security, Accessibility, Error Handling, and Performance** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Best Practices cluster (4 reference files + angular-aria.md)

After reading every file in this cluster, `performance.md` is excellent and needs almost no changes. `security.md` is solid. The main improvement target is `accessibility.md` which covers how to build accessible components but not how to test them. `error-handling.md` has a smaller but real gap around HTTP error patterns.

### Current files — what's actually in them and what's missing

**`accessibility.md` (173 lines)** — Good component patterns: ARIA binding, augmenting native elements (attribute selectors), container pattern for projected native inputs, routing focus management with `NavigationEnd`, `ariaCurrentWhenActive` for links, `@defer` accessibility with `aria-live`, CDK tools (`LiveAnnouncer`, `cdkTrapFocus`, `FocusMonitor`), custom progressbar example. **Main gap**: zero coverage of **accessibility testing** — no Axe/jest-axe integration, no screen reader testing guidance, no `angular-eslint` a11y rules configuration, no Lighthouse a11y audit mention. The skill tells you how to build accessible components but not how to verify accessibility. Also missing: keyboard navigation patterns for custom widgets (arrow key handling, roving tabindex), focus trap patterns for modals/dialogs, `inert` attribute for disabling background content.

**`angular-aria.md` (408 lines)** — Comprehensive guide for the headless Angular Aria component library. Covers Accordion, Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid with imports, directives, and full HTML templates. Missing: when to use Angular Aria vs plain ARIA vs Material components decision guidance.

**`performance.md` (344 lines)** — Excellent. Covers lazy routes (with injection context), `@defer` (triggers, prefetching, timing), `NgOptimizedImage` (priority, responsive, fill, loaders), SSR (server routing, `RenderMode`, `provideServerRendering`, hydration with `withIncrementalHydration`), zoneless (`provideZonelessChangeDetection`, removal of zone.js, compatibility requirements), `OnPush` (triggers, signal interaction), slow computations (computed, pure pipes, @defer), zone pollution (`runOutsideAngular`/`run`), and Chrome DevTools profiling (`enableProfiling`, color-coded tracks). **This file needs almost no changes.** Minor: could add `afterNextRender` for one-time DOM measurement, but it's already in effects.md.

**`security.md` (172 lines)** — Solid. XSS prevention with sanitization + security contexts table, `DomSanitizer` bypass methods, CSP (`autoCsp`, `ngCspNonce`, `CSP_NONCE`), Trusted Types policies table, XSRF with custom config, SSRF prevention with `allowedHosts`, AOT security. Missing: could add `HttpClient` interceptor auth pattern, but that's more of an HTTP guide topic than security.

**`error-handling.md` (113 lines)** — Solid. Callsite-first strategy, custom `ErrorHandler` with analytics, when Angular catches errors list (including `resource()` exception), `provideBrowserGlobalErrorListeners()`, SSR error handling, `rethrowApplicationErrors` for TestBed. Missing: `HttpErrorResponse` handling patterns (typed error responses, status code handling), retry strategies (though these are more RxJS than Angular-specific).

### How to improve

1. Fetch angular.dev content for accessibility testing patterns and keyboard navigation
2. Write 2-3 test prompts (e.g., "Add Axe accessibility testing to an Angular component test suite using jest-axe with TestBed", "Create a modal dialog component with proper focus trapping that returns focus to the trigger element on close", "Configure angular-eslint with accessibility rules and fix the violations it finds")
3. Run evals (with-skill vs without-skill) to measure current pass rate — use the eval viewer (`generate_review.py`) so I can review outputs qualitatively, then **WAIT for my review before proceeding**
4. After I approve, focus improvement almost entirely on `accessibility.md` (add testing section with axe-core, add keyboard navigation patterns, add focus trap for modals). Minor touch on `error-handling.md` (HttpErrorResponse patterns). Leave `performance.md` and `security.md` as-is unless evals reveal issues.
5. Re-run evals with improved skill — 10 with-skill runs AND 10 without-skill runs to measure variance and comparative lift — generate the eval viewer and **WAIT for my review before proceeding**
6. After I approve the benchmark results, commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/best-practices/a11y
- https://angular.dev/best-practices/security
- https://angular.dev/best-practices/error-handling
- https://angular.dev/best-practices/performance

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the relevant SKILL.md sections
- Do not modify `performance.md` unless evals reveal specific issues
- `accessibility.md` can grow to 250 lines; others stay at current size unless gaps found
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
