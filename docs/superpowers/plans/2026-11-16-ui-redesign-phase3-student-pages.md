# UI Redesign Phase 3 — Student Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every page a student uses daily: Home, Problems, Problem detail with the inline result, Submissions and the submission detail page, Ranking, Profile, Auth, the guest home and 404. Build them on the phase 2 shell and components. Add the backend data they need: B1 (collection progress), B2 (server-side status filter and counts) and B3 (XP ranking with a weekly window).

**Architecture:** The backend work is additive.
- One new migration (an index).
- New query params on `/problems-with-stats` and `/submissions`.
- A new `/problem-status-counts` route and a new `/me/home` route.
- `/scoreboard` changes shape: it becomes a paged XP ranking.
- One shared ranking query that both `/scoreboard` and the profile's global rank use.

On the frontend, the pages are rewritten in place (same routes) on `PageHeader`, `FilterBar`, `DataTable`, `VerdictText`, `TestcaseStrip`, `ProgressBar` and the other `components/ui` primitives. A new shared `SubmissionResult` renders the verdict header and case table for both the inline result and the submission detail route.

**Tech Stack:** Express 5 + TypeScript, raw SQL (`pg`), Zod, Jest + supertest (backend). React 19, Vite, CSS Modules, Jest + RTL, Playwright (frontend). Base UI is already installed. recharts is kept for the radar.

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` (§5, §7.1–7.6, §7.10, §9 B1–B3, §10 phase 3). Mockups in `docs/superpowers/specs/2026-11-15-ui-redesign/`:
- `home-merged.html`: Home
- `key-pages.html` §1–2: Problems, Problem detail
- `phase3-pages.html`: Profile with the radar, and the phone views

Figma page "Phase 3 · Review" in file `1LcruSmMzO1hBruNrGWate` holds Submissions, Submission detail, Ranking, Profile, Log in, Register, private-site login, Guest home and 404. The owner approved all of these on 2026-11-16.

## Global Constraints

- **Copy:** UI copy stays English. No emoji, no gradients, no decorative icons. Icons are Phosphor only: regular for nav and actions, bold for status marks.
- **Colour and type:** colours come only from tokens in `frontend/src/index.css`. Fonts go through `--font-family-sans-serif` / `--font-family-mono`. The design guards in `frontend/src/tests/design/` must stay green.
- **Verdicts:** always shown as mono uppercase text plus a status mark (use `VerdictText` / `StatusMark`), never colour alone.
- **Layout:** one content width (`--content-max-width`, 1040px) and the same page padding everywhere. Every page uses `PageHeader` except Home (which has its own date line + heading per §7.1) and the AuthShell pages.
- **Libraries:** use only Base UI + cmdk + NumberFlow (NumberFlow is not needed in this phase). recharts stays for the radar. No new UI libraries.
- **Solved:** best score = `SUBMISSION_QUERY_CONFIG.FULL_PROBLEM_SCORE` (100) on `submissions`. Use this one definition for B1, B2 and Home.
- **Status buckets (B2):**
  - *unsolved* = no submission;
  - *attempted* = at least one submission and best < 100;
  - *solved* = best = 100.
  - The three counts partition *all* (mockup: 97 + 7 + 38 = 142).
- **Day buckets:** follow `ANALYTICS_TIMEZONE` (Asia/Bangkok), the same expression as the profile's `dailyActivity`.
- **Ranking:**
  - Competition ranking (`RANK()`: 1, 2, 2, 4) over XP from `user_problem_rewards.xp_awarded`.
  - The weekly window is `awarded_at >= NOW() - INTERVAL '7 days'`.
  - Level and tier always come from all-time XP.
  - Page size is 50.
- **Tests:**
  - Backend: `cd backend && npm test`. Integration suites need `INTEGRATION_DATABASE_URL`; run them through `tests/authoring/compose.yml` as CI does.
  - Frontend: `cd frontend && npm run validate`. `npm test` is watch mode; never use it in scripts.
- **Commits:**
  - No `Co-Authored-By` trailer; the owner is the sole author.
  - PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Branch:** `ui-redesign/phase3-student-pages`, stacked on `ui-redesign/phase2b-components`. Ship as three PRs in a stack:
  - 3a = Tasks 1–4 (backend)
  - 3b = Tasks 5–9 (practice pages)
  - 3c = Tasks 10–15 (the rest)
  - Each part ends with a push and a PR **only if the owner agreed at plan review**; otherwise commit and stop at the part boundary.

## Review Focus

1. **Guest in public mode on student pages.**
   - The Problems page must not send `status` and must hide the segmented control.
   - Home must not call `/me/home`.
   - Ranking shows no pinned "You" row.
   - Tests: Task 1 (`status` without a user → 400), Task 7 (guest render), Task 11 (`viewer: null`).
2. **Ties across a page boundary in Ranking.** Rank must be computed before `OFFSET`, so a tie split between pages 1 and 2 shows the same rank on both. Test: Task 3.
3. **Submissions whose `results` is a string (compile log) or null (still judging).**
   - The list strip renders nothing, not a crash.
   - The detail and inline result show the compile log or a pending state.
   - Tests: Task 4 (SQL shape on a string `results`), Task 8 (pending and compile-error renders).
4. **The inline result survives reload and a tab switch.** The submission id lives in the URL (`?tab=submit&submission=<id>`), and live updates fall back to polling when SSE is down. Test: Task 9.
5. **Profile with fewer than 3 categories that have problems.** A radar with 1–2 axes is meaningless: render the list only. Test: Task 12.

---

## Part A — Backend (PR 3a)

### Task 1: B2 — problem status filter and counts

**Files:**
- Create: `backend/migrations/0025SubmissionsUserProblemIndex.ts`
- Modify:
  - `backend/migrations/index.ts`
  - `backend/schemas/requestSchemas.ts` (`problemsWithStatsQuerySchema`; new `problemStatusCountsQuerySchema`)
  - `backend/services/problemQueryService.ts`
  - `backend/controllers/problemController.ts`
  - `backend/types/service.ts`
- Test:
  - `backend/tests/integration/problemsIncremental.test.ts` (new describe)
  - `backend/tests/problemController.test.ts`

**Interfaces:**
- Produces:
  - `type ProblemStatusFilter = 'solved' | 'attempted' | 'unsolved'`.
  - `ProblemListOptions.status?: ProblemStatusFilter`.
  - `getProblemStatusCounts(userId: number, options: ProblemListFilterOptions): Promise<ProblemStatusCounts>`, where `ProblemStatusCounts = { all: number; unsolved: number; attempted: number; solved: number }`.
  - `buildProblemListFilters(options: ProblemListFilterOptions, params: unknown[]): string[]`. This extracts the existing filter clauses (difficulty, search, category, author, collection) so both queries share them. `ProblemListFilterOptions` = `ProblemListOptions` minus `limit`, `cursor`, `sort`, `order`.
- Routes:
  - `GET /problems-with-stats?status=…`
  - `GET /problem-status-counts?<same filters>` (requirePublicAccess), returning `ProblemStatusCounts`. A guest gets `{ all, unsolved: all, attempted: 0, solved: 0 }`.

- [ ] **Step 1: Write the failing tests.**
  - Integration, describe `'status filter and counts'`. Setup: problems `a`, `b`, `c`, `d`. User 1 has `a` score 100, `b` score 40, `c` score 100 then 30. Nothing on `d`.
    - `it('solved returns problems whose best score is 100')` → ids `['a','c']`.
    - `it('attempted returns submitted but unsolved')` → `['b']`.
    - `it('unsolved returns problems with no submission')` → `['d']`.
    - `it('status composes with keyset paging')`: 25 unsolved problems, limit 20 → 20 then 5, no overlap.
    - `it('counts partition all and follow the other filters')`: `GET /problem-status-counts?difficultyMin=…` → `{all, unsolved, attempted, solved}` with `all === unsolved + attempted + solved`.
    - `it('hidden and contest problems are never counted')`.
    - `it('a guest gets all counted as unsolved')`.
  - Controller:
    - `it('rejects status for guests with 400')`.
    - `it('rejects an unknown status with 400')`.
- [ ] **Step 2: Run** `cd backend && npm test -- problemController` → FAIL (unknown param / 404 route). Run the integration file under compose → FAIL.
- [ ] **Step 3: Implement.**
  - **Schema:** `status: z.enum(['solved','attempted','unsolved']).optional()`.
  - **Service:** the status clause goes inside the `batch` CTE's WHERE, so keyset paging is unchanged:
    - solved → `EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = $1 AND s.problem_id = p.id AND s.score = <FULL>)`
    - attempted → `EXISTS(any) AND NOT EXISTS(score = FULL)`
    - unsolved → `NOT EXISTS(any)`
  - **Counts:** one query with `COUNT(*) FILTER (WHERE …)` per bucket over the same visible-standalone universe and shared filters.
  - **Guests:** the controller throws `AppError('Sign in to filter by status.', 400)` when `status` is set and `req.user` is absent.
  - **Migration 0025:** `CREATE INDEX IF NOT EXISTS idx_submissions_user_problem ON submissions (user_id, problem_id, score)`.
- [ ] **Step 4: Run** both test files → PASS. Run `npm test` → green.
- [ ] **Step 5: Commit** `feat(api): problem status filter and per-status counts (B2)`.

### Task 2: B1 + Home summary — `GET /me/home`

**Files:**
- Create:
  - `backend/services/homeQueryService.ts`
  - `backend/controllers/homeController.ts`
- Modify:
  - `backend/app.ts` (register router)
  - `backend/types/service.ts`
- Test:
  - `backend/tests/integration/homeSummary.test.ts`
  - `backend/tests/homeController.test.ts`

**Interfaces:**
- Consumes: `calculateProblemXP`, `getUserProgression` (progressionService), `ANALYTICS_TIMEZONE`, `FULL_PROBLEM_SCORE`.
- Produces: `getHomeSummary(userId: number): Promise<HomeSummary>`, returned by `GET /me/home` (requireAuth).

```ts
interface HomeProblemRef { id: string; title: string; difficulty: number | null; xp: number }
interface HomeContinue extends HomeProblemRef {
  bestScore: number; attempts: number; lastTriedAt: string;
  latestStatus: string; caseStatuses: string[]; // from the best submission's results
}
interface CollectionProgress { id: number; name: string; solved: number; total: number; next: HomeProblemRef | null }
interface HomeSummary {
  progression: UserProgression; currentStreak: number; solvedToday: boolean;
  week: { day: string /* YYYY-MM-DD */; solved: number }[]; // 7 entries, oldest first, last = today
  continue: HomeContinue | null;
  startWith: HomeProblemRef[];           // ≤3 easiest unsolved, only when continue is null
  collections: CollectionProgress[];     // collections with ≥1 visible standalone problem, by name
  levelUp: { remaining: number; problem: HomeProblemRef } | null;
}
```

- **Continue:** the problem with the latest submission whose best score < 100, among visible standalone problems.
- **startWith:** unsolved problems ordered by `difficulty ASC NULLS LAST, id`.
- **collections[].next:** the easiest unsolved problem in that collection.
- **levelUp.problem:** the easiest unsolved problem whose `calculateProblemXP(difficulty) >= progression.levelProgress.remaining`. It is `null` if none qualifies.
- **week[].solved:** distinct problems with an Accepted submission that day (§7.1). Re-solves of an already-solved problem count.
- **currentStreak:** the same value as the profile's (reuse its query; do not duplicate it).

- [ ] **Step 1: Write the failing tests.** Integration:
  - `it('week counts distinct problems accepted per Bangkok day, oldest first')`: two ACs on one problem at 23:30 and 23:40 Bangkok → that day = 1. An AC at 00:10 Bangkok counts on the next day.
  - `it('continue picks the latest-tried unsolved problem')`.
  - `it('startWith lists the 3 easiest unsolved when nothing is in progress')`.
  - `it('collections report solved/total over visible standalone problems with the next unsolved')`: a hidden problem in the collection is not counted.
  - `it('levelUp names the easiest unsolved problem whose XP covers the remainder')`.
  - Controller: `it('401s for guests')`.
- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement** with `Promise.all` over small queries, each scoped to `p.is_visible = true AND p.contest_id IS NULL`.
- [ ] **Step 4: Run** → PASS. Full backend `npm test` → green.
- [ ] **Step 5: Commit** `feat(api): /me/home summary with collection progress (B1)`.

### Task 3: B3 — XP ranking with competition rank and weekly window

**Files:**
- Create: `backend/services/rankingService.ts`
- Modify:
  - `backend/controllers/submissionController.ts` (`GET /scoreboard`)
  - `backend/services/submissionQueryService.ts` (delete `getGlobalScoreboard`)
  - `backend/services/progressionService.ts` (`getUserProgression` global rank)
  - `backend/schemas/requestSchemas.ts` (`scoreboardQuerySchema`)
  - `backend/types/service.ts`
- Test:
  - `backend/tests/integration/globalRanking.test.ts`
  - `backend/tests/submissionController.test.ts` ('GET /scoreboard')
  - `backend/tests/scoreboardAvatar.test.ts`
  - `backend/tests/progressionIntegration.test.ts`

**Interfaces:**
- Produces:
  - `type RankingWindow = 'all' | 'week'`
  - `getGlobalRanking(opts: { window: RankingWindow; page: number; viewerId: number | null }): Promise<GlobalRanking>`
  - `getUserGlobalRank(userId: number): Promise<number | null>` (all-time; used by `getUserProgression`)
  - `GET /scoreboard?window=all|week&page=N` (requirePublicAccess) → `GlobalRanking`

```ts
interface RankingRow { rank: number; username: string; hasAvatar: boolean; xp: number; solved: number; level: number; tier: string }
interface GlobalRanking { rows: RankingRow[]; total: number; page: number; pageSize: 50; window: RankingWindow; viewer: RankingRow | null }
```

- **Ranked users:** only users with XP > 0 in the window are ranked.
- **solved:** the number of reward rows in the window.
- **Order within a tie:** `username ASC`.
- **level / tier:** from all-time XP (`getLevelFromXP`, `getTierForLevel`).
- **viewer:** the viewer's row regardless of page; `null` for guests or when the viewer has no XP in the window.

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - `it('ranks by XP with competition ranking (1, 2, 2, 4)')`.
    - `it('keeps tie ranks across a page boundary')`: 52 users where #50 and #51 tie → page 2's first row has rank 50.
    - `it('week window counts only rewards from the last 7 days but level stays all-time')`.
    - `it('returns the viewer row when the viewer is off the page')`.
    - `it('profile global rank equals the ranking rank for tied users')`: `getUserProgression(u).globalRank === row.rank`.
  - Controller:
    - `it('rejects window=month and page=0 with 400')`.
    - The 'GET /scoreboard' test is rewritten to the new envelope.
  - `scoreboardAvatar.test.ts`: the global case now asserts that `rankingService.ts` contains `(u.avatar_png IS NOT NULL)` and that `types/service.ts` has `hasAvatar: boolean;`.
  - `progressionIntegration.test.ts`: assert the SQL uses `RANK() OVER (ORDER BY`, not `DENSE_RANK`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - One CTE builder `rankingCte(window)` is shared by both functions:
    - `totals` = SUM(xp_awarded) and COUNT(*) per user in the window.
    - `ranked` = `RANK() OVER (ORDER BY xp DESC)`, computed before any LIMIT/OFFSET.
    - `allTime` = SUM over all rewards, used for level.
  - Rows are fetched with `LIMIT 50 OFFSET (page-1)*50`, plus `COUNT(*)` for the total.
  - Add `RANKING_PAGE_SIZE = 50` to `backend/constants/index.ts`.
- [ ] **Step 4: Run** → PASS. Full `npm test` → green.
- [ ] **Step 5: Commit** `feat(api): XP ranking with competition rank and weekly view (B3)`.

### Task 4: Submission and problem-detail fields for the new pages

**Files:**
- Modify:
  - `backend/schemas/requestSchemas.ts` (`submissionsQuerySchema`)
  - `backend/services/submissionQueryService.ts` (`getSubmissions`, `getSubmissionDetail`)
  - the `GET /problems/:id` handler in `backend/controllers/problemController.ts` and its service in `backend/services/problemQueryService.ts`
  - `backend/types/service.ts`
- Test:
  - `backend/tests/submissionController.test.ts`
  - `backend/tests/integration/submissionListFields.test.ts`
  - `backend/tests/problemController.test.ts`

**Interfaces:**
- Produces:
  - List rows gain `case_statuses: string[]`, `max_time_ms: number | null`, `max_memory_kb: number | null`.
  - New query param `verdict` (one of the `SUBMISSION_STATUS` values).
  - `filterProblemId` is now honoured for everyone. It already stays within visible problems for non-staff through the existing condition. `filterUserId` stays staff-only.
  - The detail row gains `time_limit_ms: number` and `memory_limit_mb: number` from `problems`.
  - `GET /problems/:id` gains three fields:
    - `collection: { id: number; name: string } | null`
    - `viewerBest: { score: number; caseStatuses: string[] } | null` (the viewer's best submission; null for guests or when there is none)
    - `viewerSubmissionCount: number` (0 for guests)
  - These feed the Problem detail header (breadcrumb, best strip) and the Submissions tab count, replacing the frontend's all-problems loop.

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - `it('list rows carry case statuses and max time/memory')`.
    - `it('a string results value yields no case statuses')`.
    - `it('verdict filters by overall status')`.
    - `it('non-staff can filter by problem id within visible problems')`.
  - Controller:
    - `it('rejects an unknown verdict with 400')`.
    - `it('detail includes the problem limits')`.
    - `it('problem detail carries collection, viewer best and submission count')`.
    - `it('problem detail viewer fields are null and 0 for guests')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `case_statuses`:
    ```sql
    COALESCE((SELECT jsonb_agg(r->>'status') FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.results) = 'array' THEN s.results ELSE '[]'::jsonb END) r), '[]'::jsonb)
    ```
  - `max_time_ms` / `max_memory_kb` come straight from the stored columns.
  - The verdict condition is `<alias>.overall_status = $n`.
- [ ] **Step 4: Run** → PASS. Full `npm test` → green.
- [ ] **Step 5: Commit** `feat(api): submission list strip fields, verdict filter, detail limits`. **Part A done:** push and open PR 3a against `ui-redesign/phase2b-components` if the owner agreed.

---

## Part B — Practice pages (PR 3b)

### Task 5: Frontend types and service clients

**Files:**
- Modify:
  - `frontend/src/types/models.ts`, `frontend/src/types/api.ts`
  - `frontend/src/services/problemService.ts`, `scoreboardService.ts`, `submissionService.ts`
- Create: `frontend/src/services/homeService.ts`
- Test:
  - `frontend/src/tests/services/homeService.test.ts`
  - `frontend/src/tests/services/problemService.test.ts`, `scoreboardService.test.ts`, `submissionService.test.ts`

These are mirror types of Tasks 1–4. The coverage gate (85% branches / 90% lines on `src/services`) applies.

**Interfaces:**
- Produces:
  - `homeService.getHome(): Promise<HomeSummary>`
  - `problemService.getStatusCounts(q: Omit<ProblemListQuery,'limit'|'cursor'|'sort'|'order'|'status'>): Promise<ProblemStatusCounts>`
  - `ProblemListQuery.status?: 'solved'|'attempted'|'unsolved'`
  - `scoreboardService.getRanking(window: 'all'|'week', page: number): Promise<GlobalRanking>` (replaces `getGlobal`)
  - `SubmissionSummary` gains `case_statuses?: string[]`, `max_time_ms?: number|null`, `max_memory_kb?: number|null`
  - `SubmissionDetail` gains `time_limit_ms?: number`, `memory_limit_mb?: number`
  - `ProblemDetail` gains `collection?`, `viewerBest?`, `viewerSubmissionCount?`
  - `SubmissionQueryParams.verdict?: string`
- [ ] **Step 1:** Write failing service tests: each one asserts the URL and params called on the mocked `api`, plus the unwrap. Example: `getRanking('week', 2)` → `GET /scoreboard` with `{ params: { window: 'week', page: 2 } }`.
- [ ] **Step 2:** `npx jest src/tests/services` → FAIL.
- [ ] **Step 3:** Implement. Delete `GlobalScoreboardEntry` / `GlobalScoreboardResponse` once no import remains (Task 11 removes the last use; until then keep `getGlobal` returning the new rows). **Ruling:** the old API is removed in Task 11.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): clients for home summary, status counts, ranking, submission fields`.

### Task 6: Home (logged in)

**Files:**
- Rewrite: `frontend/src/pages/home/Home.tsx`, `Home.module.css`
- Create (`frontend/src/features/home/`):
  - `ContinueBlock.tsx`
  - `WithinReach.tsx`
  - `WeekStrip.tsx`
  - `CollectionsPanel.tsx`
  - one `Home.parts.module.css`
- Delete: `frontend/src/hooks/useHomeQuotes.ts` and its test
- Test:
  - Rewrite `frontend/src/tests/pages/Home.test.tsx`
  - Create `frontend/src/tests/features/home/WithinReach.test.tsx`, `WeekStrip.test.tsx`

**Interfaces:**
- Consumes: `homeService.getHome`, `contestService.getAll` (existing `pickContest` logic kept), `Countdown`, `ProgressBar`, `TestcaseStrip`, `VerdictText`.
- Produces:
  - `goalsFor(summary: HomeSummary): Goal[]` in `WithinReach.tsx`
  - `type Goal = { key: 'collection' | 'level' | 'run'; text: string; to: string }`
  - At most 3 goals, in that order, each only when it applies:
    - **collection:** the first collection with `total - solved === 1` → `One more to finish ${name} · ${solved}/${total}`, linking to `/problems/${next.id}`.
    - **level:** `levelUp` exists → `${remaining} XP to Level ${level+1}`, linking to `/problems/${levelUp.problem.id}`.
    - **run:** `currentStreak >= 1 && !solvedToday` → `Solve one today to make it a ${currentStreak+1}-day run`, linking to the continue problem, else `startWith[0]`.
- `weekLevel(solved: number): 0|1|2|3|4` in `WeekStrip.tsx`: 0 → 0, 1 → 1, 2 → 2, 3–4 → 3, 5+ → 4.

Layout per §7.1 and `home-merged.html`:
- **Header:** the date line (`Monday 16 November`) and the H1 "Continue where you left off".
- **Left column:**
  - The Continue block: id, title, strip, verdict, attempts, last tried, and a Continue button. Enter on the page activates Continue. It is ignored in editable targets and while a modal is open; reuse `isEditableTarget` / `isModalOpen`.
  - When `continue` is null: "Start with" plus the 3 `startWith` rows.
  - Below that: "Within reach".
- **Right column:**
  - **Level:** tier, bar, `340 / 500 XP` mono.
  - **This week:** 7 cells using `--heatmap-*`, today drawn with a dashed border, the count in a `title`, and a legend.
  - **Collections:** a ProgressBar per collection, linking to `/problems?collection=<id>`.
  - **Contest:** the running or upcoming contest, if any.
- **Mobile:** a single column, Continue button full width.
- **Removed:** the quote and the old hero.

- [ ] **Step 1: Write failing tests.**
  - `goalsFor`:
    - `it('lists the collection goal only when exactly one problem is left')`
    - `it('omits the run goal when something was solved today')`
    - `it('caps at three goals in order collection, level, run')`
  - `weekLevel` table test for 0, 1, 2, 3, 4, 5, 9.
  - Home:
    - `it('shows the continue block with strip and verdict')`
    - `it('falls back to Start with when nothing is in progress')`
    - `it('Enter opens the continue problem but not from an input')`
    - `it('marks today in the week strip')`
    - `it('renders without the contest panel when there is no contest')`
    - `it('shows an inline error with retry when the summary fails')`
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS. The design guard `.home-container` rule still holds; keep the class name or update the guard's list in the same commit.
- [ ] **Step 5:** Commit `feat(web): home with continue block, within-reach goals and week strip`.

### Task 7: Problems list

**Files:**
- Rewrite: `frontend/src/pages/problem/Problems.tsx`, `Problems.module.css`
- Modify:
  - `frontend/src/routing/problemListLoaders.ts` (carry `status`)
  - `frontend/src/hooks/useIncrementalProblems.ts` (query gains `status`)
  - `frontend/src/config/constants.ts` (`DIFFICULTY_BANDS`)
- Delete: `frontend/src/features/problem/ProblemCard.tsx` + CSS + test, once nothing imports them. Check `ContestProblems` first; if the contest pages still use it, keep it (phase 4 rewrites them).
- Test:
  - Rewrite `frontend/src/tests/pages/Problems.test.tsx`, keeping the behaviours listed in Step 1
  - Update `frontend/src/tests/routing/problemListLoaders.test.ts`

**Interfaces:**
- Consumes:
  - `FilterBar` (search, segments, filters, resultCount, trailing)
  - `SegmentedControl`
  - `DataTable` (rowHref, phone mode)
  - `StatusMark`, `TestcaseStrip`, `ScoreCell`
  - `ProblemCategoryReveal`, `DifficultyChip` (kept from `ProblemMetadata.tsx`)
  - `problemService.getStatusCounts`
- Produces: `DIFFICULTY_BANDS: { value: string; label: string; min?: number; max?: number }[]`.
  - Bands: 800–1199, 1200–1599, 1600–1999, 2000–2399, 2400+, plus `unrated`.
  - Chip value `"<min>-<max>"`. It maps onto the existing `difficultyMin` / `difficultyMax` URL params.

Behaviour (§7.2):
- **Header:** "Problems" plus meta `142 problems · 38 solved` (guests: `142 problems`), from an unfiltered `getStatusCounts({})` fetched once.
- **Toolbar:**
  - Search, kept debounced at 300 ms.
  - Segmented All / Unsolved / Attempted / Solved with filtered counts. The URL param is `status`; selecting it resets `pages`. It is hidden for guests.
  - Chips: Difficulty, Category, Collection, Author.
  - A sort select (default `difficulty-asc`, as today) in `trailing`.
  - **Ruling:** Category becomes single-select. A legacy comma-separated `category` URL still filters. The chip shows it as set with a label made from the joined names, by adding that value as an extra option at runtime. The same extra-option trick covers a legacy min/max pair that matches no band.
- **Table:** status mark, id (mono), title, difficulty (mono, right), Best (strip + score), Last tried (relative). The whole row is clickable via `rowHref`.
- **Categories:** stay hidden. A toolbar toggle "Show categories" (off by default) shows them muted under titles. Categories matching an active Category filter always show.
- **Paging:** keyset Show More, auto-load, and the scroll and URL restore all stay as they are today.
- **Mobile:** two-line rows (DataTable phone mode) and one Filters button plus sort.

- [ ] **Step 1: Write failing tests.**
  - Keep these existing behaviours (port the assertions):
    - first request sorted difficulty asc
    - Show More append, auto-load and Retry
    - URL restore after back
    - search debounce, and focus never remounts
    - empty-state copy
    - `pages` reset on filter change
  - Add:
    - `it('status segment sends status and resets pages')`
    - `it('segment counts come from status-counts with the same filters')`
    - `it('guests see no status segment and send no status')`
    - `it('difficulty chip sets the min/max range')`
    - `it('a legacy multi-category URL shows the category chip as set')`
    - `it('categories stay hidden until Show categories')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): problems table with status segments and filter chips`.

### Task 8: `SubmissionResult` and `useLiveSubmission`

**Files:**
- Create (`frontend/src/features/submission/`):
  - `SubmissionResult.tsx`, `SubmissionResult.module.css`
  - `useLiveSubmission.ts`
- Test:
  - `frontend/src/tests/features/submission/SubmissionResult.test.tsx`
  - `frontend/src/tests/features/submission/useLiveSubmission.test.tsx`

**Interfaces:**
- Consumes: `submissionService.getById`, `subscribeSubmissions` (realtimeService), `verdictLabel`, `verdictTone`, `TestcaseStrip`, `StatusMark`, `ProgressBar`.
- Produces:
  - `<SubmissionResult submission={SubmissionDetail} limits={{ timeMs: number; memoryMb: number }} actions?={ReactNode} />` renders:
    - The verdict header: big mono verdict, `6/10 · 60 pts`, `#id · relative time`.
    - The `lg` strip.
    - The "Stopped at case N. Cases N+1–M were not run." line when there are Skipped cases after a failure.
    - A case table: #, verdict, time value + bar vs limit, memory value + bar vs limit. The first failing case is highlighted; Skipped cases render `NOT RUN` with `—`.
    - For a compile error: the full compiler log in a mono block, no table.
    - While pending: "Judging…" with `aria-live="polite"`.
  - `useLiveSubmission(id: number | null, contestId?: string): { submission: SubmissionDetail | null; error: string | null }`.
    - Fetches once.
    - Re-fetches on a `submission_update` event whose `submissionId === id`.
    - Polls at `REALTIME.SUBMISSIONS_FALLBACK_POLL_MS` while the status is Pending/Compiling/Running and the stream is down.
    - Stops at a final verdict.
- [ ] **Step 1: Write failing tests.**
  - `it('highlights the first failing case and marks later cases NOT RUN')`
  - `it('shows the compiler log for a compilation error')`
  - `it('announces judging while pending')`
  - `it('bars scale against the limits')`: style width `41%` for 410 ms of 1000.
  - Hook:
    - `it('refetches on its own submission event only')`
    - `it('polls while pending when the stream is down and stops at a final verdict')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): shared submission result with live updates`.

### Task 9: Problem detail

**Files:**
- Rewrite:
  - `frontend/src/pages/problem/ProblemDetail.tsx`, `ProblemDetail.module.css`
  - `frontend/src/features/problem/submission/CodeSubmissionForm.tsx` (+ CSS)
- Modify:
  - `frontend/src/hooks/useProblemDetail.ts`: drop the left-rail slider state and the all-problems loop; the best strip and tab count come from the Task 4 detail fields.
  - `frontend/src/hooks/useCodeSubmission.ts`: `onSubmitted(id)` callback instead of navigate.
  - `frontend/src/components/shell/AppShell.tsx`: remove the `/problems/:id` auto-collapse, per the §10 phase 2 interim rule; the rail is gone.
- Test:
  - Rewrite `frontend/src/tests/pages/ProblemDetail.test.tsx`
  - Update `frontend/src/tests/hooks/useCodeSubmission.test.ts`, `useProblemDetail.test.tsx`, `CodeSubmissionForm.test.tsx`
  - Update `frontend/src/tests/components/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: Task 8, `PageHeader` (breadcrumb, actions, tabs), `FileDrop`, `TestcaseStrip`.
- Produces: tab state in the URL as `?tab=statement|submit|submissions` (default `statement`), plus `&submission=<id>` after a submit.

Behaviour (§7.3):
- **PageHeader:**
  - Breadcrumb: Problems › collection name (from `collection`; plain "Problems" when null).
  - H1: the title.
  - Meta: id · `1000 ms · 256 MB` · languages (`C++ · Python`, or `C++ · submit student.h` for header problems) · author.
  - Actions: the best strip plus score, Starter (header problems with starter files), Open PDF.
  - Tabs: Statement / Submit / Submissions (count).
- **Statement:**
  - The PDF iframe at content width, with a loading state.
  - On iframe `error`, or when `has_pdf` is false, show "Can't preview — open PDF" with a link.
  - Use `problemService.getPdfUrl` instead of the hardcoded `/api` prefix.
- **Submit:**
  - The editor (unchanged component, restyled), with a `FileDrop` above it that loads a file's text into the editor.
    - accept: `.cpp,.cc,.py` (standard) or the exact `submission_filename` (header); max 256 KB.
  - ⌘Enter / Ctrl+Enter submits.
  - After submitting: set `submission=<id>` in the URL and render `<SubmissionResult>` under the form via `useLiveSubmission`.
    - Actions "View submitted code" link to `/submissions/<id>`.
    - "Edit & resubmit" focuses the editor.
  - The same flow runs on the contest route (no navigate).
- **Submissions tab:** the existing `Submissions` view filtered to this problem, until Task 10 restyles it.
- **Mobile:** the header wraps; the tabs become a sticky bar under the top bar.

- [ ] **Step 1: Write failing tests.**
  - `it('header shows id, limits, languages and author')`
  - `it('header problems show the submit filename and the starter action')`
  - `it('tab lives in the URL')`
  - `it('PDF failure shows the open-PDF fallback')`
  - `it('submitting shows the live result inline and keeps the submission id in the URL')`
  - `it('reloading with ?submission= shows that result')`
  - `it('Cmd+Enter submits')`
  - `it('a dropped file fills the editor')`
  - AppShell: `it('does not auto-collapse on problem pages')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): problem detail header, tabs and inline live result`. **Part B done:** visual check (Task 15 Step 1 for these pages), then push + PR 3b if agreed.

---

## Part C — Remaining student pages (PR 3c)

### Task 10: Submissions list and the `/submissions/:id` route

**Files:**
- Rewrite:
  - `frontend/src/features/submission/SubmissionsView.tsx`
  - `frontend/src/hooks/useSubmissions.ts` (drop the modal state)
- Create:
  - `frontend/src/pages/submission/SubmissionDetailPage.tsx` (+ module CSS)
  - Route `/submissions/:submissionId` (PrivateRoute) in `App.tsx`
  - Contest variant route `/contests/:contestId/submissions/:submissionId`
- Delete: `SubmissionModal.tsx`, `useSubmissionModal.ts` and their tests, after moving the copy/read-only code view into `SubmissionDetailPage`. Port the code-view behaviour tests.
- Test:
  - Rewrite `frontend/src/tests/pages/Submissions.test.tsx`, `tests/hooks/useSubmissions.test.tsx`
  - Create `frontend/src/tests/pages/SubmissionDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 4/5 fields, Task 8, `DataTable`, `FilterBar`, `useUrlFilters` (keys `filter`, `problem`, `verdict`, `user`).
- **List:**
  - PageHeader "Submissions" with meta.
  - Mine/All segmented (default Mine when logged in, All for guests).
  - Problem search; Verdict chip; User search (staff).
  - Columns: id, when, user, problem (id + title), verdict + strip, score, time, memory, language.
  - `rowHref` → `/submissions/:id` (contest: `/contests/:cid/submissions/:id`). No per-row buttons.
  - Keep SSE refresh, XpToast and paging (page param).
- **Detail page:**
  - Breadcrumb Submissions › #id.
  - `<SubmissionResult>` with actions "Open problem" and "Edit & resubmit" (→ `/problems/:pid?tab=submit`).
  - Collapsible "Submitted code" (expanded by default) with Copy, mono, line numbers.
  - 403 / 404 show an `InlineError`.
- [ ] **Step 1: Write failing tests.**
  - `it('rows link to the detail route')`
  - `it('verdict chip sends verdict')`
  - `it('Mine is the default when logged in')`
  - `it('staff see the user filter, students do not')`
  - `it('list refreshes on a submission event')`
  - `it('detail shows the result, code and copy')`
  - `it('detail 403 shows an inline error')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): submissions table and linkable submission detail`.

### Task 11: Ranking

**Files:**
- Rewrite:
  - `frontend/src/pages/scoreboard/Scoreboard.tsx` (+ CSS)
  - `frontend/src/hooks/useScoreboard.ts` → `useRanking(window, page)`
- Delete:
  - `frontend/src/features/scoreboard/ScoreboardTable.tsx` (+ CSS + test), after checking that the contest scoreboard does not import it. If it does, keep it for phase 4.
  - The `getGlobal` and `GlobalScoreboard*` types.
- Test: rewrite `frontend/src/tests/pages/Scoreboard.test.tsx`, `tests/hooks/useScoreboard.test.tsx`

**Interfaces:**
- Consumes: `scoreboardService.getRanking`, `DataTable` (highlightKey = viewer username), `SegmentedControl`.
- URL params: `window` (`all` default | `week`) and `page`.
- Columns: rank (mono right), user (avatar + linked name), `tier · Lv N`, solved (mono right), XP (mono right). The top 3 are bold only: no medals, no tints.
- **Pinned viewer bar:** a sticky-bottom bar "You · #214" with the same columns. Shown when `viewer` exists and the viewer's row is not on the current page, or is scrolled out of view (IntersectionObserver on the highlighted row).
- **Pagination:** "1–50 of N", Previous / Next.
- [ ] **Step 1: Write failing tests.**
  - `it('shows competition ranks from the server')`
  - `it('This week switches the window param')`
  - `it('pins the viewer row when it is not on the page')`
  - `it('no pinned row for guests')`
  - `it('no medal icons')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): XP ranking with weekly view and pinned viewer row`.

### Task 12: Profile

**Files:**
- Rewrite: `frontend/src/pages/user/UserProfile.tsx`, `UserProfile.module.css`
- Modify:
  - `frontend/src/features/user/CategoryRadarChart.tsx`: theme tokens per the spec; hover highlight via `activeIndex` / `onActiveChange` props.
  - `frontend/src/features/user/ProblemSolvingProfile.tsx`: radar + list side by side; list only when < 3 categories have problems.
  - `frontend/src/features/user/CategorySummary.tsx`: becomes the solved / total / % list.
  - `frontend/src/components/user/ActivityHeatmap.tsx`: anchored right; container scrolls horizontally with the newest weeks in view.
- Test:
  - Rewrite `frontend/src/tests/pages/UserProfile.test.tsx`, `tests/features/user/ProblemSolvingProfile.test.tsx`
  - Update `tests/components/ActivityHeatmap.test.tsx`

**Interfaces:**
- Layout, per §7.6 as amended 2026-11-16 and `phase3-pages.html` §1:
  - **Header:** avatar (change control on your own profile, kept), name, joined, `tier · Lv N`, XP `ProgressBar` with `5,860 / 6,400 XP` and "540 XP to Lv 9", Global rank `#214` (hidden when null).
  - **One stat row:** Solved, Attempted, Submissions, Current run, Best run (mono, no icons). Total score and Solve rate leave.
  - **Heatmap:** full width.
  - **Categories:** radar and list.
  - **Two columns:** Recently solved (+XP, date) | Verdicts and Languages as horizontal bars.
  - **Achievements:** a compact list, the next 3 locked by progress plus all unlocked with dates; "Show all" expands.
- **Radar colours, exactly:**
  - area and dots `var(--accent-primary)` with `fillOpacity={0.12}`
  - grid `var(--border-color)`
  - labels `var(--text-secondary)`
  - percentages `var(--text-muted)`
  - Radar `aria-hidden`; the list carries the numbers.
- **Mobile:** single column, stats 2×2, radar full width with compact labels (existing `COMPACT_LABELS` plus `'Data Structures': 'DS'`, `Sorting: 'Sort'`).
- [ ] **Step 1: Write failing tests.**
  - `it('stat row shows solved, attempted, submissions, current and best run')`
  - `it('radar is hidden from assistive tech and the list carries the numbers')`
  - `it('fewer than three categories with problems shows the list only')`
  - `it('hovering a list row highlights the radar point')`: assert `activeIndex` passed.
  - `it('achievements show the next three locked by progress then unlocked')`
  - Keep: avatar control only on own profile; reload on username change; rank hidden without rewards.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): profile with stat row, radar and list, compact achievements`.

### Task 13: Auth pages, guest home, private landing

**Files:**
- Rewrite:
  - `frontend/src/features/auth/LoginForm.tsx`, `RegisterForm.tsx`
  - Create `frontend/src/features/auth/AuthForm.module.css`, replacing `Form.module.css` use here
  - `frontend/src/components/shared/AuthRequired.tsx`
  - The guest branch of `frontend/src/pages/home/Home.tsx` → `frontend/src/features/home/GuestHome.tsx`
- Modify: `frontend/src/hooks/useAuthForms.ts` (field-level errors)
- Test:
  - Update `frontend/src/tests/pages/Login.test.tsx`, `LoginSessionExpiry.test.tsx`, `Register.test.tsx`
  - Update `tests/hooks/useAuthForms.test.tsx`, `tests/components/PrivateRoute.test.tsx`
  - Create `frontend/src/tests/features/home/GuestHome.test.tsx`

**Interfaces:**
- Consumes: `Field` / `Input` (components/ui), `InlineNotice`, `InlineError`, `Button`, `DataTable`, `contestService.getAll`, `problemService.getProblemsPage`.
- `useAuthForms` returns `fieldErrors: Partial<Record<'username'|'password'|'confirmPassword', string>>`. The existing validation messages and limits stay (username ≥ 3, password ≥ 6, the server's rules unchanged).
- **Login:**
  - H1 "Log in".
  - Fields with `autoComplete="username"` / `"current-password"`; a password Show/Hide toggle (`aria-pressed`).
  - Form error `role="alert"`; the button shows its pending state.
  - Notices: the expired notice, and "Account created. Log in with your new username." (router state `registered`).
- **Register:**
  - H1 "Create account".
  - Hints under fields: "At least 3 characters.", "At least 6 characters.". **Ruling:** the Figma frame says 8, but the existing validation is 6. Keep 6; changing the password policy is out of scope.
  - Confirm password with a field error "Passwords don't match.".
  - `autoComplete="new-password"`.
- **Private landing** (AuthRequired, in AuthShell): "This Grader is private" and "Log in with the account your school gave you." above the Log in / Create account actions. Keep the `returnTo`.
- **Guest home (public):**
  - Header "Grader" with the sentence "Practice problems in C++ and Python, judged in seconds. Browse freely; log in to submit."
  - Running and upcoming contests with Countdown and a "Log in to join" action.
  - "Recently added problems": the first page sorted by id desc, 6 rows, linking to the problems.
  - No hero.
- [ ] **Step 1: Write failing tests.**
  - `it('password toggle reveals and hides with aria-pressed')`
  - `it('confirm mismatch shows a field error and blocks submit')`
  - `it('form errors use role=alert')`
  - `it('registered state shows the account-created notice')`
  - Keep: the expired notice, `returnTo`, pending.
  - Guest home:
    - `it('public guest home lists contests and recent problems')`
    - `it('private mode shows the private landing in the auth shell')`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. If the backend cannot sort the public list by newest without changes, use the first page as-is and title it "Problems". Record a ruling.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): auth forms, private landing and guest home`.

### Task 14: 404

**Files:**
- Rewrite: `frontend/src/pages/notfound/NotFound.tsx`, `NotFound.module.css`
- Test: update `frontend/src/tests/pages/NotFound.test.tsx`

**Interfaces:**
- Consumes: `useCommandPalette` (open search), `Button`.
- Content:
  - mono "404"
  - H1 "Page not found"
  - "Nothing lives at `<path>`", with the requested pathname in mono
  - Actions: Go home (primary) and Search (secondary, opens ⌘K)
- [ ] **Step 1:** Write failing tests:
  - `it('shows the requested path')`
  - `it('Search opens the command palette')`
  - Keep: the 404 shows inside the shell, and the admin catch.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run validate` → PASS.
- [ ] **Step 5:** Commit `feat(web): 404 with path and search`.

### Task 15: Visual baselines, guards, verification, PRs

**Files:**
- Create: `frontend/tests/visual/student-pages.spec.ts` (+ snapshots). Desktop and mobile; light, plus dark for Profile and Problems. It uses a new `mockStudentApi(page)` in `frontend/tests/visual/fixtures.ts`.
- Modify: `frontend/src/tests/design/designGuards.test.ts`. Add the pages that must use PageHeader: `pages/user/UserProfile.tsx`, `pages/submission/SubmissionDetailPage.tsx`, `pages/problem/ProblemDetail.tsx`.

- [ ] **Step 1:** Write the spec.
  - Screenshots `home`, `problems`, `problem-detail-result`, `submissions`, `submission-detail`, `ranking`, `profile`, `login`, `register`, `guest-home`, `not-found`.
  - Keyboard focus check on the problems table row link and the Ranking segmented control.
  - `npm run test:visual:update`, then **read every new PNG** and compare it against the mockups and the Figma frames before keeping it.
- [ ] **Step 2:** Run the guard test → FAIL until the guard list matches. Fix any page that fails.
- [ ] **Step 3:** Run, all green:
  - `cd backend && npm test`
  - integration under compose
  - `cd frontend && npm run validate`
  - `npm run build`
  - `npm run test:visual`
- [ ] **Step 4:** Local stack smoke on the mocked student API, plus the real stack if test credentials are available to the executor without reading secret files:
  - submit → inline result
  - reload keeps the result
  - ranking pinned row
  - profile radar hover in both themes
  - phone width on each page
- [ ] **Step 5:** Commit `test(web): phase 3 visual baselines and guards`. Push + PR 3c if agreed. Final whole-branch review per executing-plans.
