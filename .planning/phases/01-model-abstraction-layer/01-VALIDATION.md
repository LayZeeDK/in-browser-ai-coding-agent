---
phase: 1
slug: model-abstraction-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | Vitest 4.1 (browser mode) + Playwright 1.36+ (E2E)                                                                  |
| **Config file**        | `apps/in-browser-ai-coding-agent/vitest.config.mts` (default), `vitest.config.chrome.mts`, `vitest.config.edge.mts` |
| **Quick run command**  | `npm exec nx -- test in-browser-ai-coding-agent`                                                                    |
| **Full suite command** | `npm exec nx -- run-many -t test lint typecheck && npm exec nx -- run-many -t e2e`                                  |
| **Estimated runtime**  | ~30 seconds (mock tests), ~240 seconds (real model tests)                                                           |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx -- test in-browser-ai-coding-agent`
- **After every plan wave:** Run `npm exec nx -- run-many -t test lint typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (mock tests)

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type          | Automated Command                                       | File Exists  | Status  |
| -------- | ---- | ---- | ----------- | ------------------ | ------------------------------------------------------- | ------------ | ------- |
| 01-01-01 | 01   | 1    | PIPE-05     | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-01-02 | 01   | 1    | PIPE-05     | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-01-03 | 01   | 1    | PIPE-06     | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-01-04 | 01   | 1    | PIPE-07     | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-01-05 | 01   | 1    | PIPE-05     | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-02-01 | 02   | 2    | PIPE-05     | unit (integration) | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 | pending |
| 01-02-02 | 02   | 2    | PIPE-07     | e2e                | `npm exec nx -- e2e in-browser-ai-coding-agent-e2e`     | No -- Wave 0 | pending |
| 01-02-03 | 02   | 2    | PIPE-06     | unit (real model)  | `npm exec nx -- test-chrome in-browser-ai-coding-agent` | No -- Wave 0 | pending |

_Status: pending - green - red - flaky_

---

## Wave 0 Requirements

- [ ] `libs/shared/model/` -- entire library (Wave 0 creates the Nx library via generator)
- [ ] `libs/shared/model/testing/` -- secondary entrypoint with MockModelService
- [ ] Unit test files for ModelService implementations, factory, provider
- [ ] E2E test files replacing deleted specs
- [ ] `tsconfig.base.json` path mappings for `@layzeedk/model` and `@layzeedk/model/testing`

_Wave 0 is covered by Plan 01 (library scaffolding + core implementation)._

---

## Manual-Only Verifications

| Behavior                                                 | Requirement | Why Manual                                            | Test Instructions                                                                                        |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Two consecutive pipeline passes without cold-start delay | PIPE-07     | Cold-start timing observation requires human judgment | Run two prompt submissions back-to-back in headed browser; second should respond within ~5s, not 11+ min |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
