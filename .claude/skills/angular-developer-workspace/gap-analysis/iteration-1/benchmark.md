# Directives Gap Benchmark -- Iteration 1

## Results Summary

| Eval | with_skill | without_skill | Delta |
|------|-----------|---------------|-------|
| attr-directive | 4/4 (100%) | 4/4 (100%) | 0% |
| structural-directive | 4/4 (100%) | 4/4 (100%) | 0% |
| host-directives | 4/4 (100%) | 4/4 (100%) | 0% |
| ng-optimized-image | 4/4 (100%) | 4/4 (100%) | 0% |
| **Overall** | **16/16 (100%)** | **16/16 (100%)** | **0%** |

## Token/Time Cost

| Eval | with_skill tokens | without_skill tokens | Token overhead |
|------|------------------|---------------------|----------------|
| attr-directive | 20,875 | 10,185 | +105% |
| structural-directive | 15,693 | 10,363 | +51% |
| host-directives | 25,584 | 11,544 | +122% |
| ng-optimized-image | 25,586 | 13,443 | +90% |
| **Mean** | **21,935** | **11,384** | **+93%** |

## Pass@k / Pass^k Metrics

All 4 evals fully pass in both configs (n=1 per eval, c=1):

| k | Pass@k (with) | Pass@k (without) | Pass^k (with) | Pass^k (without) |
|---|---------------|-------------------|---------------|-------------------|
| 1 | 1.0 | 1.0 | 1.0 | 1.0 |

All evals are saturated/non-discriminating at k=1.

Note: With n=1 run per eval, Pass@k = Pass^k = 1.0 trivially. Higher k values
are not computable from a single sample. The qualitative analysis below provides
the discriminating signal instead.

## Analysis

### Key Finding: All directive sub-topics are SATURATED

The model handles all four directive topics perfectly WITHOUT any skill reference:

1. **Attribute directives**: Baseline uses modern `host` metadata, `input()` function,
   correct `[appHighlight]` selector, and omits `standalone: true`. Identical quality.

2. **Structural directives**: Baseline correctly uses `inject(TemplateRef)` and
   `inject(ViewContainerRef)`, creates embedded views with `$implicit` context, and
   handles input changes. Minor style difference: baseline uses `@Input` setter vs
   with-skill uses `input.required()` + `effect()`. Both are valid patterns.

3. **Directive composition (hostDirectives)**: Baseline correctly uses `hostDirectives`
   array, demonstrates selective input/output exposure, shows aliasing syntax
   (`'cdkTooltip: tooltip'`), and explains the encapsulation benefit.

4. **NgOptimizedImage**: Baseline demonstrates `provideCloudinaryLoader`, `ngSrc`,
   `priority`, `fill` mode with positioned parent and `object-fit`. The baseline
   actually provides MORE detail (custom srcset, placeholder attribute, `[priority]`
   conditional binding).

### Token Overhead

The with-skill runs use ~93% more tokens on average due to reading the SKILL.md and
reference files. Since the baseline already achieves 100% pass rate, this overhead
provides zero quality improvement and only adds latency + cost.

### Qualitative Observations

- Baseline structural directive uses `@Input` decorator (legacy) instead of `input()`
  signal function. This is the ONLY quality gap, and it's minor -- the prompt asked
  for `inject()` (which both got right), not `input()`.
- Baseline NgOptimizedImage output is MORE comprehensive than with-skill (includes
  placeholder, custom srcset, conditional priority).
- Both configs produce clean, well-commented, production-quality code.

### Recommendation

**Do NOT add a `directives.md` reference file.** All four sub-topics are well-covered
by the model's pre-training. Adding a reference would:
- Increase token usage by ~93% with no quality benefit
- Add maintenance burden for content that doesn't improve output
- Risk context bloat when the skill loads for other tasks

The only marginal improvement would be ensuring structural directives use `input()`
instead of `@Input`. This is already covered by the existing skill's general
"use input() and output() functions, not decorators" guidance.
