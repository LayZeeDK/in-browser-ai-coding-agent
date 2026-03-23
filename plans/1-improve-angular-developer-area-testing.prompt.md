/skill-creator:skill-creator Improve the angular-developer skill's **Testing** references.

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Testing** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Testing (4 reference files)

After reading every testing reference file, the quality varies significantly. `router-testing.md` is solid; `testing-fundamentals.md` has the biggest practical gap in the entire skill.

### Current files — what's actually in them and what's missing

**`testing-fundamentals.md` (127 lines)** — Covers async-first testing pattern (Act/Wait/Assert), `TestBed` + `ComponentFixture`, `fakeAsync`/`tick`, Vitest timer mocks, provider overrides, `rethrowApplicationErrors`. This file has the **largest gap in the entire skill**: zero coverage of testing signals (`signal()`, `computed()`), testing `resource()` and `httpResource()`, testing components with `input()`/`output()` via `componentRef.setInput()`, service testing patterns, and spy/mock patterns (`vi.fn()`, `vi.spyOn()`).

**`component-harnesses.md` (59 lines)** — Has one Material example (`MatButtonHarness`) with `HarnessLoader` setup. Missing: creating custom harnesses by extending `ComponentHarness`, `TestElement` API for interacting with DOM elements in harnesses, `HarnessPredicate` for filtering, `parallel()` for batch operations. This is the thinnest file in testing and would leave a developer stuck if they need to create their own harness.

**`router-testing.md` (87 lines)** — Actually solid. Full `RouterTestingHarness` setup and usage with `navigateByUrl()`, `harness.router.url` assertions, best practices. Missing: testing guards and resolvers in isolation (without full routing), testing `CanDeactivate` guards.

**`e2e-testing.md` (151 lines)** — Covers both Playwright and Cypress with configuration, test examples, and best practices (test IDs, no arbitrary waits, Page Object mention). Missing: accessibility testing in E2E (axe-playwright), API mocking/interception, multi-browser configuration depth.

### How to improve

1. Fetch content from angular.dev/guide/testing sub-pages to identify precise patterns for signal/resource testing
2. Write 2-3 test prompts (e.g., "Write unit tests for a component that uses resource() to fetch data and displays loading/error/success states", "Create a custom ComponentHarness for a date-range picker component with start/end inputs", "Write a unit test for a service that uses httpResource and verify it handles errors correctly")
3. Run evals (with-skill vs baseline) to measure current pass rate — expect testing-fundamentals to show the biggest delta since models don't reliably know signal testing patterns
4. Focus improvement effort on `testing-fundamentals.md` (signal/resource testing, service testing) and `component-harnesses.md` (custom harness creation). Lighter touch on the already-solid files.
5. Re-run evals with improved skill across 10 runs to measure variance
6. Commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/testing
- https://angular.dev/guide/testing/components-basics
- https://angular.dev/guide/testing/components-scenarios
- https://angular.dev/guide/testing/services

### Project-specific context

This project uses Vitest in browser mode with `@vitest/browser-playwright` (not JSDOM). Tests run in real Chrome Beta and Edge Dev because the LanguageModel API requires a headed branded browser. See `AGENTS.md` for the full testing architecture.

### Constraints

- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md testing section
- `testing-fundamentals.md` can grow to 250 lines; others stay under 150
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
