# Codebase Structure

**Analysis Date:** 2026-03-20

## Directory Layout

```
in-browser-ai-coding-agent/
├── apps/
│   ├── in-browser-ai-coding-agent/          # Main Angular application
│   │   ├── src/
│   │   │   ├── app/                         # Application logic and components
│   │   │   │   ├── app.ts                   # Root component
│   │   │   │   ├── app.config.ts            # Bootstrap configuration
│   │   │   │   ├── app.routes.ts            # Router configuration
│   │   │   │   ├── app.html                 # Root template
│   │   │   │   ├── app.css                  # Root styles
│   │   │   │   ├── language-model.service.ts    # Browser API wrapper
│   │   │   │   ├── model-status.component.ts    # Status display component
│   │   │   │   ├── app.spec.ts              # Root component tests
│   │   │   │   ├── language-model.service.spec.ts  # Service tests
│   │   │   │   └── model-status.component.spec.ts  # Component tests
│   │   │   ├── main.ts                      # Application entry point
│   │   │   ├── index.html                   # HTML root
│   │   │   └── styles.css                   # Global styles
│   │   ├── public/                          # Static assets
│   │   │   └── favicon.ico                  # Browser icon
│   │   ├── project.json                     # Nx project configuration
│   │   ├── tsconfig.json                    # TypeScript configuration
│   │   ├── tsconfig.app.json                # App-specific TypeScript config
│   │   ├── tsconfig.spec.json               # Test-specific TypeScript config
│   │   ├── vitest.config.mts                # Vitest Browser Mode config
│   │   └── eslint.config.mjs                # ESLint configuration
│   │
│   └── in-browser-ai-coding-agent-e2e/      # Playwright e2e tests
│       ├── src/
│       │   └── example.spec.ts              # E2E test suite
│       ├── project.json                     # Nx project configuration
│       ├── playwright.config.ts             # Playwright configuration
│       ├── tsconfig.json                    # TypeScript configuration
│       └── eslint.config.mjs                # ESLint configuration
│
├── .planning/
│   ├── codebase/                            # Codebase analysis documents
│   ├── debug/                               # Debugging investigation notes
│   └── research/                            # Technical research documents
│
├── scripts/
│   └── bootstrap-ai-model.mjs               # CI: Download models before tests
│
├── node_modules/                            # Dependencies (not committed)
├── dist/                                    # Build output
│
├── nx.json                                  # Nx workspace configuration
├── tsconfig.base.json                       # Base TypeScript configuration
├── package.json                             # Npm scripts and dependencies
├── package-lock.json                        # Npm lock file
├── eslint.config.mjs                        # Root ESLint configuration
├── vitest.workspace.ts                      # Vitest workspace configuration
├── .prettierrc                              # Prettier code formatting config
├── .prettierignore                          # Prettier ignore patterns
├── .editorconfig                            # EditorConfig for IDE consistency
├── .node-version                            # Node.js version constraint
└── README.md                                # Project documentation
```

## Directory Purposes

**`apps/in-browser-ai-coding-agent/src/app/`:**

- Purpose: Application logic, components, and services
- Contains: Standalone Angular components, injectable services, templates, styles
- Key files:
  - `app.ts` — root component declaration
  - `language-model.service.ts` — LanguageModel API wrapper
  - `model-status.component.ts` — status display UI
  - Test files mirror source file names with `.spec.ts` suffix

**`apps/in-browser-ai-coding-agent/src/`:**

- Purpose: Application source root
- Contains: Entry point (`main.ts`), root HTML template, global styles
- Key files:
  - `main.ts` — bootstraps Angular application
  - `index.html` — document root
  - `styles.css` — global stylesheet

**`apps/in-browser-ai-coding-agent/public/`:**

- Purpose: Static assets served as-is
- Contains: Favicon, images (if any), other static files
- Not processed by build system

**`apps/in-browser-ai-coding-agent-e2e/src/`:**

- Purpose: End-to-end Playwright tests
- Contains: `.spec.ts` files with Playwright test suites
- Tests run against deployed/running application

**`.planning/codebase/`:**

- Purpose: Architecture and coding convention documentation
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, etc.

**`.planning/research/`:**

- Purpose: Investigation notes and decision records
- Contains: Technical spikes, research documents (not code)

**`scripts/`:**

- Purpose: Build-time and CI scripts
- Contains: Node.js files for bootstrapping, setup, automation

## Key File Locations

**Entry Points:**

- `apps/in-browser-ai-coding-agent/src/main.ts` — Browser entry (bootstraps Angular)
- `apps/in-browser-ai-coding-agent/src/index.html` — HTML document root
- `apps/in-browser-ai-coding-agent/src/app/app.ts` — Root component

**Configuration:**

- `nx.json` — Nx workspace settings, caching, plugins
- `apps/in-browser-ai-coding-agent/tsconfig.app.json` — Application TypeScript options
- `apps/in-browser-ai-coding-agent/vitest.config.mts` — Unit test browser configuration
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` — E2E test browser configuration
- `package.json` — Npm scripts and root dependencies
- `eslint.config.mjs` — Root ESLint rules, baseline configuration

**Core Logic:**

- `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` — Browser API wrapper
- `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` — Status display component
- `apps/in-browser-ai-coding-agent/src/app/app.ts` — Root component layout

**Testing:**

- `apps/in-browser-ai-coding-agent/src/app/**/*.spec.ts` — Unit tests (Vitest Browser Mode)
- `apps/in-browser-ai-coding-agent-e2e/src/example.spec.ts` — E2E tests (Playwright)

## Naming Conventions

**Files:**

- Components: `[feature].component.ts` (e.g., `model-status.component.ts`)
- Services: `[feature].service.ts` (e.g., `language-model.service.ts`)
- Tests: `[file].spec.ts` (co-located with source)
- Types/Enums: Exported from service files (no separate `.types.ts`)
- Config files: `[purpose].config.[ts|mjs|json]` (e.g., `vitest.config.mts`, `app.config.ts`)

**Directories:**

- Feature directories: Lowercase with hyphens (e.g., `in-browser-ai-coding-agent`)
- Nx projects: Lowercase with hyphens (e.g., `in-browser-ai-coding-agent`)
- Module paths in imports: Match directory structure

**Components:**

- Selector prefix: `app-` (e.g., `app-root`, `app-model-status`)
- Component class: PascalCase ending with "Component" (e.g., `ModelStatusComponent`)
- Template files: Inline in component or separate `.html` file matching class name

**Services:**

- Class name: PascalCase ending with "Service" (e.g., `LanguageModelService`)
- Decorator: `@Injectable({ providedIn: 'root' })` for singleton scope
- Methods: camelCase (e.g., `checkAvailability()`)

**Types and Enums:**

- Names: PascalCase (e.g., `ModelAvailability`)
- Exported from service/component files (no dedicated `.types.ts`)

## Where to Add New Code

**New Feature (e.g., chat interface, code editor):**

- Primary code: `apps/in-browser-ai-coding-agent/src/app/[feature].component.ts`
- Service logic: `apps/in-browser-ai-coding-agent/src/app/[feature].service.ts` (if needed)
- Template: Inline in component file (`.component.ts`) or separate `[feature].component.html`
- Styles: Inline in component file or separate `[feature].component.css`
- Tests: `apps/in-browser-ai-coding-agent/src/app/[feature].component.spec.ts`

**New Component (UI element):**

- Implementation: `apps/in-browser-ai-coding-agent/src/app/components/[component-name].component.ts` (optional subdirectory)
- Template: Inline or `components/[component-name].component.html`
- Styles: Inline or `components/[component-name].component.css`
- Tests: `components/[component-name].component.spec.ts`

**Utilities (shared functions):**

- Shared helpers: Create `apps/in-browser-ai-coding-agent/src/app/utils/[util-name].ts`
- Export from service or utils file for reuse across components

**Browser API Wrappers:**

- Pattern: Create injectable service with API detection
- Location: `apps/in-browser-ai-coding-agent/src/app/[api-name].service.ts`
- Follow `language-model.service.ts` pattern: check API presence, wrap calls, return normalized types

**E2E Tests:**

- Location: `apps/in-browser-ai-coding-agent-e2e/src/[feature].spec.ts`
- Use Playwright's page object model if adding complex test suites

## Special Directories

**`node_modules/`:**

- Purpose: Npm dependencies
- Generated: Yes (via `npm install`)
- Committed: No (excluded in .gitignore)

**`dist/`:**

- Purpose: Build output
- Generated: Yes (via `npm run build` or Nx build)
- Committed: No (excluded in .gitignore)
- Output path: `dist/apps/in-browser-ai-coding-agent/browser` (Angular build)

**`.nx/`:**

- Purpose: Nx cache and project graph
- Generated: Yes (Nx automatic)
- Committed: No (excluded in .gitignore)

**`.angular/`:**

- Purpose: Angular build cache
- Generated: Yes (Angular CLI automatic)
- Committed: No (excluded in .gitignore)

**`.planning/`:**

- Purpose: Planning documents and analysis
- Generated: No (manually created)
- Committed: Yes (tracked in git)

---

_Structure analysis: 2026-03-20_
