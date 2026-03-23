# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Non-technical user types a description and gets working HTML/CSS/JS rendered in a preview -- on-device, no cloud APIs
**Current focus:** Phase 1 - Model Abstraction Layer

## Current Position

Phase: 1 of 4 (Model Abstraction Layer)
Plan: --
Status: Ready to plan
Last activity: 2026-03-23 -- Roadmap created (4 phases, 27 requirements mapped)

Progress: [..........] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| -     | -     | -     | -        |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

_Updated after each plan completion_

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 4 phases derived from 27 requirements (coarse granularity)
- Research: create-per-pass sessions (not clone) -- passes need different system prompts
- Research: promptStreaming() is cumulative -- assign directly to signal, never concatenate
- Research: sandbox must be static attribute (Angular NG0910), blob URL not srcdoc
- Research: CSS Grid for 3-pane layout, no angular-split dependency (but evaluate alternatives in Phase 3: `@ngbracket/ngx-layout`, Angular Material Grid List, Angular CDK BreakpointObserver -- none currently installed)
- Research: AbortController for cancel with 500ms cooldown after abort
- Research: DOMParser for truncation detection (deterministic, no AI tokens)

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 2:** `responseConstraint` schema reliability for small models is LOW confidence -- start with 2-3 fields, measure JSON.parse success rate, add complexity incrementally
- **Phase 3:** Gemini Nano HTML generation quality is LOW-MEDIUM confidence -- no published benchmarks; Chrome is the fast iteration loop (~20s warm-up), verify Edge after Chrome prompts work
- **Phase 1:** Anchor session token cost on Gemini Nano (6K context) is undocumented -- measure `session.contextUsage` on empty anchor session before designing pass token budgets

## Session Continuity

Last session: 2026-03-23
Stopped at: Roadmap created -- ready to plan Phase 1
Resume file: None
