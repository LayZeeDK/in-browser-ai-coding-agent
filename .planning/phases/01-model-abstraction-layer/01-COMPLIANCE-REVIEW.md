# Phase 1 Pre-Planning Compliance Review

**Reviewed:** 2026-03-25
**Against:** angular-developer skill v1.0 + reference docs
**Verdict:** PASS WITH NOTES

## Summary

Phase 1 artifacts are largely compliant with the angular-developer skill reference docs. Five findings were identified: two warnings about missing explicit documentation of sync constraints and component style conventions, two informational notes about form pattern justification and signal field conventions, and one warning about the CONTEXT.md still referencing the deprecated `ENVIRONMENT_INITIALIZER` without noting the upgrade to `provideEnvironmentInitializer()`. No blockers were found. All Angular patterns used in the plans align with Angular 21 best practices.

## Findings

### 1. `provideEnvironmentInitializer` sync callback not explicitly documented

**Severity:** warning
**Artifact:** 01-01-PLAN.md, 01-RESEARCH.md
**Reference:** references/defining-providers.md
**Issue:** The defining-providers.md reference states: "The callback is **not** awaited -- it must be synchronous." In both 01-01-PLAN.md (Task 2, Step 4) and 01-RESEARCH.md (Pattern 2, Code Examples), the `provideEnvironmentInitializer` callback calls `inject(ModelService).initialize()` which returns `Promise<void>`. The fire-and-forget pattern (calling an async function from a sync context without `await`) is valid for non-blocking initialization, but neither artifact explicitly documents this constraint or why the pattern is safe.
**Recommendation:** Add an explicit note in 01-01-PLAN.md and 01-RESEARCH.md clarifying: "The `provideEnvironmentInitializer` callback is synchronous per Angular docs (references/defining-providers.md). Calling `model.initialize()` (which returns `Promise<void>`) is intentional -- the promise is fire-and-forget for non-blocking startup. Do NOT await it."

### 2. Component template members missing `protected` access modifier

**Severity:** warning
**Artifact:** 01-RESEARCH.md, 01-02-PLAN.md
**Reference:** references/components.md
**Issue:** The components.md style guide states: "`protected` for template-only members. Public members are the component's API." The temp component code example in 01-RESEARCH.md (Temp Component with Accessible Markup section) shows `export class ModelInfoComponent` with template accessing `model.modelName()`, `promptText()`, `prompting()`, `response()`, `error()`, and methods `onDownload()`, `onSubmit()`. None of these are marked `protected` in the example. In 01-02-PLAN.md (Task 1, Step 3), the component instructions mention `inject(ModelService)` but do not specify the `protected` access modifier.
**Recommendation:** Update the temp component code example and instructions to use `protected` for all template-bound members: `protected readonly model = inject(ModelService)`, `protected readonly promptText = signal('')`, `protected readonly prompting = signal(false)`, `protected readonly response = signal('')`, `protected readonly error = signal('')`, `protected onDownload()`, `protected onSubmit()`.

### 3. `ENVIRONMENT_INITIALIZER` references in CONTEXT.md not annotated with upgrade note

**Severity:** warning
**Artifact:** 01-CONTEXT.md
**Reference:** references/defining-providers.md
**Issue:** 01-CONTEXT.md still references `ENVIRONMENT_INITIALIZER` in three places: line 18 ("Eager initialization at app startup via `ENVIRONMENT_INITIALIZER`"), line 29 ("`ENVIRONMENT_INITIALIZER` bundled inside `provideModel()`"), and line 148 ("Use `ENVIRONMENT_INITIALIZER` for anchor session"). While 01-RESEARCH.md correctly identifies the deprecation and the plans use `provideEnvironmentInitializer()`, the CONTEXT.md -- which records locked user decisions -- does not acknowledge the API upgrade. This creates a discrepancy between the locked decision text and the actual implementation.
**Recommendation:** Add a note under the relevant CONTEXT.md decisions: "Research confirmed `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. Plans use `provideEnvironmentInitializer()` (the Angular 21 replacement) to fulfill the same intent."

### 4. Temp component form pattern lacks justification note

**Severity:** info
**Artifact:** 01-02-PLAN.md
**Reference:** AGENTS.md (project instructions)
**Issue:** AGENTS.md states "Use Reactive forms, not Template-driven forms." The temp component uses raw signal binding with `<textarea [value]="promptText()" (input)="promptText.set($any($event.target).value)">` -- neither reactive forms nor template-driven forms, but a direct signal-to-DOM binding. This is a valid choice for a minimal Phase 1 temp component that Phase 3 replaces entirely, but the plan does not document why reactive forms were not used.
**Recommendation:** Add a brief note in 01-02-PLAN.md Task 1: "Phase 1 temp component uses simple signal binding (not reactive forms) for minimal plumbing. Phase 3 replaces this component entirely."

### 5. Signal fields should use `readonly` modifier

**Severity:** info
**Artifact:** 01-RESEARCH.md, 01-02-PLAN.md
**Reference:** references/components.md
**Issue:** The components.md style guide states: "`readonly` for Angular-initialized properties (`input()`, `output()`, `model()`, `viewChild()`, etc.)." While `signal()` is not Angular-initialized in the same sense as `input()`, applying `readonly` to signal fields is a consistent convention that prevents accidental reassignment. The temp component code example does not show `readonly` on the local signal fields (`promptText`, `prompting`, `response`, `error`).
**Recommendation:** Use `readonly` on all signal fields in the temp component: `protected readonly promptText = signal('')`. This is already done for the `model` field in some examples but not consistently.

## Compliance Matrix

| Dimension            | Status | Notes                                                                                                                                                                                                                        |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DI patterns          | PASS   | `provideModel()` + `makeEnvironmentProviders()` + `provideEnvironmentInitializer()` all correct per defining-providers.md. Abstract class as lightweight DI token per DI docs.                                               |
| Signal patterns      | PASS   | `signal()`, `computed()`, `Signal<T>` (readonly) exposure all correct per signals-overview.md. `asReadonly()` not needed since abstract class declares `Signal<T>`.                                                          |
| Component patterns   | WARN   | Missing `protected` on template-bound members. Missing `readonly` on signal fields. Otherwise correct: `OnPush`, no explicit `standalone: true`, `inject()` function.                                                        |
| Testing patterns     | PASS   | 01-02-PLAN.md uses `await fixture.whenStable()` pattern (not `detectChanges()`). `Mocked<T>` not used but `MockModelService` class pattern is valid. `page.getByRole()` for accessible queries.                              |
| AI design patterns   | PASS   | Phase 1 correctly uses manual `session.prompt()`/`session.promptStreaming()`. Does not misuse `resource.stream` -- deferred to appropriate future phase.                                                                     |
| Deprecated API usage | WARN   | Plans correctly use `provideEnvironmentInitializer()`, but CONTEXT.md still references deprecated `ENVIRONMENT_INITIALIZER` without upgrade note. 01-RESEARCH.md State of the Art table correctly documents the deprecation. |
| Template patterns    | PASS   | Uses `@if`, `@else if`, `@else` correctly. No `@for` used (no `track` needed). No `*ngIf`/`*ngFor` directives.                                                                                                               |
| Accessibility        | PASS   | Semantic HTML (`<dl>`, `<dt>`, `<dd>`, `<section aria-label>`, `<p role="alert">`, `aria-live="polite"`). No `data-testid` attributes. Accessible query patterns in tests.                                                   |
| Form patterns        | INFO   | Temp component uses raw signal binding, not reactive forms. Justified as minimal Phase 1 throwaway code but lacks explicit justification note.                                                                               |
| Injection context    | PASS   | `inject()` used in field initializers (correct per injection-context.md). `provideEnvironmentInitializer` callback runs in injection context (correct).                                                                      |
| `resource()` API     | PASS   | Not used in Phase 1 plans. Plans do not assume `resource()` availability.                                                                                                                                                    |

## Remediation Actions

| #   | Finding                                 | Action                                                           | Artifact                      | Status             |
| --- | --------------------------------------- | ---------------------------------------------------------------- | ----------------------------- | ------------------ |
| 1   | Sync callback constraint not documented | Add explicit note about fire-and-forget pattern                  | 01-01-PLAN.md, 01-RESEARCH.md | Applied 2026-03-25 |
| 2   | Missing `protected` on template members | Note to use `protected` access modifier                          | 01-RESEARCH.md, 01-02-PLAN.md | Applied 2026-03-25 |
| 3   | CONTEXT.md deprecated API reference     | Add upgrade note acknowledging `provideEnvironmentInitializer()` | 01-CONTEXT.md                 | Applied 2026-03-25 |
| 4   | Form pattern justification missing      | Add note about signal binding choice                             | 01-02-PLAN.md                 | Applied 2026-03-25 |
| 5   | Signal fields missing `readonly`        | Note to use `readonly` on signal fields                          | 01-RESEARCH.md, 01-02-PLAN.md | Applied 2026-03-25 |
