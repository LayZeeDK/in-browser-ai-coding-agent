# Codebase Structure

**Analysis Date:** 2026-03-24

## Directory Layout

```
project-root/
|-- .angular/               # Angular CLI build cache (gitignored)
|-- .claude/                # Claude Code project configuration
|   |-- settings.json       # Plugin marketplace registration
|   '-- skills/             # Claude Code skill modules
|       |-- angular-developer/   # Angular code generation skill
|       |   |-- SKILL.md         # Skill entrypoint + routing logic
|       |   '-- references/      # 40+ Angular topic reference docs
|       '-- playwright-cli/      # Browser automation skill
|           |-- SKILL.md         # Skill entrypoint
|           '-- references/      # 7 topic reference docs
|-- .github/                # GitHub and AI agent configuration
|   |-- actions/            # Custom GitHub Actions
|   |   '-- paths-filter/   # Custom path-based change detection action
|   |       |-- action.yml  # Action declaration
|   |       |-- index.mjs   # Implementation (git diff + pathspecs)
|   |       |-- package.json
|   |       '-- node_modules/   # Action dependencies (committed)
|   |-- agents/             # Claude Code agent definitions
|   |   '-- ci-monitor-subagent.agent.md  # Lightweight MCP-call subagent
|   |-- docker/             # CI Docker image definition
|   |   '-- Dockerfile      # ubuntu:24.04 + Node + Chrome Beta
|   |-- prompts/            # VS Code Copilot prompt files
|   |   '-- monitor-ci.prompt.md  # CI monitoring prompt
|   |-- skills/             # Nx Cloud / Nx workspace AI skills
|   |   |-- link-workspace-packages/SKILL.md
|   |   |-- monitor-ci/
|   |   |   |-- SKILL.md         # CI orchestrator skill
|   |   |   |-- references/
|   |   |   |   '-- fix-flows.md # Detailed fix action flows
|   |   |   '-- scripts/
|   |   |       |-- ci-poll-decide.mjs    # Deterministic CI decision script
|   |   |       '-- ci-state-update.mjs  # Budget/cycle state management
|   |   |-- nx-generate/SKILL.md
|   |   |-- nx-import/
|   |   |   |-- SKILL.md
|   |   |   '-- references/     # ESLINT.md GRADLE.md JEST.md NEXT.md TURBOREPO.md VITE.md
|   |   |-- nx-plugins/SKILL.md
|   |   |-- nx-run-tasks/SKILL.md
|   |   '-- nx-workspace/
|   |       |-- SKILL.md
|   |       '-- references/
|   |           '-- AFFECTED.md
|   '-- workflows/
|       '-- ci.yml          # Single CI workflow (all jobs)
|-- .githooks/              # Local git hooks
|   '-- pre-commit          # Auto-formats staged files with nx format
|-- .planning/              # GSD planning documents
|   '-- codebase/           # Codebase analysis documents (this directory)
|-- .playwright-profiles/   # Browser profiles with AI models (gitignored)
|   |-- chrome-beta/        # Chrome Beta profile (Gemini Nano)
|   '-- msedge-dev/         # Edge Dev profile (Phi-4 Mini)
|-- apps/
|   |-- in-browser-ai-coding-agent/     # Main Angular application
|   |   |-- src/
|   |   |   |-- app/
|   |   |   |   |-- app.ts              # Root component
|   |   |   |   |-- app.html            # Root template
|   |   |   |   |-- app.css             # Root styles
|   |   |   |   |-- app.config.ts       # Angular providers
|   |   |   |   |-- app.routes.ts       # Route definitions (empty)
|   |   |   |   |-- language-model.service.ts  # LanguageModel API wrapper
|   |   |   |   '-- model-status.component.ts  # Main UI component
|   |   |   '-- main.ts                 # Bootstrap entry point
|   |   |-- browser-warmup.ts           # Vitest setupFile (browser process)
|   |   |-- global-setup.ts             # Vitest globalSetup (all browsers)
|   |   |-- global-setup.chrome.ts      # Vitest globalSetup (Chrome only)
|   |   |-- global-setup.edge.ts        # Vitest globalSetup (Edge only)
|   |   |-- global-setup.shared.ts      # Shared seedLocalState logic
|   |   |-- vitest.config.mts           # Both browsers (default)
|   |   |-- vitest.config.chrome.mts    # Chrome Beta only (test-chrome target)
|   |   |-- vitest.config.edge.mts      # Edge Dev only (test-edge target)
|   |   |-- vitest.shared.mts           # Config factory (createVitestConfig)
|   |   |-- project.json                # Nx project targets
|   |   '-- tsconfig*.json
|   '-- in-browser-ai-coding-agent-e2e/ # Playwright E2E tests
|       |-- src/
|       |   |-- fixtures.ts             # Worker-scoped persistent context
|       |   |-- example.spec.ts         # Basic app tests
|       |   '-- prompt.spec.ts          # Real AI inference tests
|       |-- playwright.config.ts        # 2 projects: chrome + edge
|       '-- project.json
|-- dist/                   # Build output (gitignored)
|-- docs/                   # Architecture documentation
|   |-- SUMMARY.md          # Quick-reference tables, test flow, timeouts
|   '-- platform-runner-findings.md  # Runner compatibility findings
|-- libs/
|   '-- shared/
|       '-- browser-profiles/           # @layzeedk/browser-profiles lib
|           |-- src/
|           |   |-- index.ts            # Public API barrel
|           |   '-- lib/
|           |       '-- browser-profiles.ts  # Profiles + seedLocalState + getLaunchOptions
|           |-- package.json
|           '-- project.json
|-- plans/                  # Implementation plans (gitignored by CI change detection)
|-- scripts/
|   |-- bootstrap-ai-model.mjs  # Model download + profile setup
|   '-- rebase-format.sh        # Rebase helper
|-- .node-version           # Node.js version pin (FNM/nvmrc format)
|-- eslint.config.mjs       # Root ESLint flat config
|-- nx.json                 # Nx workspace config
|-- package.json            # Root package.json
|-- package-lock.json       # Lockfile (npm)
|-- tsconfig.base.json      # Shared TypeScript paths + compiler options
'-- vitest.workspace.ts     # Vitest workspace (discovers per-project configs)
```

## Directory Purposes

**`.claude/`:**

- Purpose: Claude Code project-scoped configuration and skill modules
- Contains: `settings.json` (plugin registration), skill directories with `SKILL.md` entrypoints and `references/` subdirectories
- Key files: `.claude/settings.json`, `.claude/skills/angular-developer/SKILL.md`, `.claude/skills/playwright-cli/SKILL.md`
- Excluded from CI change detection (`.claude/**` in paths-filter)

**`.github/`:**

- Purpose: GitHub Actions CI configuration AND AI agent/skill definitions
- Substructure:
  - `actions/paths-filter/` -- custom composite action with bundled `node_modules` (committed)
  - `agents/` -- Claude Code agent markdown files (haiku subagent for MCP calls)
  - `docker/` -- Dockerfile for Chrome Beta CI container
  - `prompts/` -- VS Code Copilot prompt files (`.prompt.md` format)
  - `skills/` -- Nx Cloud and workspace skill modules (loaded via `nx@nx-claude-plugins`)
  - `workflows/` -- GitHub Actions YAML workflows

**`apps/in-browser-ai-coding-agent/`:**

- Purpose: Main Angular SPA
- Key files: `src/app/language-model.service.ts`, `src/app/model-status.component.ts`, `vitest.shared.mts`
- Test files: `*.spec.ts` co-located with source (browser Vitest mode)

**`apps/in-browser-ai-coding-agent-e2e/`:**

- Purpose: Playwright E2E test suite
- Key files: `src/fixtures.ts` (NEVER import from `@playwright/test` directly -- always use this)
- Config: `playwright.config.ts` (2 projects: `chrome` and `edge`)

**`libs/shared/browser-profiles/`:**

- Purpose: Single source of truth for browser profile configuration shared across apps, tests, and scripts
- Package name: `@layzeedk/browser-profiles`
- Key exports: `allProfiles`, `getLaunchOptions()`, `seedLocalState()`, `BrowserProfile`, `AI_IGNORE_DEFAULT_ARGS`

**`scripts/`:**

- Purpose: Standalone Node.js ESM scripts for development and CI setup
- `bootstrap-ai-model.mjs` -- downloads AI model into `.playwright-profiles/`; called in CI when model cache is empty

**`docs/`:**

- Purpose: Architecture decision records and platform findings (checked in, not gitignored)
- `SUMMARY.md` -- test flow diagrams, timeout tables, caching strategy
- `platform-runner-findings.md` -- OS/GPU compatibility research

**`.planning/`:**

- Purpose: GSD workflow planning documents (codebase analysis, project plans, phases)
- Excluded from CI change detection
- `codebase/` -- auto-generated analysis docs (ARCHITECTURE.md, STRUCTURE.md, etc.)

## Key File Locations

**Entry Points:**

- `apps/in-browser-ai-coding-agent/src/main.ts`: Angular bootstrap
- `apps/in-browser-ai-coding-agent/src/app/app.config.ts`: Angular providers (`provideRouter`, `provideBrowserGlobalErrorListeners`)
- `apps/in-browser-ai-coding-agent/src/app/app.routes.ts`: Route definitions

**Configuration:**

- `nx.json`: Nx workspace config (plugins, targetDefaults, generators, namedInputs)
- `tsconfig.base.json`: Shared TypeScript paths and compiler options
- `eslint.config.mjs`: Root ESLint flat config
- `.node-version`: Node.js version pin (read by FNM, `actions/setup-node`)
- `package.json`: Root dependencies, npm scripts

**Core Logic:**

- `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`: LanguageModel API wrapper
- `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`: Main UI component with signal state
- `libs/shared/browser-profiles/src/lib/browser-profiles.ts`: Profile definitions and setup utilities

**Testing:**

- `apps/in-browser-ai-coding-agent/vitest.shared.mts`: Vitest config factory
- `apps/in-browser-ai-coding-agent/browser-warmup.ts`: ONNX warm-up setupFile
- `apps/in-browser-ai-coding-agent/global-setup.shared.ts`: Profile seeding (file ops only)
- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`: Playwright persistent context fixture

**CI:**

- `.github/workflows/ci.yml`: Single CI workflow
- `.github/actions/paths-filter/index.mjs`: Change detection implementation
- `.github/docker/Dockerfile`: Chrome Beta CI container
- `scripts/bootstrap-ai-model.mjs`: AI model bootstrap for CI

**AI Agents:**

- `.claude/settings.json`: Claude Code plugin configuration
- `.claude/skills/angular-developer/SKILL.md`: Angular developer skill
- `.claude/skills/playwright-cli/SKILL.md`: Browser automation skill
- `.github/agents/ci-monitor-subagent.agent.md`: CI monitoring subagent
- `.github/skills/monitor-ci/SKILL.md`: CI orchestrator skill
- `.github/skills/monitor-ci/scripts/ci-poll-decide.mjs`: Polling decision script
- `.github/skills/monitor-ci/scripts/ci-state-update.mjs`: Budget/cycle state script

## Naming Conventions

**Files:**

- Angular components: `kebab-case.component.ts` (e.g., `model-status.component.ts`)
- Angular services: `kebab-case.service.ts` (e.g., `language-model.service.ts`)
- Angular config/routes: `app.config.ts`, `app.routes.ts`
- Vitest configs: `vitest.config.mts`, `vitest.config.{name}.mts`, `vitest.shared.mts`
- Global setup files: `global-setup.ts`, `global-setup.{name}.ts`, `global-setup.shared.ts`
- Skill entrypoints: `SKILL.md` (uppercase)
- Agent definitions: `{name}.agent.md`
- Prompt files: `{name}.prompt.md`
- Scripts: `kebab-case.mjs` (ESM)

**Directories:**

- Apps: `apps/{kebab-case}/`
- Libs: `libs/{scope}/{name}/` (e.g., `libs/shared/browser-profiles/`)
- E2E projects: `apps/{app-name}-e2e/`
- Skills: `.github/skills/{name}/` and `.claude/skills/{name}/`
- References: `{skill-dir}/references/` for topic-specific docs

**TypeScript:**

- Classes/components: PascalCase (e.g., `ModelStatusComponent`, `LanguageModelService`)
- Functions/methods: camelCase
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `AI_IGNORE_DEFAULT_ARGS`)
- Types/interfaces: PascalCase (e.g., `ModelAvailability`, `BrowserProfile`)

## Where to Add New Code

**New Angular Feature Component:**

- Implementation: `apps/in-browser-ai-coding-agent/src/app/{feature}.component.ts`
- Template (if large): `apps/in-browser-ai-coding-agent/src/app/{feature}.component.html`
- Tests: `apps/in-browser-ai-coding-agent/src/app/{feature}.component.spec.ts` (co-located)
- Import in app: add to `apps/in-browser-ai-coding-agent/src/app/app.ts` imports array

**New Angular Service:**

- Implementation: `apps/in-browser-ai-coding-agent/src/app/{name}.service.ts`
- Tests: `apps/in-browser-ai-coding-agent/src/app/{name}.service.spec.ts` (co-located)

**New Shared Library:**

- Create with Nx: `npm exec nx -- g @nx/angular:library --directory=libs/shared/{name}`
- Public API: `libs/shared/{name}/src/index.ts`
- Implementation: `libs/shared/{name}/src/lib/`

**New E2E Test:**

- Test file: `apps/in-browser-ai-coding-agent-e2e/src/{feature}.spec.ts`
- Import fixtures from `./fixtures` -- NEVER from `@playwright/test`

**New Claude Code Skill (project-specific):**

- Skill entrypoint: `.claude/skills/{name}/SKILL.md`
- Reference docs: `.claude/skills/{name}/references/{topic}.md`

**New Claude Code Skill (Nx/CI-focused):**

- Skill entrypoint: `.github/skills/{name}/SKILL.md`
- Reference docs: `.github/skills/{name}/references/{topic}.md`
- Scripts: `.github/skills/{name}/scripts/{name}.mjs`

**New CI Job:**

- Add to `.github/workflows/ci.yml`
- If job should skip on doc-only commits: add `needs: [changes]` and `if: fromJSON(needs.changes.outputs.changes).code`

**New Script:**

- Location: `scripts/{name}.mjs` (Node.js ESM)

## Special Directories

**`.playwright-profiles/`:**

- Purpose: Persistent browser profiles containing downloaded AI models and ONNX Runtime
- Generated: Yes (by `scripts/bootstrap-ai-model.mjs` or CI cache restore)
- Committed: No (gitignored)
- CI cache key pattern: `msedge-dev-{job}-edge-v1-run{run_number}` (restore by prefix)
- Contains (Edge): `EdgeLLMOnDeviceModel/` (Phi-4 Mini + tokenizer), `EdgeLLMRuntime/` (ONNX Runtime DLLs), `Local State` (flags)
- Contains (Chrome): `OptimizationGuideModelStore/` (Gemini Nano), `Local State` (flags)

**`.angular/cache/`:**

- Purpose: Angular CLI Vite/esbuild build cache
- Generated: Yes
- Committed: No (gitignored)

**`dist/`:**

- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (gitignored)

**`.github/actions/paths-filter/node_modules/`:**

- Purpose: Bundled action dependencies (`@actions/core`, `@actions/exec`) committed alongside the action
- Generated: No (manually managed)
- Committed: Yes (required for composite actions using `runs.using: node24`)

**`plans/`:**

- Purpose: GSD implementation plan markdown files
- Generated: By Claude Code `/gsd` workflow
- Committed: Yes (but excluded from CI change detection)

**`.planning/`:**

- Purpose: GSD codebase analysis and project management documents
- Generated: By Claude Code `/gsd:map-codebase` and related commands
- Committed: Yes (but excluded from CI change detection)

---

_Structure analysis: 2026-03-24_
