/skill-creator:skill-creator Improve the angular-developer skill's **Forms** references (excluding signal-forms.md which is already excellent).

Use all of your capabilities if relevant, including:

- Run evals on the skill
- Improve the skill based on relevant synthetic test cases
- Benchmark the skill across 10 runs and show variance

Notice that the skill covers many different concerns. Only improve the **Forms** concern area.

## Context

The angular-developer skill lives at `.claude/skills/angular-developer/`. It has a SKILL.md that routes to 43 reference files across 14 concern areas. The Reactivity + AI Patterns area was already improved in a previous session — do not modify those 5 files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md).

## Focus: Forms (2 of 3 reference files)

`signal-forms.md` (878 lines) is the strongest reference in the entire skill — **do not modify it**. The other two files need enrichment, particularly `reactive-forms.md` which is missing typed forms (the Angular 14+ default).

### Current files — what's actually in them and what's missing

**`reactive-forms.md` (122 lines)** — Covers core classes (FormControl/FormGroup/FormArray/FormBuilder), setup with `ReactiveFormsModule`, template binding directives, accessing controls, `patchValue()`/`setValue()`, unified `events` observable (v18+), manual state management methods. Missing: **typed forms** (`nonNullable` option on FormBuilder, `FormControl<string>` vs `FormControl<string | null>`, `getRawValue()` for disabled controls returning full type), **custom validators** (sync `ValidatorFn`, async `AsyncValidatorFn`), **cross-field validation** (validator on FormGroup that compares multiple controls), **dynamic forms** (adding/removing controls at runtime beyond the basic FormArray `push`).

**`template-driven-forms.md` (114 lines)** — Covers core directives (NgModel, NgForm, NgModelGroup), setup, two-way binding with `name` requirement, form/control state CSS classes table, validation with template reference variables, submitting, resetting. Missing: custom validator directives (`Validator` interface for template-driven), async validators, comparison guidance on when to use template-driven vs reactive vs signal forms.

### Why this matters

While Angular 21 projects should prefer Signal Forms for new forms, many real-world codebases have existing Reactive Forms that need maintenance. The typed forms gap is the most impactful — models often generate untyped pre-v14 patterns or mishandle `null` in `FormControl<string | null>`. The `nonNullable` FormBuilder option eliminates most null issues but models don't reliably know about it without guidance.

### How to improve

1. Fetch content from angular.dev/guide/forms sub-pages for typed forms and validation patterns
2. Write 2-3 test prompts (e.g., "Create a registration form using typed Reactive Forms with nonNullable FormBuilder, including a custom async username validator that calls the server", "Add cross-field validation to a password form where confirmPassword must match password", "Create a custom required-if validator directive for template-driven forms")
3. Run evals (with-skill vs without-skill) to measure current pass rate — use the eval viewer (`generate_review.py`) so I can review outputs qualitatively, then **WAIT for my review before proceeding**
4. After I approve, focus improvement on `reactive-forms.md` (typed forms with nonNullable, custom validators, cross-field validation). Lighter touch on `template-driven-forms.md` (custom validator directive, forms comparison table).
5. Re-run evals with improved skill — 10 with-skill runs AND 10 without-skill runs to measure variance and comparative lift — generate the eval viewer and **WAIT for my review before proceeding**
6. After I approve the benchmark results, commit changes using atomic commits with detailed descriptions

### Angular.dev source pages

- https://angular.dev/guide/forms
- https://angular.dev/guide/forms/reactive-forms
- https://angular.dev/guide/forms/template-driven-forms
- https://angular.dev/guide/forms/form-validation
- https://angular.dev/guide/forms/typed-reactive-forms

### Constraints

- Do NOT modify `signal-forms.md` — it is already excellent at 878 lines
- Do not modify files outside `.claude/skills/angular-developer/references/` and the SKILL.md forms section
- Keep each reference under 200 lines
- Follow the existing commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored
