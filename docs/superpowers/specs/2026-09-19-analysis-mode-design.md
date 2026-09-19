# Analysis Mode — Design

Date: 2026-09-19
Branch: `analysis-mode`

## Goal

A new **Analysis** tab in the staff/admin panel (`/admin/analysis`, visible to both
`staff` and `admin` roles) that surfaces system, per-user, and per-problem analytics.
Priorities (user-confirmed): (1) system overview, (2) per-user activity/progress,
(3) per-problem quality. Code-similarity/cheat detection is explicitly out of scope.

## Decisions (user-confirmed)

- **Approach**: on-the-fly SQL aggregation via a dedicated analytics query service —
  no materialized views, no precomputed caches, no schema migrations.
- **Charts**: add **Recharts** as the only new frontend dependency.
- **Drill-down for users**: activity overview + progress (cumulative solved, difficulty
  progression). No similarity detection.

## Backend

### Controller: `backend/controllers/analyticsController.ts`

Mounted at `/` in `server.ts` like the other controllers. Every route uses
`requireAuth` + `requireStaffOrAdmin` (matches the Problems/Contests nav items).
Query params validated with Zod schemas in `schemas/requestSchemas.ts`.

### Query service: `backend/services/analyticsQueryService.ts`

All SQL lives here as parameterized queries, following the existing
`*QueryService.ts` pattern. Submissions analytics union general `submissions` and
`contest_submissions` where both exist (problem/user level), so contest activity is
not invisible to the analysis tab.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET /analytics/overview?days=30` | KPI cards (submissions, unique submitters, AC rate, new users, new problems — each vs. the previous equal-length window), daily time-series (submissions, ACs, verdict breakdown), top problems by submissions, top submitters, per-contest stats (submissions, participants, avg score) |
| `GET /analytics/users?search=&limit=&offset=` | User list with aggregate stats (submissions, solved, AC rate, last active) for search + drill-down |
| `GET /analytics/users/:userId` | Single user: submissions per day, hour-of-day histogram, verdict breakdown, language usage, cumulative solved over time, solved by difficulty/category |
| `GET /analytics/problems/:problemId` | Single problem: AC rate, verdict distribution, submissions per day, per-testcase pass rate (from `results` JSONB), runtime/memory distribution, first-solve order |

`days` accepts 7/30/90 (default 30). Errors follow `asyncHandler` + `AppError`
(404 for missing user/problem).

## Frontend

### Structure

- `frontend/src/features/admin/analysis/` — new feature module:
  - `AnalysisPage.tsx` — tab shell with internal sub-tabs (Overview / Users / Problems)
  - `OverviewTab.tsx`, `UsersTab.tsx`, `UserDetail.tsx`, `ProblemsTab.tsx`, `ProblemDetail.tsx`
  - `components/` — `KpiCard`, `ChartCard` (wrapper for consistent chart theming), `VerdictBadge`
- `frontend/src/services/analyticsService.ts` — typed axios client following the
  existing service pattern
- Route `/admin/analysis` registered in `App.tsx` inside the `AdminLayout`
- Nav item "Analysis" added to `AdminNavbar` for `staff` + `admin` (same gating as
  Problems/Contests)
- CSS modules, matching the existing admin panel styling; charts must respect the
  existing dark/light `ThemeContext`

### Charts

Recharts (`LineChart` for time-series, `BarChart` for distributions/histograms,
`PieChart` for verdict breakdown). Colors defined once per chart set, with light/dark
variants read from the theme context.

## Testing

- **Backend**: Jest tests for `analyticsQueryService` (aggregation correctness against
  a seeded test DB) and `analyticsController` (route auth: `user` role rejected,
  `staff`/`admin` allowed; validation errors) — following existing controller test
  patterns.
- **Frontend**: tests colocated with the feature module (rendering + service mocks),
  following existing admin feature test conventions. `npm run validate` must pass
  before finishing.

## Non-goals / future work

- Code-similarity / cheat detection
- Export to CSV/PDF
- Real-time push (stays request-based; no polling loop needed for this tab)
