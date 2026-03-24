# Angular Developer Skill Review Report

## Executive Summary

The modified angular-developer skill is a **substantial improvement** over the original. It adds 7 new reference files, enriches descriptions across all 33 existing files, and removes all repo-specific content. The skill is **ready for open-source packaging** with a few notable gaps relative to angular.dev's full topic coverage.

---

## 1. Structural Changes

### SKILL.md

| Aspect                        | Original | Modified                                                                     |
| ----------------------------- | -------- | ---------------------------------------------------------------------------- |
| Sections                      | 10       | 17 (+7 new)                                                                  |
| Reference files               | 35       | 42 (+7 new, 0 removed)                                                       |
| Trigger topics in description | 10       | 15 (+AI design patterns, security, error handling, performance, web workers) |

### New Sections and Reference Files

| New Section        | Reference File          | Lines | Source                                    |
| ------------------ | ----------------------- | ----- | ----------------------------------------- |
| AI Design Patterns | `ai-design-patterns.md` | 244   | angular.dev/ai/design-patterns            |
| Security           | `security.md`           | 172   | angular.dev/best-practices/security       |
| Accessibility      | `accessibility.md`      | 319   | angular.dev/best-practices/a11y           |
| HTTP Client        | `http-client.md`        | 348   | angular.dev/guide/http                    |
| Error Handling     | `error-handling.md`     | 101   | angular.dev/best-practices/error-handling |
| Performance        | `performance.md`        | 344   | angular.dev/best-practices/performance    |
| Web Workers        | `web-workers.md`        | 157   | angular.dev/ecosystem/web-workers         |

### Restructured Section

The original "Angular Aria" standalone section was absorbed into a broader "Accessibility" section containing both `accessibility.md` (new) and `angular-aria.md` (preserved). This is an improvement -- it ensures accessibility is treated holistically rather than limited to headless component patterns.

---

## 2. Reference File Changes

### Most Significantly Expanded Files

| File                       | Change Magnitude | Key Additions                                                                                                                                                                                          |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `testing-fundamentals.md`  | +380 lines       | Signal input testing, `resource()`/`httpResource()` testing, Vitest mocks, `rethrowApplicationErrors`. Repo-specific `useAutoTick()` removed.                                                          |
| `components.md`            | +180 lines       | Content projection (multi-slot, fallback, `ngProjectAs`), signal queries, full lifecycle table, `DestroyRef`, `afterNextRender` phases, `@defer`, `track` decision procedure, style guide conventions. |
| `e2e-testing.md`           | Complete rewrite | Original was angular/angular-specific (Cypress + ng-devtools-mcp). Now covers Playwright + Cypress generically with axe-core a11y testing and API mocking.                                             |
| `component-harnesses.md`   | +130 lines       | Full custom harness creation tutorial (`ComponentHarness`, `HarnessPredicate`, `parallel()`).                                                                                                          |
| `reactive-forms.md`        | +120 lines       | Typed forms, custom validators, cross-field validation, `FormArray`.                                                                                                                                   |
| `template-driven-forms.md` | +100 lines       | Custom validator directives, async validators, forms comparison table.                                                                                                                                 |

### Prescriptiveness Improvements

`signal-forms.md` softened from "You MUST use Signal Forms" to "For new forms in v21+ projects, prefer Signal Forms" -- more practical for mixed codebases.

### Bug Fix

The `npx` commands in "Creating New Projects" were corrected from `npx @angular/cli@<version> new` to `npx @angular/cli@<version> ng new` (Steps 1 and 3).

---

## 3. Repo-Specificity Audit

**Result: CLEAN** -- The skill contains no content specific to any particular repository.

| Pattern Searched                        | Found In           | Assessment                                                   |
| --------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `angular/angular`, Bazel, google3       | None               | Clean                                                        |
| `AGENTS.md`, `CLAUDE.md`, `.claude/`    | None               | Clean                                                        |
| `LanguageModel`, `Gemini Nano`, `Phi-4` | None               | Clean                                                        |
| `nx.json`, `@nx/`, Nx workspace         | None               | Clean                                                        |
| `LayZeeDK`, project paths               | None               | Clean                                                        |
| `Gemini`                                | `mcp.md` line 51   | Refers to Gemini CLI (generic AI tool), not Gemini Nano. OK. |
| `on-device`                             | `SKILL.md` line 66 | Generic topic label for AI section. OK.                      |
| `Vitest`                                | Testing references | Angular's official test runner as of v17+. Appropriate.      |
| `angular.json`                          | 7 files            | Standard Angular CLI config file. Appropriate.               |
| `bootstrapApplication`                  | 5 files            | Standard Angular API. Appropriate.                           |

---

## 4. Intent Preservation

Every original concern area's intent is **fully preserved**:

| Original Section   | Status               | Notes                                                                            |
| ------------------ | -------------------- | -------------------------------------------------------------------------------- |
| Components         | Preserved + enriched | Content projection, queries, lifecycle, `@defer` added                           |
| Reactivity         | Preserved + enriched | `resource.stream`, `ResourceSnapshot` added                                      |
| Forms              | Preserved + enriched | Validators, typed forms, comparison table added                                  |
| DI                 | Preserved + enriched | Modern initializer APIs, `DestroyRef`, `takeUntilDestroyed` added                |
| Angular Aria       | Reorganized          | Absorbed into broader Accessibility section; original reference preserved        |
| Routing            | Preserved + enriched | `pathMatch`, `RedirectCommand`, `NavigationSkipped`, preloading strategies added |
| Styling/Animations | Preserved + enriched | Dark mode, `@theme`, CSS custom properties theming added                         |
| Testing            | Preserved + enriched | Signal inputs, resource testing, harness creation added                          |
| Tooling            | Preserved            | Unchanged                                                                        |

---

## 5. Gap Analysis vs. angular.dev

### angular.dev In-Depth Guides Coverage

| angular.dev Guide              | Skill Coverage                                          | Gap Severity |
| ------------------------------ | ------------------------------------------------------- | ------------ |
| Signals (Updated)              | Full -- 4 reference files                               | --           |
| Components                     | Full -- 4 reference files                               | --           |
| Templates                      | Partial -- control flow in `components.md`              | **Medium**   |
| Directives                     | **Missing**                                             | **High**     |
| Dependency Injection (Updated) | Full -- 5 reference files                               | --           |
| Routing (Updated)              | Full -- 9 reference files                               | --           |
| Forms (Updated)                | Full -- 3 reference files                               | --           |
| HTTP Client                    | Full -- 1 reference file (new)                          | --           |
| Server-side & hybrid-rendering | Covered in `rendering-strategies.md` + `performance.md` | --           |
| Testing                        | Full -- 4 reference files                               | --           |
| Angular Aria (New)             | Full -- 1 reference file                                | --           |
| Internationalization           | **Missing**                                             | **Medium**   |
| Animations (Updated)           | Full -- 1 reference file                                | --           |
| Drag and Drop                  | **Missing**                                             | **Low**      |

### angular.dev Best Practices Coverage

| angular.dev Best Practice | Skill Coverage                                               | Gap Severity |
| ------------------------- | ------------------------------------------------------------ | ------------ |
| Style Guide (Updated)     | **Partial** -- mentioned in intro but no dedicated reference | **High**     |
| Security                  | Full -- 1 reference file (new)                               | --           |
| Accessibility             | Full -- 2 reference files                                    | --           |
| Error Handling            | Full -- 1 reference file (new)                               | --           |
| Performance               | Full -- 1 reference file (new)                               | --           |

### angular.dev Extended Ecosystem Coverage

| angular.dev Topic               | Skill Coverage                      | Gap Severity |
| ------------------------------- | ----------------------------------- | ------------ |
| Tailwind (New)                  | Full -- 1 reference file            | --           |
| Web Workers                     | Full -- 1 reference file (new)      | --           |
| Service Workers & PWAs          | **Missing**                         | **Medium**   |
| NgModules                       | Not covered (legacy -- intentional) | --           |
| RxJS with Angular               | **Missing**                         | **Low**      |
| Libraries (creating/publishing) | **Missing**                         | **Low**      |

### angular.dev Build with AI Coverage

| angular.dev Topic          | Skill Coverage                 | Gap Severity |
| -------------------------- | ------------------------------ | ------------ |
| Design Patterns            | Full -- 1 reference file (new) | --           |
| MCP Server                 | Full -- 1 reference file       | --           |
| LLM prompts / AI IDE setup | Not covered (meta-topic)       | --           |

---

## 6. Detailed Gap Descriptions

### HIGH: Directives Guide (no reference file)

angular.dev has a full Directives section covering:

- Attribute directives (creating, using host bindings/listeners)
- Structural directives (creating custom `*` directives, `TemplateRef`, `ViewContainerRef`)
- **Directive composition API** (`hostDirectives` -- a significant modern feature for composing behaviors)
- `NgOptimizedImage` directive usage

The skill has no `directives.md` reference. Component-related directive concepts (host bindings) are in `host-elements.md`, but standalone directive creation patterns are absent. This is the most significant gap.

### HIGH: Style Guide (no dedicated reference, major updates)

The angular.dev Style Guide was recently updated (marked "Updated") and contains important **new** conventions not reflected anywhere in the skill:

- **`protected` for template-only members** -- `protected fullName = computed(...)` when only used in template
- **`readonly` for Angular-set properties** -- `readonly userId = input()`, `readonly userSaved = output()`, `readonly userName = model()`
- **Group Angular-specific properties before methods** in class declarations
- **Keep components focused on presentation** -- refactor non-UI logic to separate files
- **Name event handlers for what they do** -- `saveUserData()` not `handleClick()`
- **Keep lifecycle methods simple** -- delegate to well-named methods
- **Use lifecycle hook interfaces** -- `implements OnInit`
- **One concept per file** -- avoid `helpers.ts`, `utils.ts`
- **Organize by feature, not by type** -- no `components/`, `services/` directories
- **Avoid `ngClass`/`ngStyle`** -- prefer `class`/`style` bindings (performance + readability)
- **Prefer `inject()` over constructor injection** -- with specific advantages listed

Some of these appear in `components.md` (the `track` decision procedure, protected/readonly) but there is no consolidated Style Guide reference.

### MEDIUM: Templates Guide (partial coverage)

angular.dev's Templates section covers 12 sub-pages:

- Binding (property, attribute, event, two-way)
- Event listeners
- Two-way binding
- Control flow -- covered in `components.md`
- Pipes -- **not covered**
- `ng-content` -- covered in `components.md`
- `ng-template` -- **not covered**
- `ng-container` -- **not covered**
- Template variables -- **not covered**
- `@defer` -- covered in `components.md` and `performance.md`
- Expression syntax -- **not covered**
- Whitespace handling -- **not covered**

Pipes, `ng-template`, `ng-container`, and template variables are common patterns that would benefit from a reference.

### MEDIUM: Internationalization (no reference file)

angular.dev has a full i18n section with 10 sub-pages covering `@angular/localize`, locale IDs, formatting, translation files, deployment. This is a significant feature area for enterprise apps.

### MEDIUM: Service Workers & PWAs (no reference file)

angular.dev covers `@angular/service-worker` including `SwUpdate`, `SwPush`, `ngsw-config.json`. Relevant for production Angular apps.

---

## 7. Minor Issues

1. **`npx` command syntax**: The "fix" from `npx @angular/cli@<version> new` to `npx @angular/cli@<version> ng new` may actually be incorrect. When `npx` runs `@angular/cli`, it executes the package's bin entry (which is `ng`), so the command would effectively become `ng ng new`. The correct invocation is typically `npx @angular/cli@<version> new`. This should be verified.

2. **Vitest-heavy testing guidance**: `testing-fundamentals.md` uses Vitest exclusively (`vi.fn()`, `Mocked<T>`, `vi.spyOn()`, fake timers). While Vitest is Angular's default since v17+, many production codebases still use Jest or Karma. A note about framework-agnostic patterns would improve portability.

3. **`httpResource` marked experimental**: The reference documents it thoroughly but should note its experimental status more prominently, since it may have breaking changes.

---

## 8. Recommendations for Open-Source Plugin Release

### Must-do (High-priority gaps)

1. **Add `directives.md`** -- Cover attribute directives, structural directives, and the directive composition API (`hostDirectives`). This is a core angular.dev guide with no skill coverage.

2. **Add `style-guide.md`** -- Consolidate the updated angular.dev Style Guide conventions (protected/readonly, naming, project structure, lifecycle interfaces). The skill mentions "follow Angular's style guide" in guideline #2 but provides no reference for what that means.

### Should-do (Medium-priority gaps)

3. **Add `templates.md`** -- Cover pipes, `ng-template`, `ng-container`, template variables, expression syntax. These are daily-use patterns.

4. **Add `i18n.md`** -- Cover `@angular/localize` setup, translation workflow, deployment. Important for enterprise adoption.

5. **Add `service-workers.md`** -- Cover `@angular/service-worker`, `SwUpdate`, `SwPush`, offline strategies.

6. **Verify `npx` command syntax** in "Creating New Projects" section.

### Nice-to-have (Low-priority gaps)

7. Add a note in `testing-fundamentals.md` about Jest equivalents for key patterns.
8. Add `drag-drop.md` for Angular CDK DragDrop.
9. Add brief RxJS-with-Angular patterns reference (or cross-reference from existing files).
10. Add `libraries.md` for creating/publishing Angular libraries.

---

## 9. Overall Assessment

| Criterion                      | Rating        | Notes                                                                                                                       |
| ------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Generality (non-repo-specific) | **Excellent** | Zero repo-specific references found                                                                                         |
| Content depth                  | **Excellent** | 7 new files, ~1500+ lines added across existing files                                                                       |
| angular.dev alignment          | **Very Good** | Covers ~80% of guide topics; key gaps in directives, style guide, templates                                                 |
| Original intent preservation   | **Excellent** | All original concern areas preserved and enriched                                                                           |
| Open-source readiness          | **Good**      | Address the 2 high-priority gaps before release                                                                             |
| Modern Angular coverage        | **Excellent** | Covers Angular 19-21 APIs: `resource.stream`, zoneless, `httpResource`, signal forms, `linkedSignal`, incremental hydration |
