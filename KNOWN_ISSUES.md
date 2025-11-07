# Known Issues & Improvement Opportunities

_Last updated: 2025-11-07_

This document captures current technical, architectural, code quality, documentation, and operational issues in priority order for the `todo` (Planner) project, along with recommended remediation steps.

## Severity Legend
- **Critical** – Causes incorrect behavior, security / data risk, blocks scalability or maintainability.
- **High** – Strong negative impact on reliability, developer productivity, or user experience.
- **Medium** – Noticeable inefficiency or maintainability concern; should be scheduled.
- **Low** – Minor cleanup / polish.
- **Enhancement** – New capability or strategic improvement (not a bug).

---
## Executive Summary (Top 10)
1. (Critical) API/docs mismatch: README documents a `/todos` CRUD model (id/title/description/completed) that does not exist; actual API is `/tasks/` with different schema (duration, scheduledStart, recurrence). Creates onboarding confusion and external integration errors.
2. (Critical) No tests (backend or frontend). Zero safety net for refactors, recurrence logic, conflict detection, scheduling, or Firestore integration.
3. (Critical) Global Firestore client without explicit credential / error handling; runtime failures will surface as unhandled 500s.
4. (High) POST `/tasks/` accepts `dict` instead of a validated Pydantic model; inconsistent response shapes and limited OpenAPI clarity.
5. (High) Monolithic `static/app.js` (~2500+ lines) mixing concerns (state, DOM, API, recurrence, conflict detection, keyboard shortcuts). Hard to maintain, hard to test.
6. (High) Recurrence expansion & conflict detection use naive O(n^2) day-local overlap logic; scalability and performance risk as task counts grow.
7. (High) Numerous magic numbers (30‑day horizon, max 180 min duration, default scroll to 6:30, slot heights, conflict thresholds) embedded instead of centralized constants/config.
8. (High) Unpinned dependencies in `requirements.txt`; reproducibility / supply-chain risk.
9. (Medium) Lack of structured logging (both backend & frontend) impedes debugging; reliance on `console.error` and `alert()`.
10. (Medium) Missing security / operational basics: no rate limiting, CORS config, auth, input sanitization beyond minimal Pydantic validators.

---
## Detailed Issues by Severity

### Critical
1. **Documentation & API Contract Drift**  
   - README describes endpoints (`/todos`, numeric IDs, description/completed fields) not implemented.  
   - Impact: External consumers break; internal assumptions diverge; OpenAPI spec misleading.  
   - Fix: Rewrite README to reflect `/tasks/` model, fields (`title`, `duration`, `scheduledStart`, `recurrence`), add request/response examples. Auto-generate docs section from FastAPI schema.
2. **Absent Test Suite**  
   - No unit/integration tests for validation, scheduling, recurrence expansion, conflict detection, Firestore persistence.  
   - Fix: Introduce pytest; start with model validation tests, CRUD API tests using Firestore emulator, recurrence & conflict detection pure-function tests; add minimal frontend e2e (Playwright) later.
3. **Firestore Initialization & Error Handling**  
   - Global `db = firestore.Client()` assumes ambient credentials; no try/except or fallback; fails silently if misconfigured.  
   - Fix: Wrap init, log structured error, supply env-based project ID, warn if emulator wanted. Provide health endpoint to verify connectivity.
4. **Data Consistency / Partial Update Approach**  
   - `create_task` uses raw dict; inconsistent validation path vs other endpoints; returning only `{id}` deprives client of canonical server state.  
   - Fix: Accept `TaskCreate` model; return created `Task` with server defaults. Ensure consistent `response_model` usage across endpoints.
5. **Potential Timezone Ambiguity**  
   - `scheduledStart` stored as naive ISO (no TZ). Calendar uses local browser time. Cross-timezone usage will misalign.  
   - Fix: Normalize to UTC with `Z` suffix; store and serve timezone-aware timestamps.

### High
6. **Frontend Monolith (`app.js`)**  
   - Single large file merging view rendering, domain logic, utilities.  
   - Fix: Refactor into modules: `api.js`, `state.js`, `calendar.js`, `recurrence.js`, `conflict.js`, `dialog.js`, `shortcuts.js`, `utils/date.js`.
7. **Performance: Recurrence & Conflict Detection**  
   - Recurrence expanded each render; conflict detection O(n^2).  
   - Fix: Precompute intervals; use sweep-line or interval tree; cache expansion by task + horizon bounds.
8. **Magic Numbers**  
   - Examples: `horizonDays = 30`, `max duration = 180`, slot heights (10/14/18/24/28), default scroll `(6*60+30)`; no central source.  
   - Fix: Introduce `config.js` exporting constants & allow env-driven overrides.
9. **Inconsistent Validation Layer Between Endpoints**  
   - `/tasks/` POST accepts incomplete dict; PUT uses `Task` model; divergence can introduce subtle bugs.  
   - Fix: Distinct Pydantic models: `TaskCreate`, `TaskUpdate`, `TaskRead`.
10. **No Pagination / Query Options**  
    - `list_tasks` streams entire collection; potential performance & memory issues for large sets.  
    - Fix: Add pagination (`limit`, `cursor`), filtering by scheduled / unscheduled.
11. **Lack of Domain Separation**  
    - Backend mixes HTTP layer & Firestore access directly inside route functions.  
    - Fix: Introduce repository/service abstraction (`TaskRepository`) for easier testing and future storage changes.
12. **Error Surfacing UX**  
    - Frontend uses `alert()`; jarring & not dismissable programmatically; no inline feedback.  
    - Fix: Toast/notification system; status banners with retry.
13. **No Retry / Backoff on Network Errors**  
    - Single `fetch` attempt; transient faults cause user frustration.  
    - Fix: Lightweight retry wrapper (exponential backoff for idempotent GET/PUT).
14. **Lack of Accessibility Review**  
    - Drag-and-drop calendar lacks keyboard scheduling; event blocks not focusable.  
    - Fix: Add ARIA roles, tabindex, keyboard schedule actions, skip link.

### Medium
15. **Unpinned Python Dependencies**  
    - `requirements.txt` lists packages without versions; introduces instability.  
    - Fix: Pin (`fastapi==...`, `uvicorn==...`, `google-cloud-firestore==...`, `gunicorn==...`); add `pip-tools` workflow.
16. **Unused / Questionable Dependency**  
    - `gunicorn` included but not used in `Procfile` (uses uvicorn directly).  
    - Fix: Remove `gunicorn` or adopt `gunicorn -k uvicorn.workers.UvicornWorker` configuration for multi-workers.
17. **Procfile Relevance**  
    - Heroku-style `Procfile` present but deployment strategy described is Cloud Run (Procfile not used).  
    - Fix: Clarify deployment docs; remove if not using Heroku/Railway/Render.
18. **Missing Structured Logging**  
    - Backend prints none; frontend uses `console.error`.  
    - Fix: Add Python `logging` config, unify request logs, correlation IDs; lightweight JS logger.
19. **Index Serving Strategy**  
    - Manual file read per request; no caching; blocks event loop briefly.  
    - Fix: Use `FileResponse` or integrate templating, or rely solely on mounted static.
20. **Model Evolution Risk**  
    - Recurrence schema fragile (dict with `type`/`days`).  
    - Fix: Define explicit Pydantic model with enum + constrained list.
21. **Lack of Dependency Health Checks**  
    - No `/health` or `/readiness` endpoints for Cloud Run.
22. **No CI Pipeline**  
    - README references deployment triggers but no lint/test pipeline defined.  
    - Fix: Add GitHub Actions (lint, type-check, tests).
23. **Hard-coded Collection Name**  
    - `todos` used; conceptually tasks/planner.  
    - Fix: Rename to `tasks` or configurable via env.
24. **Client-Side Conflict Detection Only Visual**  
    - Backend unaware; race conditions if multiple clients schedule simultaneously.  
    - Fix: Server-side transactional conflict check.
25. **Lack of Concurrency Controls**  
    - PUT overwrites fields; no versioning/etag.  
    - Fix: Add update precondition (last update timestamp or version).
26. **Front-End Global Mutable State**  
    - `state` object mutated broadly; testability issues.  
    - Fix: Introduce event-driven store or small observable pattern.
27. **Insufficient Error Classification**  
    - All failures -> generic `Error`; user cannot distinguish validation vs network vs server.
28. **Mixed Responsibility of Resize Handler**  
    - UI logic includes validation, conflict detection, revert semantics inside pointer events.  
    - Fix: Extract into service layer.
29. **No Code Style / Linting**  
    - Missing `ruff` / `black` / `eslint` configs.  
    - Fix: Add tooling & pre-commit hooks.
30. **Potential Memory Leaks**  
    - Repeated timers (`ensureNowIndicator`) risk multiple active if race occurs; guards exist but review.  
    - Fix: Centralize interval management.

### Low
31. **README Missing Project Vision / Roadmap**  
32. **GEMINI.md directives partial duplication with README; could merge**  
33. **CSS Organization** – Large file; could modularize / adopt naming convention (BEM/utility).  
34. **Inline SVG favicon encoded in HTML; alternative is static asset**  
35. **Variable Names** – Some abbreviations (`rs`, `t`, `inst`, `ex`) reduce readability.  
36. **Comments vs Code Drift Risk** – Top block comment in `app.js` will diverge without automated doc generation.  
37. **No dark/light theme toggle (only dark)**  
38. **Alerts Not Internationalized / No i18n Strategy**  
39. **Lack of Dependency Updates Procedure**  
40. **Exposed internal state `window.__plannerState` (debug); should guard for prod).**

### Enhancements / Strategic
41. **Authentication / Multi-user separation** – Currently assumes single user / global tasks.  
42. **Server-Side Recurrence Expansion** – Move logic backend for consistency & shared rules.  
43. **Real-time Updates** – WebSocket / SSE to push schedule changes.  
44. **Task Categories / Tagging** – Extend schema.  
45. **Analytics / Usage Metrics** – Scheduling frequency, focus time stats.  
46. **Offline / Optimistic UI** – Enable local queue & sync.  
47. **Infrastructure IaC** – Manage Cloud Run & Firestore with Terraform.  
48. **Observability** – Add OpenTelemetry traces for scheduling operations.  
49. **Mobile Responsive Optimization** – Enhance small-screen calendar interactions.  
50. **Accessibility Audit (WCAG AA)** – Color contrast, keyboard navigation improvements.

---
## Remediation Roadmap (Suggested Order)
1. Align documentation & API contract (Critical #1).  
2. Introduce test harness + CI (Critical #2 + Medium #22 + Medium #29).  
3. Refactor backend models & endpoints (Critical #4, High #9, Medium #20).  
4. Add logging, health, error handling (Critical #3, Medium #18, Medium #21).  
5. Pin dependencies & add security scanning (High #8, Medium #15).  
6. Modularize frontend (High #6, #7, #8, #26, #28).  
7. Implement server-side conflict + concurrency control (Medium #24, #25).  
8. Address timezone normalization (Critical #5).  
9. Pagination & filtering (High #10).  
10. Accessibility & UX improvements (High #14, Low #37, Enhancement #50).

---
## Proposed Structural Changes
- Backend folder layout:
  ```
  /app
    api/ (routers)
    models/ (pydantic schemas)
    services/ (business logic)
    repositories/ (Firestore abstraction)
    core/ (config, logging, settings)
    tests/
  ```
- Frontend layout:
  ```
  /static/js
    api.js
    state.js
    calendar/
      render.js
      recurrence.js
      conflict.js
    ui/
      dialog.js
      shortcuts.js
    utils/date.js
  ```

---
## Configuration & Constants Centralization (Examples)
| Name | Current | Suggested | Notes |
|------|---------|----------|-------|
| MAX_DURATION_MIN | scattered `180` | env / config constant | Enforce server & client consistency |
| RECURRENCE_HORIZON_DAYS | `30` | configurable | Allow future scaling |
| DEFAULT_SLOT_HEIGHTS | multiple | mapping by density | Single source of truth |
| COLLECTION_NAME | hard-coded `todos` | env `TASK_COLLECTION` | Future portability |

---
## Test Coverage Targets (Initial Sprint)
- Models: duration bounds, recurrence validation.
- API: create/list/update/delete tasks; conflict scenarios (to be added server-side).
- Recurrence: expansion logic (daily/weekly/custom edges, horizon boundaries).
- Conflict detection: overlapping edges (touching end-to-start should NOT conflict).

---
## Deferred / Watch Items
- Potential Firestore cost optimization (batch reads vs stream).  
- Large calendar performance for >500 tasks/day (profiling needed).  
- Future multi-timezone collaboration.
 
---

## Progress updates

- 2025-11-07: Issue #1 (README/API mismatch) — fixed: `README.md` updated to reflect `/tasks/` API and model fields.
- 2025-11-07: Issue #2 (tests) — added a minimal pytest suite covering Pydantic `Task` validation and a small API contract test that uses a fake in-memory Firestore replacement. Tests live in `tests/` and passed locally (9 passed, 0 failed).

- 2025-11-07: Issue #3 (Firestore init & health) — improved: Firestore client initialization is now wrapped, honors `FIRESTORE_PROJECT`/`GOOGLE_CLOUD_PROJECT`, logs emulator usage when `FIRESTORE_EMULATOR_HOST` is set, and a `/health` endpoint was added to verify connectivity. Endpoints now return 503 when datastore is unavailable instead of failing server boot.
- 2025-11-07: Issue #4 (create_task validation & response) — improved: `POST /tasks/` now accepts a typed `TaskCreate` payload, applies server-side defaults, validates by constructing the canonical `Task` model, and returns the created `Task` resource (including assigned `id`). This ensures consistent validation and a single canonical response shape.

- 2025-11-07: Issue #5 (scheduledStart timezone) — improved: server normalizes `scheduledStart` to canonical UTC ISO strings (e.g. `2025-11-07T09:30:00Z`). Frontend now emits UTC `Z`-terminated timestamps when scheduling so client/server behavior is consistent.

---
## Closing Notes
This file should be reviewed at the start of each sprint; resolved items move to a CHANGELOG and are removed or marked as fixed. New findings appended with date stamps.

Feel free to add initials after items when taking ownership (e.g., `(AY)`).
