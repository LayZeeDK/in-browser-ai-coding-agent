/skill-creator:skill-creator Improve the angular-developer skill's **Styling & Animations** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Styling & Animations** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Styling & Animations (3 reference files)

After reading every styling reference file, these are in better shape than expected. `angular-animations.md` is surprisingly thorough — it covers native CSS animations (v20.2+), `animate.enter`/`animate.leave`, event bindings with `AnimationCallbackEvent`, CSS transitions, staggering, programmatic control via `getAnimations()`, and the legacy DSL. `component-styling.md` covers ViewEncapsulation, `:host`, `:host-context`, `::ng-deep` deprecation, and style bindings. `tailwind-css.md` is deliberately focused on v4 migration with agent-specific guidance.

### Current files — what's actually in them and what's missing

**`tailwind-css.md` (69 lines)** — Focused and purposeful. Has automated setup (`ng add tailwindcss`), manual v4 setup (PostCSS config, `@import 'tailwindcss'`), and explicit v3-avoidance guidance for AI agents. Missing: `@apply` usage in component styles (whether it works with Angular's encapsulation), theme customization with CSS variables in v4, dark mode patterns (`@media (prefers-color-scheme: dark)` or class-based).

**`angular-animations.md` (154 lines)** — More thorough than its line count suggests. Covers v20.2+ native CSS (`animate.enter`/`animate.leave` with CSS classes), event bindings for JS animation libraries, CSS transitions for state changes, CSS grid trick for auto-height animation, staggering/parallel patterns, programmatic control, and legacy DSL with `provideAnimationsAsync()`. Missing: `animate.leave` depth (it's mentioned but under-explained vs `animate.enter`), route-specific animation patterns (there's overlap with route-animations.md that could be cross-referenced).

**`component-styling.md` (112 lines)** — Good coverage. ViewEncapsulation modes table (Emulated/ShadowDom/None/ExperimentalIsolatedShadowDom), `:host` and `:host-context` selectors, `::ng-deep` deprecation warning, style bindings (`[class.x]`, `[style.prop]`) with `ngClass`/`ngStyle` avoidance guidance, external styles note. Missing: CSS custom properties for theming across components (pierces Shadow DOM and emulated encapsulation — the modern `::ng-deep` replacement), `::ng-deep` alternatives in detail.

### How to improve

1. Fetch content from angular.dev for styling topics, focusing on CSS custom properties for theming and Tailwind v4 integration depth
2. Write 2-3 test prompts (e.g., "Create a theme system using CSS custom properties that works across components with ViewEncapsulation.Emulated", "Add dark mode support to an Angular + Tailwind CSS v4 project", "Animate a list with staggered enter/leave transitions using native CSS animations (animate.enter/animate.leave)")
3. Run evals (with-skill vs baseline) to measure current pass rate
4. Focus improvement on `component-styling.md` (CSS custom properties theming) and `tailwind-css.md` (dark mode, @apply). `angular-animations.md` needs only minor touches.
5. Re-run evals with improved skill across 10 runs to measure variance
6. Commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/components/styling
- https://angular.dev/guide/animations
- https://angular.dev/guide/tailwind

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md Styling and Animations section
- Keep each reference under 180 lines
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
