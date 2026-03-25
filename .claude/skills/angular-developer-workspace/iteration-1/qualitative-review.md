# Qualitative Review -- Angular Developer Skill Gap Analysis

## Methodology

Reviewed all 36 output files (18 evals x 2 configs) with full reads. Assessed code
quality, correctness, Angular 21 convention adherence, completeness, and edge cases
beyond what formal assertions capture.

---

## Representative Sample Reviews

### 1. attr-directive (Eval 1) -- Well-known topic

**with_skill** (24 lines): Clean, minimal. Uses `host` metadata, `input('yellow')`,
signal for internal state. No standalone:true. Correct.

**without_skill** (23 lines): Nearly identical quality. Uses `readonly` on input and
signal (slightly more correct). Uses `null` instead of empty string for mouseleave
(slightly better semantics).

**Verdict:** Baseline is marginally better (readonly, null semantics). Both excellent.

---

### 2. structural-directive (Eval 2) -- Moderate complexity

**with_skill** (43 lines): Uses `input.required<number>()` + `effect()` for reactive
re-rendering. Typed `RepeatContext` interface. `ngTemplateContextGuard` for type safety.

**without_skill** (49 lines): Uses `@Input` setter (legacy decorator) instead of
`input()`. Still uses `inject()` for TemplateRef/ViewContainerRef. Adds `appRepeat`
count to context (extra feature). `ngTemplateContextGuard` present.

**Verdict:** With-skill uses more modern API (input.required + effect). Baseline uses
legacy @Input setter but is functionally correct. Minor quality gap in favor of
with-skill, but baseline still fully functional.

---

### 3. host-directives (Eval 3) -- Advanced API

**with_skill** (173 lines): Full CdkTooltip/CdkFocusable directive implementations
with host bindings, then ButtonComponent composing both. Shows aliasing syntax
('cdkTooltipText: tooltipText'), selective exposure, inject() for programmatic access.
Includes styles and usage example.

**without_skill** (164 lines): Same structure. Also includes inject() for programmatic
access (commented). Uses EventEmitter import (unused -- minor quality issue). Uses
`role='button'` host binding and `:host(:focus-visible)` styles.

**Verdict:** Both comprehensive and correct. Baseline has an unused import. With-skill
has cleaner ButtonComponent (disabled state, aria-disabled). Marginal.

---

### 4. style-patterns (Eval 6) -- Code refactoring

**with_skill** (35 lines): Radical refactor using `httpResource()` instead of manual
subscribe. Replaces `console.log` with `output<User>()`. Uses `usersResource.hasValue()`,
`usersResource.isLoading()`, `usersResource.error()` for complete state handling.
Track by `user.id`.

**without_skill** (38 lines): Conservative refactor. Keeps subscribe pattern but uses
`inject(HttpClient)`. Uses `signal<User[]>([])` with `.set()`. Keeps `console.log`.
Uses `track user` (reference identity -- worse per Angular docs). No loading/error states.

**Verdict:** With-skill is significantly better: httpResource, output(), track by id,
loading/error states. Baseline misses several improvements. This is where the skill
adds clear value through its reference content steering the model toward modern patterns.

**Key insight:** The skill doesn't add knowledge the model lacks -- it steers toward
the best patterns when multiple valid approaches exist.

---

### 5. defer-nested-prefetch (Eval 9) -- Hard test

**with_skill** (350+ lines): Full 3-level nested components with @defer blocks inside
child templates. Comprehensive test suite: getDeferBlocks scoping, nested access,
error blocking, full chain, Playthrough, independent state rendering per level (9 tests
for 3 states x 3 levels). Uses `whenStable()`.

**without_skill** (400+ lines): Puts all @defer blocks in the DashboardComponent
template (different architecture but valid for testing). Also comprehensive: mixed state
combinations, signal-gated Playthrough. Uses `detectChanges()`.

**Verdict:** Both produce correct, comprehensive tests. Architectural choice differs
(nested in child components vs flat in host) but both are valid testing approaches.
With-skill uses async-first pattern (whenStable) per the skill's testing reference.

---

### 6. i18n-icu (Eval 11) -- Specialized topic

**with_skill** (110+ lines): i18n attribute with meaning|description, ICU plural with
=0/=1/few/other, ICU select for gender, i18n-placeholder/i18n-title, $localize in
computed signal and methods with `:meaning|description:` syntax.

**without_skill** (240+ lines): Same features PLUS nested ICU (plural inside select),
i18n-aria-label, a separate service using $localize with named placeholder syntax
(`:productName:`), more comprehensive $localize examples in component methods.

**Verdict:** Baseline is MORE comprehensive. Nested ICU and named placeholders in
$localize are advanced features the baseline covers without any skill reference.

---

### 7. service-workers (Eval 13) -- Specialized topic

**with_skill** (453 lines): Complete PWA setup. provideServiceWorker with
registrationStrategy. Comprehensive ngsw-config.json. SwUpdate with versionUpdates
(filtered for VERSION_READY), activateUpdate(), checkForUpdate(). SwPush with full
lifecycle. Unrecoverable state handler. Local testing with http-server + DevTools.

**without_skill** (663 lines): Everything above PLUS: UpdateCheckService with periodic
polling, PushSettingsComponent, unit test mocking examples for both SwUpdate and SwPush
(with Subject-based mock and TestBed setup), ngsw:/ cache inspection commands.

**Verdict:** Baseline is significantly more comprehensive. The unit test mocking section
(lines 537-609) is particularly valuable -- something the with-skill version omits.

---

### 8. angular-libraries (Eval 16) -- Specialized topic

**with_skill** (424 lines): ng generate library, project structure, ng-packagr config,
secondary entry points, npm publish, modern provide* pattern with makeEnvironmentProviders
and withLogging(). Legacy forRoot/forChild commented as not recommended.

**without_skill** (557 lines): Everything above PLUS: angular.json architect config,
tsconfig.lib.prod.json with partial compilation mode, provenance signing, publint/
are-the-types-wrong validation, sideEffects:false, providedIn:'any' explanation,
InjectionToken with factory defaults, 10-point best practices list, full exports map
in built package.json.

**Verdict:** Baseline is substantially more comprehensive. The tooling advice (publint,
are-the-types-wrong, provenance) and partial compilation explanation are valuable
real-world knowledge the with-skill version lacks.

---

## Cross-cutting Observations

### TypeScript Diagnostic Issues

Both configs produce files with TS diagnostics (expected -- isolated .ts files without
their full project context). Common issues:
- Missing test runner types (describe/it/expect) -- both configs
- Missing module imports (external deps like @angular/cdk) -- both configs
- $localize not found (needs @angular/localize/init polyfill) -- both configs
- rxResource `loader` vs `request` property naming discrepancy -- BOTH configs get
  this wrong differently, suggesting the API may have changed between training cutoffs

### rxResource API Naming

**Notable finding:** The with-skill version uses `params`/`loader` while the baseline
uses `request`/`loader`. TypeScript diagnostics show BOTH are incorrect for the installed
Angular version (which uses different property names). This is a genuine knowledge gap
in both configs, but it's about API surface evolution, not something a static reference
file would help with (it would go stale too).

### Pattern: Baseline Often More Comprehensive

In 6 of 18 evals, the baseline produced notably more comprehensive output:
- ng-optimized-image: more sections (placeholder, custom srcset)
- defer-element-ref: 6 examples vs 5 (includes when+on combo)
- i18n-icu: nested ICU, named placeholders
- service-workers: unit test mocking
- angular-libraries: tooling, partial compilation, 10-point practices
- rxjs-interop: 8 numbered guidelines

This makes sense: the with-skill agents spend tokens reading the SKILL.md and reference
files, leaving less budget for the actual output. The baseline goes straight to generating.

### Pattern: With-skill Steers Toward Modern Patterns

In 2 evals, the with-skill version used noticeably more modern patterns:
- style-patterns: httpResource vs manual subscribe, output() vs console.log
- structural-directive: input.required + effect vs @Input setter

This suggests the skill's value is not in adding knowledge but in **biasing toward
preferred patterns** when the model knows multiple valid approaches.

---

## Summary

| Dimension | with_skill | without_skill |
|-----------|-----------|---------------|
| Formal assertions | 148/148 (100%) | 148/148 (100%) |
| Mean tokens | ~24,600 | ~13,200 |
| Token overhead | +86% average | baseline |
| Comprehensiveness | Good | Often better (6/18 evals) |
| Modern pattern adherence | Slightly better (2/18 evals) | Good |
| Code quality | High | High |

**Conclusion:** The model's pre-training comprehensively covers all 18 tested Angular
topics. Adding new reference files would not improve assertion pass rates and would
add ~86% token overhead. The skill's existing references provide value by steering
toward preferred patterns (modern APIs over legacy), not by adding missing knowledge.

**Recommendation:** Do not add any of the 9 proposed reference files (directives,
style-guide, templates, i18n, service-workers, drag-drop, rxjs-interop, libraries,
or Jest note). Only apply the 3 MINOR fixes to existing files.
