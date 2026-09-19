# Analysis Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Analysis tab (`/admin/analysis`) for staff/admin with system overview, per-user, and per-problem analytics backed by on-the-fly SQL aggregation.

**Architecture:** New `analyticsController` + `analyticsQueryService` (parameterized SQL, following existing `*QueryService.ts` patterns) exposing 4 GET endpoints. New frontend feature module `features/admin/analysis/` with sub-tabs (Overview/Users/Problems), Recharts for charts, typed axios service. Submissions analytics UNION general `submissions` with `contest_submissions`.

**Tech Stack:** Express 5 + TypeScript (NodeNext, strict), PostgreSQL via `db.query`, Zod validation, React 19 + CRA, CSS modules, Recharts (new dependency), Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-19-analysis-mode-design.md`

## Global Constraints

- All backend SQL is parameterized (`$1`, `$2`, …) — never string-interpolated.
- All analytics routes: `requireAuth` + `requireStaffOrAdmin` (staff AND admin both allowed).
- Query validation in Zod schemas (`backend/schemas/requestSchemas.ts`), not ad-hoc checks.
- No schema migrations — existing tables only.
- `days` param accepts 7/30/90, default 30.
- Frontend styling: CSS modules matching existing admin panel; charts must respect dark/light theme.
- Run `cd frontend && npm run validate` and `cd backend && npm test` — both must pass before finishing.
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Recharts is the ONLY new frontend dependency.

---

### Task 1: Overview analytics query service

**Files:**
- Create: `backend/services/analyticsQueryService.ts`
- Test: `backend/tests/analyticsQueryService.test.ts`

**Interfaces:**
- Consumes: `query` from `backend/db.ts` (already exists: `query<T>(text, params): Promise<QueryResult<T>>`)
- Produces: `getOverviewAnalytics(days: number): Promise<OverviewAnalytics>` where:

```ts
export interface OverviewKpi {
  current: number;
  previous: number;
}
export interface OverviewAnalytics {
  kpis: {
    submissions: OverviewKpi;
    uniqueSubmitters: OverviewKpi;
    accepted: OverviewKpi;           // count of AC-verdict submissions
    newUsers: OverviewKpi;
    newProblems: OverviewKpi;
  };
  dailySeries: Array<{ day: string; total: number; accepted: number; }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  topProblems: Array<{ problemId: string; title: string; submissions: number; accepted: number }>;
  topSubmitters: Array<{ userId: number; username: string; submissions: number; solved: number }>;
  contestStats: Array<{ contestId: number; title: string; status: string; submissions: number; participants: number; avgScore: number }>;
}
```

- [ ] **Step 1: Write the failing test**

The test mocks `../db` (same pattern as `backend/tests/adminController.test.ts`) — no real DB. It asserts `getOverviewAnalytics` runs one query per data group and maps rows to the interface. Since mapping happens in SQL, the tests assert on the returned shape given mocked query results and on the SQL text containing the expected clauses (window comparison, UNION ALL of submissions + contest_submissions, `date_trunc('day'`).

```ts
import { getOverviewAnalytics } from '../services/analyticsQueryService';
import * as db from '../db';

jest.mock('../db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('analyticsQueryService.getOverviewAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns KPIs with current/previous windows from the query result', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_submissions: 100, previous_submissions: 80, current_submitters: 10, previous_submitters: 8, current_accepted: 60, previous_accepted: 40 }],
    } as never);
    // ... three more mockResolvedValueOnce for newUsers/newProblems row,
    // dailySeries rows, verdictBreakdown rows, topProblems rows,
    // topSubmitters rows, contestStats rows — in the order the service queries.

    const result = await getOverviewAnalytics(30);

    expect(result.kpis.submissions).toEqual({ current: 100, previous: 80 });
    expect(result.dailySeries).toBeDefined();
    expect(mockQuery).toHaveBeenCalledTimes(7);
  });

  it('queries with days parameter for the window boundary', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] } as never);
    await getOverviewAnalytics(7);
    const firstCall = mockQuery.mock.calls[0];
    expect(firstCall[1]).toEqual([7, 7]); // current + previous window params
  });
});
```

(The test file expands each mock to the full row shape the service returns — write complete mocks for all 7 queries, not ellipses.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/analyticsQueryService.test.ts`
Expected: FAIL — module `../services/analyticsQueryService` does not exist

- [ ] **Step 3: Write minimal implementation**

```ts
import { query } from '../db';

export interface OverviewKpi {
  current: number;
  previous: number;
}

export interface OverviewAnalytics {
  kpis: {
    submissions: OverviewKpi;
    uniqueSubmitters: OverviewKpi;
    accepted: OverviewKpi;
    newUsers: OverviewKpi;
    newProblems: OverviewKpi;
  };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  topProblems: Array<{ problemId: string; title: string; submissions: number; accepted: number }>;
  topSubmitters: Array<{ userId: number; username: string; submissions: number; solved: number }>;
  contestStats: Array<{ contestId: number; title: string; status: string; submissions: number; participants: number; avgScore: number }>;
}

interface KpiRow {
  current_submissions: string;
  previous_submissions: string;
  current_submitters: string;
  previous_submitters: string;
  current_accepted: string;
  previous_accepted: string;
}

interface NewUsersRow { current_users: string; previous_users: string }
interface NewProblemsRow { current_problems: string; previous_problems: string }
interface DailyRow { day: string; total: string; accepted: string }
interface VerdictRow { verdict: string; count: string }
interface TopProblemRow { problem_id: string; title: string; submissions: string; accepted: string }
interface TopSubmitterRow { user_id: number; username: string; submissions: string; solved: string }
interface ContestStatRow { contest_id: number; title: string; status: string; submissions: string; participants: string; avg_score: string | null }

const toNum = (v: string | number | null): number => (v === null ? 0 : Number(v));

export const getOverviewAnalytics = async (days: number): Promise<OverviewAnalytics> => {
  const kpiResult = await query<KpiRow>(`
    WITH all_submissions AS (
      SELECT user_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT user_id, overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      COUNT(*) FILTER (WHERE submitted_at >= NOW() - ($1 || ' days')::interval) AS current_submissions,
      COUNT(*) FILTER (WHERE submitted_at >= NOW() - ($2 || ' days')::interval
                         AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_submissions,
      COUNT(DISTINCT user_id) FILTER (WHERE submitted_at >= NOW() - ($1 || ' days')::interval) AS current_submitters,
      COUNT(DISTINCT user_id) FILTER (WHERE submitted_at >= NOW() - ($2 || ' days')::interval
                                        AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_submitters,
      COUNT(*) FILTER (WHERE overall_status = 'accepted' AND submitted_at >= NOW() - ($1 || ' days')::interval) AS current_accepted,
      COUNT(*) FILTER (WHERE overall_status = 'accepted' AND submitted_at >= NOW() - ($2 || ' days')::interval
                         AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_accepted
    FROM all_submissions`,
    [days, days * 2]);
  // ... six more queries: newUsers/newProblems (same FILTER pattern against users/problems created_at),
  // dailySeries (date_trunc('day', submitted_at) over the union, GROUP BY day ORDER BY day),
  // verdictBreakdown (overall_status counts over the union in window),
  // topProblems (join union to problems on id, GROUP BY problem, ORDER BY count DESC LIMIT 10),
  // topSubmitters (join union to users, solved = COUNT(DISTINCT problem_id) where score=100 —
  //   NOTE: contest_submissions has no score semantics identical to submissions; use best-score CTE
  //   pattern from userProfileQueryService.ts best_scores),
  // contestStats (contest_submissions joined to contests + contest_scoreboards, GROUP BY contest).
  // Map every row to camelCase with toNum before returning.
  ...
};
```

Write the full SQL for all 7 queries — the shapes above are exact. Follow `getUserProfileStats` in `backend/services/userProfileQueryService.ts` (the `WITH user_submissions AS (... UNION ALL ...)` + `best_scores` CTE pattern) for anything needing best-score semantics.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/analyticsQueryService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/analyticsQueryService.ts backend/tests/analyticsQueryService.test.ts
git commit -m "feat(backend): add overview analytics query service"
```

---

### Task 2: Per-user and per-problem analytics query functions

**Files:**
- Modify: `backend/services/analyticsQueryService.ts`
- Test: `backend/tests/analyticsQueryService.test.ts`

**Interfaces:**
- Consumes: `query` from `backend/db.ts`
- Produces (added to same file):

```ts
export interface UserListRow {
  userId: number; username: string; role: string;
  submissions: number; solved: number; acRate: number; lastActive: string | null;
}
export const listUsersForAnalytics = async (search: string, limit: number, offset: number): Promise<UserListRow[]>

export interface UserAnalytics {
  user: { id: number; username: string; role: string; createdAt: string };
  kpis: { submissions: number; solved: number; attempted: number; acRate: number; totalScore: number };
  dailySeries: Array<{ day: string; count: number }>;
  hourHistogram: Array<{ hour: number; count: number }>;   // 0-23
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  cumulativeSolved: Array<{ day: string; solved: number }>;
  solvedByCategory: Array<{ category: string; solved: number; attempted: number }>;
}
export const getUserAnalytics = async (userId: number): Promise<UserAnalytics | null>  // null = user not found

export interface ProblemAnalytics {
  problem: { id: string; title: string; createdAt: string };
  kpis: { submissions: number; accepted: number; acRate: number; uniqueSubmitters: number };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  testcasePassRates: Array<{ caseNumber: number; passRate: number }>;  // from results JSONB
  runtimeBuckets: Array<{ bucket: string; count: number }>;           // e.g. '0-100ms','100-250ms','250-500ms','500ms-1s','>1s'
  memoryBuckets: Array<{ bucket: string; count: number }>;
  firstSolves: Array<{ userId: number; username: string; submittedAt: string }>;  // first 10 chronologically
}
export const getProblemAnalytics = async (problemId: string): Promise<ProblemAnalytics | null>
```

- [ ] **Step 1: Write the failing tests** — same mocked-`db` pattern as Task 1. Cover: `listUsersForAnalytics` passes `[search, limit, offset]` params and maps rows; `getUserAnalytics` returns `null` when the user query returns no rows; `getProblemAnalytics` maps testcase pass rates from a mocked JSONB-aggregated row (`{ case_number: 3, total: 10, passed: 7 }` → `{ caseNumber: 3, passRate: 0.7 }`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/analyticsQueryService.test.ts`
Expected: FAIL — exports do not exist

- [ ] **Step 3: Implement** — same style as Task 1. Notes:
  - `getUserAnalytics`/`getProblemAnalytics`: first query the `users`/`problems` row; if empty, return `null` (controller turns this into a 404).
  - `testcasePassRates`: aggregate with a lateral/jsonb query — `jsonb_array_elements(results)` and count per `case_number` where the element's status is accepted; compute `passRate = passed / total`.
  - `hourHistogram`: `EXTRACT(HOUR FROM submitted_at)` over the union for this user.
  - `runtimeBuckets`/`memoryBuckets`: `width_bucket(max_time_ms, ARRAY[0,100,250,500,1000])` and similar for memory, labeled with the bucket strings above.
  - `solvedByCategory`: join union to `problems.category` (nullable — map null to `'uncategorized'`).
  - `listUsersForAnalytics`: `WHERE username ILIKE '%' || $1 || '%'` with the `best_scores` CTE pattern for solved.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- tests/analyticsQueryService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/analyticsQueryService.ts backend/tests/analyticsQueryService.test.ts
git commit -m "feat(backend): add per-user and per-problem analytics queries"
```

---

### Task 3: Analytics controller + Zod schemas + server registration

**Files:**
- Create: `backend/controllers/analyticsController.ts`
- Modify: `backend/schemas/requestSchemas.ts`
- Modify: `backend/server.ts` (import + `app.use('/', analyticsRouter)`)
- Test: `backend/tests/analyticsController.test.ts`

**Interfaces:**
- Consumes: `getOverviewAnalytics`, `listUsersForAnalytics`, `getUserAnalytics`, `getProblemAnalytics` from Task 1–2
- Produces: mounted routes `GET /analytics/overview`, `GET /analytics/users`, `GET /analytics/users/:userId`, `GET /analytics/problems/:problemId`

- [ ] **Step 1: Write the failing test** — copy the setup block from `backend/tests/adminController.test.ts` (supertest + express-session + `jest.mock('../db')` + auth middleware mock). Cases:
  1. `GET /analytics/overview` returns 200 and calls `getOverviewAnalytics` with `30` when no query; with `?days=7` passes `7`.
  2. `GET /analytics/overview?days=45` returns 400 (Zod rejects values outside 7/30/90).
  3. `GET /analytics/users/:userId` returns 404 when `getUserAnalytics` resolves `null` (mock `../services/analyticsQueryService`).
  4. `GET /analytics/problems/:problemId` returns 200 with mapped camelCase body.
  5. Role gating: re-mock the auth middleware so `requireStaffOrAdmin` calls `next(new AppError('Forbidden', 403))` — assert 403 (this documents that the route uses `requireStaffOrAdmin`, since the default mock can't distinguish).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/analyticsController.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement**

Zod schemas (add to `backend/schemas/requestSchemas.ts`):

```ts
export const analyticsOverviewQuerySchema = z.object({
  body: z.object({}).strict(),
  query: z.object({
    days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30, or 90').default(30),
  }).strict(),
  params: z.object({}).strict(),
});

export const analyticsUsersQuerySchema = z.object({
  body: z.object({}).strict(),
  query: z.object({
    search: z.string().trim().max(100).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
  params: z.object({}).strict(),
});

export const analyticsUserIdParamSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({ userId: z.coerce.number().int().positive() }).strict(),
});

export const analyticsProblemIdParamSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({ problemId: z.string().min(1).max(50) }).strict(),
});
```

(First check how existing schemas in the file are shaped — if they use `{ body, query, params }` nesting for `validateRequest`, match that; if they define separate per-location schemas, match that instead. The block above assumes the nested form used by `validateRequest({ query: ... })`.)

Controller:

```ts
import express, { Request, Response, Router } from 'express';
import { requireStaffOrAdmin } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  getOverviewAnalytics, listUsersForAnalytics, getUserAnalytics, getProblemAnalytics,
} from '../services/analyticsQueryService';
// schemas from Task 3 Step 3

const router: Router = express.Router();

router.get('/analytics/overview', requireStaffOrAdmin,
  validateRequest({ query: analyticsOverviewQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 30);
    res.json(await getOverviewAnalytics(days));
  }));
// ... users list, user detail (404 via AppError when null), problem detail (same)
```

Register in `server.ts` next to the other controllers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- tests/analyticsController.test.ts`
Expected: PASS. Also run the full backend suite (`npm test`) to catch regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/analyticsController.ts backend/schemas/requestSchemas.ts backend/server.ts backend/tests/analyticsController.test.ts
git commit -m "feat(backend): add analytics controller with staff/admin gating"
```

---

### Task 4: Frontend service + route + nav

**Files:**
- Create: `frontend/src/services/analyticsService.ts`
- Modify: `frontend/src/App.tsx` (route)
- Modify: `frontend/src/layouts/admin/AdminNavbar.tsx` (nav item)
- Test: `frontend/src/tests/analyticsService.test.ts`

**Interfaces:**
- Consumes: `api` from `frontend/src/services/api.ts` (existing axios instance)
- Produces:

```ts
export interface OverviewResponse { /* mirrors backend OverviewAnalytics, camelCase */ }
export interface UserListResponse { users: UserListRow[]; }
export interface UserAnalyticsResponse { /* mirrors UserAnalytics */ }
export interface ProblemAnalyticsResponse { /* mirrors ProblemAnalytics */ }

export const fetchOverview = async (days: number): Promise<OverviewResponse>;
export const fetchAnalyticsUsers = async (params: { search?: string; limit?: number; offset?: number }): Promise<UserListResponse>;
export const fetchUserAnalytics = async (userId: number): Promise<UserAnalyticsResponse>;
export const fetchProblemAnalytics = async (problemId: string): Promise<ProblemAnalyticsResponse>;
```

- [ ] **Step 1: Write the failing test** — follow the mocking pattern of an existing service test (look at `frontend/src/tests/` for the established axios-mock style; coverage on `src/services/*.ts` is enforced at 85% branches / 90% lines, so cover all four functions including the `search`/`limit`/`offset` param mapping).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npm test -- src/tests/analyticsService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** — four typed axios GETs (`/analytics/overview?days=`, `/analytics/users`, `/analytics/users/:userId`, `/analytics/problems/:problemId`) returning `response.data`. Add route in `App.tsx`:

```tsx
<Route path="analysis" element={<AnalysisPage />} />
```

inside the `/admin` `AdminLayout` block, with lazy import matching the existing style in that file. Add to `AdminNavbar.tsx` in the staff+admin block (next to Problems/Contests):

```tsx
<li>
  <NavLink to="/admin/analysis" onClick={closeMenu}>
    Analysis
  </NavLink>
</li>
```

Create a placeholder `frontend/src/features/admin/analysis/AnalysisPage.tsx` returning `<div>Analysis</div>` so routing compiles (replaced in Task 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && CI=true npm test -- src/tests/analyticsService.test.ts && npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/analyticsService.ts frontend/src/App.tsx frontend/src/layouts/admin/AdminNavbar.tsx frontend/src/features/admin/analysis/AnalysisPage.tsx frontend/src/tests/analyticsService.test.ts
git commit -m "feat(frontend): add analytics service, route, and nav entry"
```

---

### Task 5: Overview tab UI

**Files:**
- Create: `frontend/src/features/admin/analysis/AnalysisPage.tsx` (replace placeholder — sub-tab shell)
- Create: `frontend/src/features/admin/analysis/OverviewTab.tsx`
- Create: `frontend/src/features/admin/analysis/components/KpiCard.tsx` + `KpiCard.module.css`
- Create: `frontend/src/features/admin/analysis/components/ChartCard.tsx` + `ChartCard.module.css`
- Create: `frontend/src/features/admin/analysis/analysisCharts.ts` (color sets per theme)
- Test: `frontend/src/tests/analysisOverviewTab.test.tsx`

**Interfaces:**
- Consumes: `fetchOverview` from Task 4, Recharts (`LineChart`, `BarChart`, `PieChart`, `Tooltip`, `ResponsiveContainer`)
- Produces: `AnalysisPage` with internal sub-tab state: `'overview' | 'users' | 'problems'`; renders `OverviewTab` for the overview case

- [ ] **Step 1: Install Recharts**

Run: `cd frontend && npm install recharts`
Verify it appears in `package.json` dependencies. Commit as its own step:

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add recharts dependency"
```

- [ ] **Step 2: Write the failing test** — render `OverviewTab` with a mocked `fetchOverview` (jest.mock the service module). Assert: KPI cards render with mock values; a day-range selector (7/30/90 buttons) exists and clicking 7 re-fetches with `7`; loading and error states render fallback text. Use the testing-library patterns from an existing admin feature test (see `frontend/src/features/admin/users/` tests or `src/tests/`).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && CI=true npm test -- src/tests/analysisOverviewTab.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement**
  - `AnalysisPage`: header + three sub-tab buttons driven by local state (simple conditional render, no URL param needed); wraps content in the admin page container styling.
  - `OverviewTab`: `useState` for `days` (default 30) + `useEffect` fetch on change; KPI row (5 `KpiCard`s — value + delta% vs previous window, green up / red down); `ChartCard` with `LineChart` for daily submissions + accepted; `BarChart` for verdict breakdown; `PieChart` for verdict share; two leaderboard tables (top problems, top submitters) + contest stats table. All tables link out: top problems → `/problems/:id`, top submitters → `/profile/:username` (existing routes).
  - `analysisCharts.ts`: export `const CHART_COLORS = { light: {...}, dark: {...} }` and a `useChartColors()` hook reading `ThemeContext` theme — text/grid/series colors per theme.
  - `ChartCard`: card container with title + children; `ResponsiveContainer` inside.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && CI=true npm test -- src/tests/analysisOverviewTab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/analysis/ frontend/src/tests/analysisOverviewTab.test.tsx
git commit -m "feat(frontend): add analysis overview tab with KPIs and charts"
```

---

### Task 6: Users tab + user detail

**Files:**
- Create: `frontend/src/features/admin/analysis/UsersTab.tsx`
- Create: `frontend/src/features/admin/analysis/UserDetail.tsx`
- Create: `frontend/src/features/admin/analysis/components/VerdictBadge.tsx` (+ module css)
- Test: `frontend/src/tests/analysisUsersTab.test.tsx`

**Interfaces:**
- Consumes: `fetchAnalyticsUsers`, `fetchUserAnalytics` from Task 4; `KpiCard`, `ChartCard`, `useChartColors` from Task 5
- Produces: `UsersTab` (search box + paginated table) and `UserDetail` (full analytics for one user); `AnalysisPage` gains `selectedUserId` state — clicking a user row switches to the user-detail view with a back button

- [ ] **Step 1: Write the failing test** — mock the service; assert the table renders mock users, typing in the search box triggers a fetch with `search`, and clicking a row shows `UserDetail` (mocked `fetchUserAnalytics` data rendered: KPIs, hour histogram chart, verdict breakdown). Back button returns to the list.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npm test -- src/tests/analysisUsersTab.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**
  - `UsersTab`: debounced search input (300ms, matching any existing debounce pattern in the codebase — check `features/admin/users` first), table columns: username, role, submissions, solved, AC rate, last active. Limit 50 with Next/Prev pagination via `offset`.
  - `UserDetail`: KPI row (`KpiCard`s), `LineChart` daily submissions, `BarChart` hour-of-day histogram, `PieChart`/list verdict breakdown, `BarChart` language usage, `LineChart` cumulative solved, `BarChart` solved-by-category.
  - `VerdictBadge`: colored chip per verdict status using `SUBMISSION_STATUS` colors if the frontend has them (check `utils/constants`); otherwise map the standard set (accepted/WR/TLE/MLE/RE/CE) to a small palette.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && CI=true npm test -- src/tests/analysisUsersTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin/analysis/ frontend/src/tests/analysisUsersTab.test.tsx
git commit -m "feat(frontend): add analysis users tab with user drill-down"
```

---

### Task 7: Problems tab + problem detail

**Files:**
- Create: `frontend/src/features/admin/analysis/ProblemsTab.tsx`
- Create: `frontend/src/features/admin/analysis/ProblemDetail.tsx`
- Test: `frontend/src/tests/analysisProblemsTab.test.tsx`

**Interfaces:**
- Consumes: `fetchProblemAnalytics` from Task 4; `KpiCard`, `ChartCard`, `useChartColors`, `VerdictBadge` from Tasks 5–6
- Produces: `ProblemsTab` (problem picker) and `ProblemDetail` (full analytics for one problem); `AnalysisPage` gains `selectedProblemId` state, same drill-down pattern as users

- [ ] **Step 1: Write the failing test** — mock the service; assert problem detail renders KPIs, verdict distribution chart, testcase pass-rate bars (mock: case 3 at 70%), and first-solves table. Back button returns.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npm test -- src/tests/analysisProblemsTab.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**
  - `ProblemsTab`: reuse the existing problem-list fetching (check `services/problemService.ts` / admin problems service for a list endpoint with visibility flag — staff can see hidden problems) as the picker; selecting loads `ProblemDetail`.
  - `ProblemDetail`: KPI row, `BarChart` verdict distribution, `LineChart` submissions per day, `BarChart` per-testcase pass rate (case number x-axis, 0–100% y), `BarChart` runtime buckets + memory buckets (side by side), first-solves table (username → profile link).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && CI=true npm test -- src/tests/analysisProblemsTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin/analysis/ frontend/src/tests/analysisProblemsTab.test.tsx
git commit -m "feat(frontend): add analysis problems tab with problem drill-down"
```

---

### Task 8: Final validation + visual check

**Files:**
- No new files — verification task

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all PASS

- [ ] **Step 2: Full frontend validation**

Run: `cd frontend && npm run validate`
Expected: type-check + lint + tests all PASS

- [ ] **Step 3: Manual smoke test with the running stack**

Run: `docker-compose up --build -d`, then open `http://localhost/admin/analysis` as a staff or admin user. Verify: overview loads with charts in both light and dark themes, users tab drill-down works, problems tab drill-down works. Check the browser console for errors.

- [ ] **Step 4: Commit any fixes found during validation**

```bash
git add -A
git commit -m "fix: analysis mode validation fixes"
```

(Skip if nothing to fix.)
