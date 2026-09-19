# System Upgrade Progress — 2026-09-20

> Permanent state file. If this session dies, the next person/agent reads this
> and continues. Branch: `upgrade/system-wide-2026-09`, worktree:
> `.claude/worktrees/system-upgrade` (do NOT touch `authoring-ux` worktree).

## Ground rules (from mission)

1. Never touch `.claude/worktrees/authoring-ux` or its locks.
2. DB has real user data — no `init_db.ts`, no DROP/TRUNCATE. Schema changes
   via new numbered migrations only. Test data INSERTs must use a clear prefix.
3. Commits: no `Co-Authored-By` Claude lines.
4. Never merge to master ourselves — push branch `upgrade/system-wide-2026-09`
   to origin, wait for user approval.
5. Work only in this worktree.
6. Stack runs at http://localhost:8080 (HTTP_PORT=8080; port 80 is taken).
   Rebuild test: `HTTP_PORT=8080 docker-compose up --build -d backend frontend`.

## Phase 1: Baseline & Audit — IN PROGRESS

### Baseline test results (2026-09-20, commit d1df313)

| Suite | Result |
|---|---|
| Backend `npx tsc --noEmit` | ✅ clean |
| Backend `npm test` | ✅ 58 suites passed, 16 skipped (DB-gated); 529 tests passed, 137 skipped |
| Frontend `npm run validate` (type-check + lint + test:ci) | ✅ 90 suites / 478 tests passed; services coverage 95.12% stmts / 100% branches |

Noted during baseline:
- `submissions` table has **no indexes at all** (only authoring/contest tables
  have some) — big gap for analytics + profile queries. (Phase 2 candidate.)
- Test output is noisy: `adminDatabaseService.ts:85` console.log fires on every
  import-related test ("Dropping existing tables before import...").
- Visual regression suite `npm run test:visual` not yet run in this session
  (needs the stack; will run during Phase 4).
- Docker state at session start: **no containers running** (stack down).
  Real-data volume `oj_db-data` belongs to compose project `oj` (main
  checkout). Worktrees `authoring-ux` no longer exists on disk (merged &
  cleaned 2026-09-18 per memory). To test with real data later:
  `docker compose -p oj` from a checkout + `HTTP_PORT=8080`; running compose
  from this worktree directly would create a fresh empty `system-upgrade_db-data`
  volume (safe, but no real data). Decide per-task.

### Audit findings

Both audits ran 2026-09-20 (parallel agents). Full reports preserved below.

#### Backend audit — summary

Overall: backend in good shape — no TODO/FIXME debt, no SQL injection
vectors, auth coverage on admin/staff routes complete, rate limiting on
three tiers. Real problems: zero indexes on `submissions` (FIXED — 0010),
no structured logging (FIXED — logger util + wiring), magic values (FIXED —
constants consolidation).

Remaining from audit (not yet done):
- **Medium security**: `/admin/database/import-progress/:jobId` accepts
  token via `req.query.token` — query strings land in proxy access logs;
  prefer header-only (`x-import-token` already supported).
- **Medium**: analyticsController duplicates pagination defaults vs Zod
  schema defaults (comments admit Zod defaults "are not written back to
  req.query").
- **Medium**: judgeService.ts:65 parse-failure continues with stale timeMs
  (low severity, wrapper trusted).
- **Low**: problemController progress-id ad-hoc generation (could use uuid);
  batchUploadService drops underlying cause in config.json parse error.
- **Deferred decisions (user)**: node-cron 3→4, connect-pg-simple 9→10,
  uuid 9→14 major bumps.

#### Frontend audit — summary

- 🔴 **Analysis feature theming**: ~40 hardcoded hex in 9 CSS files
  (VerdictBadge 8 verdict colors, KpiCard green/red, error-red duplicates);
  `var(--accent-color)`/`var(--link-color)` referenced with `#0d6efd`
  fallbacks but the tokens are **undefined anywhere** — fallback always
  wins in both themes.
- 🔴 **TypeScript 4.9.5 pinned** while React 19 + rest of toolchain expect
  TS ≥5 — blocks @typescript-eslint upgrade (v5, three majors behind).
  `@types/react ^18` with `react ^19.1.1` mismatch.
- 🟡 No global ErrorBoundary; no 401/session-expiry interceptor in api.ts;
  no retry on fetch hooks.
- 🟡 SubmissionsTab missing `overflow-x: auto` (mobile overflow); analysis
  feature has zero `@media` queries.
- 🟡 ActivityHeatmap hardcoded light-mode greens (unreadable dark);
  UserProfile verdict dots; ModalLayout warning banner; react-datepicker
  light-only popup.
- 🟡 4 raw modals bypass accessible `ui/Dialog` (SubmissionModal,
  ProblemMigrationModal, EditUserModal, AddUserModal).
- 🟡 Home.tsx quote-box click-only (no role/tabIndex/keyboard).
- 🟡 jsx-a11y key rules disabled in .eslintrc.json.
- 🟡 Test gaps: analysis drill-downs (UserDetail/ProblemDetail/
  ContestDetail/KpiCard/VerdictBadge/analysisCharts), submission-flow
  components, ActivityHeatmap.
- 🟢 user-event v13 old (v14 current); `cors` dead dep in frontend;
  AuthorProfiles.tsx 491 lines > 400 limit.

<details>
<summary>Full backend audit report (preserved)</summary>

No TODO/FIXME/HACK/XXX markers in backend source or tests. Auth gates
verified complete route-by-route across all controllers (admin,
analytics, authoring*, contest, problem, submission, profile).
Intentionally public routes all reasonable. SQL injection: none — all
interpolations parameterized or whitelist-based (USER_SORT_COLUMNS /
PROBLEM_SORT_COLUMNS from Zod enums; metadataColumns static). Session
fixation handled (regenerate on login, httpOnly, sameSite lax, neutral
auth errors). Env Zod-validated, test fallbacks only under NODE_ENV=test.
Rate limiting three-tier (general 1000/15min, auth 10/15min, submit
30/min). Tests: 74 files, 137 DB-gated skipped by design (isolated
per-test schemas when INTEGRATION_DATABASE_URL set). Deps current except:
node-cron 3→4, connect-pg-simple 9→10, uuid 9→14, archiver 7→8,
express-sse 0.5→1.0, dotenv 17→18, htmlparser2 pinned 10 (12 current).

</details>

<details>
<summary>Full frontend audit report (preserved)</summary>

Zero TODO debt. Hooks own loading/error per STANDARDS. Theme = CSS vars
in index.css (:root + [data-theme='dark']) + ThemeContext. ~60 hardcoded
hex across 19 CSS-module files concentrated in analysis feature (worst),
UserProfile verdict dots, ActivityHeatmap, ScoreboardTable medals,
ModalLayout warning, ContestScoreboard. Breakpoints documented
(480/768/900/1200); OverflowTable pattern exists; SubmissionsTab missed
overflow-x. eslint jsx-a11y/recommended on but 4 key rules off
(click-events-have-key-events, no-static-element-interactions,
no-noninteractive-element-interactions, label-has-associated-control).
80 aria-* usages; 20 :focus rules. Constants discipline good
(POLLING_INTERVALS/UI_TIMEOUTS/UI_CONFIG); useAuthoringDraft has named
module constants outside config (AUTOSAVE_DELAY_MS 1200, JOB_POLL_MS 300).
Only AuthorProfiles.tsx (491) exceeds 400 lines. 90 test files; services
at threshold; analysis tab tests exist for 5 tabs but not drill-downs/
KpiCard/VerdictBadge/analysisCharts; submission-flow components untested.
Deps: typescript 4.9.5 pinned 🔴, @types/react ^18 vs react ^19 🟡,
react-scripts 5.0.1 (known-dead CRA — strategic Vite migration recorded,
not urgent), user-event ^13 (v14 current) 🟡, cors dead dep 🟢.

</details>

## Backlog (prioritized)

| # | Task | Phase | Status |
|---|---|---|---|
| 1 | submissions/contest_submissions indexes migration | 2 | ✅ done |
| 2 | Magic values → constants ('Accepted' x25, LIMIT 200, score 100, maxAge, saltRounds) | 2 | ✅ done |
| 3 | asyncHandler for raw try/catch controllers | 2 | ✅ done |
| 4 | Structured logger + failed-login logging + judge/scheduler wiring | 3 | ✅ done |
| 5 | import-progress token: drop query-string support (header only) | 3 | ✅ done |
| 6 | Analysis feature theming (~40 hex → tokens; define or remove --accent-color/--link-color) | 4 | ✅ done |
| 7 | TS 5 + @types/react 19 alignment | 2 | ✅ done (TS 5.5.4, legacy-peer-deps for CRA) |
| 8 | Global ErrorBoundary + 401 session-expiry interceptor | 3/4 | ✅ done |
| 9 | SubmissionsTab overflow-x + analysis mobile media queries | 4 | ✅ done |
| 10 | Dark mode: ActivityHeatmap, UserProfile dots, ModalLayout, datepicker | 4 | ✅ done (also medals, ContestScoreboard) |
| 11 | Raw modals → ui/Dialog (4 components) | 4 | ✅ done |
| 12 | Home quote-box keyboard a11y; re-enable jsx-a11y rules incrementally | 4 | ✅ done (all 4 rules on, 0 violations) |
| 13 | Tests: analysis drill-downs + submission-flow + ActivityHeatmap | 2/4 | ✅ done |
| 14 | CSV export for analysis data | 5 | ✅ done (E2E verified on stack at :8080) |
| 15 | Code-similarity / cheat detection for contests | 5 | ✅ done (E2E verified, tunable threshold) |
| 16 | Idle users / drop-off analytics | 5 | ✅ done (retention endpoint + UsersTab summary) |
| 17 | Compare 2 contests / 2 users side-by-side | 5 | ⬜ |
| 18 | analyticsController Zod-defaults dedup | 2 | ✅ done (validateRequest writeback) |
| 19 | Drop cors from frontend deps; user-event v14 | 2 | ✅ done |
| 20 | Split AuthorProfiles.tsx (491 lines) | 2 | ✅ done (287 + 3 units) |
| 21 | Dep majors (node-cron, connect-pg-simple, uuid) | 2 | ⬜ deferred → user decision |

## Backlog

_To be prioritized after audits land._

## Decisions needed from user (do not decide alone)

- Major DB schema changes beyond additive indexes.
- Removing features or swapping core dependencies.

## Phase 2 work log

### ✅ 0010_submission_indexes migration (committed)

`backend/migrations/0010SubmissionIndexes.ts` — additive `CREATE INDEX IF
NOT EXISTS` on: `submissions(user_id, problem_id, submitted_at DESC)`,
`contest_submissions(user_id, problem_id, submitted_at DESC, contest_id)`.
Users.username already has UNIQUE from 0001 (no new index needed).

Verification: applied all 10 migrations to a throwaway Postgres 16
container (separate from real data), seeded 50k submissions + 20k contest
submissions + 200 users/problems, ran EXPLAIN ANALYZE before/after:
- recent-submissions ORDER BY submitted_at DESC LIMIT 200: 21.2ms → 0.4ms
- user profile WHERE user_id: 2.4ms seq scan → bitmap index scan
- users analytics list (UNION ALL join): 24.9ms → 14.3ms
Migration tests updated in tests/migrations/ (3 files asserting version
list). Runner proven idempotent (second run = "already up to date").

## Final summary (2026-09-20, all phases complete)

Branch `upgrade/system-wide-2026-09` — 24 commits on top of d1df313 (master).
**Every suite green**: backend 587 passed / 137 DB-gated skipped (by design),
frontend 539 passed (102 suites), visual regression 4/4, production build
clean, full Docker stack rebuilt and exercised end-to-end at :8080 (login,
all analytics endpoints, CSV export download, cheat-detection UI, retention
summary, dark mode).

### Phase 2 — Sustainability & Code Quality
- 0010 submission-pool indexes (EXPLAIN-verified 21ms→0.4ms worst query)
- Magic values → constants ('Accepted' x25, LIMIT 200, full-score, maxAge,
  saltRounds, role literals)
- Raw try/catch controllers → asyncHandler + AppError
- TS 4.9.5 → 5.5.4 + @types/react 19 alignment (CRA needs
  --legacy-peer-deps for npm ops now)
- validateRequest writes Zod query defaults back into req.query (Express 5
  defineProperty), killing per-controller default duplication
- AuthorProfiles split 491 → 287 lines (hook + 2 components)
- Dead `cors` dep dropped; user-event v14

### Phase 3 — Security & Reliability
- Structured logger (utils/logger.ts) wired through judge pipeline,
  scheduler, migration, auth failures (failed logins were silent before)
- Import-progress token: query-string support removed (header-only) so it
  never lands in proxy access logs
- Global ErrorBoundary + 401 session-expiry interceptor with returnTo
- Fixed live bug: unquoted SUBMISSION_STATUS SQL interpolation (42703 at
  runtime) — caught by stack testing, regression-guarded by unit test

### Phase 4 — UX/UI
- Complete dark-mode tokenisation: analysis feature (~40 hex), VerdictBadge
  (--verdict-* + color-mix), ActivityHeatmap, UserProfile dots, ModalLayout
  warning, scoreboard medals, ContestScoreboard, react-datepicker
- Undefined --accent-color/--link-color fallback traps fixed
- 4 raw modals → accessible ui/Dialog (Escape, focus trap)
- Home quote-box keyboard a11y; all 4 jsx-a11y interaction rules
  re-enabled with zero violations (autocomplete suggestions became real
  buttons, migration rows got role=button + keyboard)
- SubmissionsTab overflow-x + phone-width filter stacking

### Phase 5 — New Features (all E2E-verified on the stack)
- CSV export (users/problems/submissions) — RFC 4180, staff-gated,
  10k-row cap, browser download verified
- Contest cheat detection — normalised token-stream similarity
  (strip comments, identifier/literal collapse, k=5 shingle Jaccard),
  /admin/contests/:id/similarity with tunable ?threshold, ContestDetail
  "Similar submissions" section; seeded contest verified (alice-bob 68%
  detected, genuinely-different carol not flagged)
- Retention analytics — /analytics/retention (active / idle 30+ days /
  never-submitted), UsersTab summary strip
- Side-by-side user comparison in analysis (no backend change)

### Deferred decisions for the user
- Major dep bumps: node-cron 3→4, connect-pg-simple 9→10, uuid 9→14,
  archiver 7→8, express-sse 0.5→1.0, dotenv 17→18, htmlparser2 10→12
- CRA → Vite migration (react-scripts 5.0.1 is dead upstream) — strategic,
  not urgent
- judgeService timeMs parse-failure keeps stale value (trusted wrapper,
  low severity)

## Phase status

- [x] Phase 1: Baseline & Audit
- [x] Phase 2: Sustainability & Code Quality
- [x] Phase 3: Security & Reliability
- [x] Phase 4: UX/UI Upgrade
- [x] Phase 5: New Features
- [x] Phase 6: Final Sweep
