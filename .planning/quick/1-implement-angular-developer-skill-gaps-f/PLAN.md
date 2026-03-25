# Quick Task: Implement angular-developer skill gaps

## Approach

Benchmark-driven: used skill-creator evals to determine which gaps from the
review report actually need reference files vs. which the model handles from
pre-training. Only implemented changes with measurable impact.

## Benchmark Summary

- 4 iterations, 100+ agent runs, k=3 sampling for statistical reliability
- Iteration 1: 18 API-hinted evals (saturated -- 148/148 both configs)
- Iteration 2: 6 problem-oriented evals, k=3 (skill 0.92/0.75 Pass@1/Pass^3)
- Iteration 3: 3 runs verifying NgOptimizedImage fix (100% after fix)
- Iteration 4: 4 version-specific + multi-file evals, k=3 (skill 0.92/0.75)

## Changes Made

### Commit 1: NgOptimizedImage convention (benchmark-verified)

- `components.md`: Added Style Guide bullet + cross-reference to performance.md
- `components.md`: Updated Component Definition example to use ngSrc
- Effect: NgOptimizedImage pass rate 67% -> 100% (verified k=3)

### Commit 2: Report minor issues

- `SKILL.md`: Fixed npx syntax to `npx -p @angular/cli@<version> ng new`
- `http-client.md`: Added httpResource breaking changes warning
- `testing-fundamentals.md`: Added test runner ecosystem note (Vitest/Jest/Jasmine)
- `components.md`: Added author/email to non-unique track examples

### Commit 3: rxResource API documentation (benchmark-verified)

- `resource.md`: Added resource() v21.2+ availability note
- `resource.md`: Added rxResource section with correct params/stream API
- `resource.md`: Documented v19->v20 API rename (request->params, loader->stream)
- `SKILL.md`: Added rxResource to Reactivity section description
- Effect: Version-specific evals show skill 0.92 vs baseline 0.83 Pass@1

## Items Dismissed (benchmark-justified)

9 proposed reference files skipped -- all tested at 100% baseline pass rate:
directives, style-guide, templates, i18n, service-workers, drag-drop,
rxjs-interop, libraries, DeferBlockFixture testing
