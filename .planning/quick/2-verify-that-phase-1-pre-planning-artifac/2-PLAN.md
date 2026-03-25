---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/01-model-abstraction-layer/01-CONTEXT.md
  - .planning/phases/01-model-abstraction-layer/01-RESEARCH.md
  - .planning/phases/01-model-abstraction-layer/01-01-PLAN.md
  - .planning/phases/01-model-abstraction-layer/01-02-PLAN.md
  - .planning/phases/01-model-abstraction-layer/01-VERIFICATION.md
autonomous: true
requirements: []

must_haves:
  truths:
    - 'All Phase 1 artifacts comply with angular-developer skill reference docs'
    - 'No outdated Angular patterns remain in plan instructions'
    - 'Every compliance gap is documented with the specific reference doc it violates'
  artifacts:
    - path: '.planning/phases/01-model-abstraction-layer/01-COMPLIANCE-REVIEW.md'
      provides: 'Compliance review report with findings and remediation actions'
  key_links: []
---

<objective>
Verify that all Phase 1 pre-planning artifacts (01-CONTEXT.md, 01-RESEARCH.md, 01-01-PLAN.md, 01-02-PLAN.md, 01-VERIFICATION.md) comply with the angular-developer skill and its reference docs. Produce a compliance review report and fix any non-compliant patterns in the artifacts.

Purpose: Ensure Claude executors receive Angular 21-compliant instructions that match the project's skill references, preventing downstream implementation errors.
Output: A compliance review report and updated Phase 1 artifacts where needed.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/01-model-abstraction-layer/01-CONTEXT.md
@.planning/phases/01-model-abstraction-layer/01-RESEARCH.md
@.planning/phases/01-model-abstraction-layer/01-01-PLAN.md
@.planning/phases/01-model-abstraction-layer/01-02-PLAN.md
@.planning/phases/01-model-abstraction-layer/01-VERIFICATION.md
@.claude/skills/angular-developer/SKILL.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit Phase 1 artifacts against angular-developer skill references</name>
  <files>
    .planning/phases/01-model-abstraction-layer/01-COMPLIANCE-REVIEW.md
  </files>
  <action>
Read all Phase 1 pre-planning artifacts and cross-reference them against the angular-developer skill reference docs. For each artifact, check every Angular pattern, API usage, and code example against the corresponding reference doc.

**Reference docs to check against (load each as needed):**

- `references/defining-providers.md` -- for `provideModel()`, `makeEnvironmentProviders()`, `provideEnvironmentInitializer()` usage
- `references/signals-overview.md` -- for signal patterns (`signal()`, `computed()`, `asReadonly()`)
- `references/components.md` -- for component metadata, template control flow, style guide (`protected` for template members, `OnPush`, no explicit `standalone: true`)
- `references/testing-fundamentals.md` -- for `await fixture.whenStable()` (not `detectChanges()`), `TestBed` patterns, `Mocked<T>`, signal input testing
- `references/ai-design-patterns.md` -- for signal-based request triggering, `resource.stream` for LLM streaming, loading/error states
- `references/injection-context.md` -- for where `inject()` is valid, `DestroyRef` usage
- `references/effects.md` -- for when to use `effect()` vs `computed()` vs `linkedSignal()`
- `references/resource.md` -- for `resource()` API (experimental in Angular 21.2+), `rxResource` rename in v20+
- `references/di-fundamentals.md` -- for `inject()` function usage
- `references/creating-services.md` -- for `providedIn` options and service lifecycle
- `references/host-elements.md` -- for host binding patterns
- `references/inputs.md` and `references/outputs.md` -- for signal-based inputs/outputs
- `references/accessibility.md` -- for ARIA patterns, focus management

**Specific compliance dimensions to check:**

1. **`provideEnvironmentInitializer` sync constraint**: The defining-providers.md reference states "The callback is not awaited -- it must be synchronous." Verify that the plans account for this when calling `initialize()` (which is async). The fire-and-forget pattern (calling an async function from a sync context) is valid for non-blocking init, but plans should be explicit.

2. **Testing: `await fixture.whenStable()` vs `fixture.detectChanges()`**: testing-fundamentals.md says "Use `await fixture.whenStable()` instead of `fixture.detectChanges()`. The latter is for zone-based apps only." Verify all test code examples and instructions in 01-02-PLAN.md use `whenStable()`.

3. **Component style guide compliance**: components.md says `protected` for template-only members, `readonly` for Angular-initialized properties, no explicit `standalone: true`. Verify the temp component code example follows these.

4. **Signal exposure pattern**: signals-overview.md shows `asReadonly()` for service state exposure. The abstract `ModelService` correctly declares `Signal<T>` (not `WritableSignal<T>`), but verify concrete implementations correctly cast.

5. **AI design patterns awareness**: ai-design-patterns.md shows `resource.stream` for streaming LLM responses. Verify the plans don't use outdated streaming patterns where `resource.stream` would be more appropriate (Phase 1 uses manual `session.prompt()` which is fine, but verify the plan doesn't suggest patterns contradicted by the reference).

6. **`resource()` API availability**: resource.md notes `resource()` is experimental and only available from Angular 21.2+. Verify the plans don't assume `resource()` is available without checking the project's Angular version.

7. **Deprecated patterns check**: Cross-reference every Angular API used in plans against the "State of the Art" table in 01-RESEARCH.md and the skill reference docs. Ensure no deprecated patterns remain.

8. **`ENVIRONMENT_INITIALIZER` vs `provideEnvironmentInitializer()`**: Already flagged in research -- verify CONTEXT.md and all plan references consistently use the non-deprecated version or explicitly note the upgrade.

9. **Template control flow**: Verify `@if`, `@for`, `@switch` usage follows components.md patterns (e.g., `track` requirement on `@for`).

10. **Form patterns**: If any forms are used, verify they follow the correct pattern per the skill (signal forms for Angular 21+, or reactive forms as specified in AGENTS.md).

**Create the compliance review report** at `.planning/phases/01-model-abstraction-layer/01-COMPLIANCE-REVIEW.md` with:

```markdown
# Phase 1 Pre-Planning Compliance Review

**Reviewed:** {date}
**Against:** angular-developer skill v1.0 + reference docs
**Verdict:** {PASS | PASS WITH NOTES | FAIL}

## Summary

{1-2 sentence overview}

## Findings

### {Finding title}

**Severity:** {blocker | warning | info}
**Artifact:** {which .md file}
**Reference:** {which skill reference doc}
**Issue:** {what's wrong}
**Recommendation:** {how to fix}
**Code before / after:** (if applicable)

{Repeat for each finding}

## Compliance Matrix

| Dimension            | Status           | Notes |
| -------------------- | ---------------- | ----- |
| DI patterns          | {PASS/WARN/FAIL} | ...   |
| Signal patterns      | ...              | ...   |
| Component patterns   | ...              | ...   |
| Testing patterns     | ...              | ...   |
| AI design patterns   | ...              | ...   |
| Deprecated API usage | ...              | ...   |
| Template patterns    | ...              | ...   |
| Accessibility        | ...              | ...   |

## Remediation Actions

| #   | Finding | Action | Artifact |
| --- | ------- | ------ | -------- |
| 1   | ...     | ...    | ...      |
```

  </action>
  <verify>
    <automated>test -f ".planning/phases/01-model-abstraction-layer/01-COMPLIANCE-REVIEW.md" && echo "PASS: Review file exists" || echo "FAIL: Review file missing"</automated>
  </verify>
  <done>
    - 01-COMPLIANCE-REVIEW.md exists with structured findings
    - Every Angular pattern in the 5 Phase 1 artifacts has been cross-referenced against the relevant skill reference doc
    - Each finding has severity, artifact, reference doc, issue, and recommendation
    - A compliance matrix covers all 8+ dimensions
    - Remediation actions are listed if any warnings or blockers exist
  </done>
</task>

<task type="auto">
  <name>Task 2: Apply remediation to Phase 1 artifacts</name>
  <files>
    .planning/phases/01-model-abstraction-layer/01-CONTEXT.md,
    .planning/phases/01-model-abstraction-layer/01-RESEARCH.md,
    .planning/phases/01-model-abstraction-layer/01-01-PLAN.md,
    .planning/phases/01-model-abstraction-layer/01-02-PLAN.md,
    .planning/phases/01-model-abstraction-layer/01-VERIFICATION.md,
    .planning/phases/01-model-abstraction-layer/01-COMPLIANCE-REVIEW.md
  </files>
  <action>
For each remediation action identified in the compliance review (Task 1), apply the fix to the corresponding Phase 1 artifact. Only modify lines that address a specific finding -- do not rewrite entire files.

**Known findings to address (from pre-analysis):**

1. **`provideEnvironmentInitializer` sync callback clarity**: In 01-01-PLAN.md and 01-RESEARCH.md, wherever `provideEnvironmentInitializer` is shown calling `initialize()`, add an explicit note: "The `provideEnvironmentInitializer` callback is synchronous per Angular docs (references/defining-providers.md). Calling `model.initialize()` (which returns Promise<void>) is intentional -- the promise is fire-and-forget for non-blocking startup. Do NOT await it."

2. **Testing pattern: `fixture.whenStable()`**: In 01-02-PLAN.md Task 2, ensure all test instructions and code examples use `await fixture.whenStable()` (not `fixture.detectChanges()`). Add explicit note: "Per angular-developer skill testing-fundamentals.md: use `await fixture.whenStable()` instead of `fixture.detectChanges()` -- the latter is for zone-based apps only."

3. **Component style: `protected` keyword**: In 01-02-PLAN.md temp component code example, verify template-bound members (`promptText`, `prompting`, `response`, `error`, `model`) use `protected` access modifier per components.md style guide. The `model` field should be `protected readonly model = inject(ModelService)`.

4. **Template form pattern**: In the temp component template, the `<textarea>` uses raw `(input)` event + `$any()` cast. Per AGENTS.md: "Use Reactive forms, not Template-driven forms." However, this is a minimal Phase 1 temp component -- reactive forms would be overkill. Add a note justifying the choice: "Phase 1 temp component uses simple signal binding (not reactive forms) for minimal plumbing. Phase 3 replaces this entirely."

5. **01-CONTEXT.md `ENVIRONMENT_INITIALIZER` references**: The CONTEXT.md still references `ENVIRONMENT_INITIALIZER` as a locked decision. Add a note under the decision acknowledging the research upgrade to `provideEnvironmentInitializer()`: "Research confirmed `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. Plans use `provideEnvironmentInitializer()` (the Angular 21 replacement) to fulfill the same intent."

6. **Any additional findings** from Task 1 that require artifact changes.

After all changes, update 01-COMPLIANCE-REVIEW.md to mark each remediation as "Applied" with the date.
</action>
<verify>
<automated>git diff --stat .planning/phases/01-model-abstraction-layer/ 2>&1 | tail -10</automated>
</verify>
<done> - All blocker and warning findings from the compliance review have been addressed in the artifacts - Each change is minimal and targeted (no unnecessary rewrites) - 01-COMPLIANCE-REVIEW.md remediation table shows "Applied" status for each action - Phase 1 artifacts are now fully compliant with angular-developer skill references
</done>
</task>

</tasks>

<verification>
After both tasks complete:

1. 01-COMPLIANCE-REVIEW.md exists with structured findings and compliance matrix
2. All remediation actions are marked "Applied"
3. `git diff` shows only targeted changes to Phase 1 artifacts (no unnecessary rewrites)
4. No deprecated Angular patterns remain in plan code examples
5. All test examples use `await fixture.whenStable()` pattern
6. Component examples follow `protected` access modifier convention
   </verification>

<success_criteria>

- A structured compliance review report exists documenting every finding
- All Phase 1 artifacts are updated to comply with angular-developer skill reference docs
- No blocker-severity findings remain unaddressed
- Changes are minimal and surgical -- existing correct patterns are preserved
  </success_criteria>

<output>
After completion, report findings summary to user.
</output>
