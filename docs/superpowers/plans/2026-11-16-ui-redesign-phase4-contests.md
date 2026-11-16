# UI Redesign Phase 4 — Contest Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every contest page to spec §7.7: list, lobby, running/finishing states, the contest problem table, the finished recap, the contest problem page, the scoreboard, and contest submissions. Add backend B4 (problem order) and B9 (per-problem attempts and time of best score).

**Architecture:**
- A new `ContestLayout` route element loads the contest once. It picks ContestShell for a participant while the contest is running or finishing, and the normal AppShell otherwise.
- Pages read the contest from that layout's context instead of fetching it again.
- **Backend:**
  - Contest problem order lives in `problems.contest_position` while a contest is scheduled or running, and in `contest_problems.position` once the finish snapshot is taken.
  - Live standings and the finish snapshot share one SQL builder, so the frozen scoreboard and the live one cannot disagree.

**Tech Stack:** React 19 + Vite + CSS Modules + Jest/RTL + Playwright (frontend); Express 5 + TypeScript + raw SQL + Zod + Jest/supertest (backend).

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` §6 (ContestShell), §7.7, §9 B4/B9, §10 phase 4.

**Mockups:** `docs/superpowers/specs/2026-11-15-ui-redesign/phase4-contests.html` (owner-approved 2026-11-16), `key-pages.html` §3 (scoreboard), `navigation-de.html` (ContestShell).

## Global Constraints

- UI copy stays English; the owner reads reports in Thai.
- Phosphor icons only; IBM Plex Sans Thai + JetBrains Mono; numbers, times and ids in mono.
- No new libraries (Base UI, cmdk and NumberFlow are the only additions allowed by §5.1).
- Schema changes are new numbered migrations only (next is `0026`); never edit an applied one.
- Raw parameterized SQL; Zod for request validation; `isUniqueViolation` → 409; multi-statement writes in `db.withTransaction`.
- Hidden contests 404 on every public surface for non-staff (migration 0020 semantics). Nothing in this plan may relax that.
- Running-contest problem titles stay participant/staff-only on the server (§7.7 "titles stay hidden server-side").
- Contest scheduler timezone `Asia/Bangkok`; contest times display in the viewer's locale, as today.
- Competition ranking (`RANK()`), consistent with the global ranking (§7.5, §7.7).
- Design guards in `frontend/src/tests/design/` stay green; visual baselines are regenerated and every new PNG is read before it is kept.
- Commits carry no Co-Authored-By trailer (owner preference). PR bodies end with the Claude Code line.

## Review Focus

1. **Tie order across the finish snapshot.** Two participants with equal totals must keep the same order and ranks on the live scoreboard, the FINAL scoreboard and the recap. Test: Task 2 (snapshot equals live for the same data).
2. **A participant resubmits without improving.** The later submission must not move their tie-break time; only reaching a new best score does. Test: Task 2.
3. **Clock edges.** The lobby at 00:00:00 enters the contest once (no loop if the server still says `scheduled`); the contest problem page closes Submit at `end_time` by the client clock, even if the shell hasn't reloaded yet. Tests: Task 5 and Task 7.
4. **Non-participant on a finished contest.** They see the recap table and the Scoreboard button, with no "Your final rank", and are not redirected away. Hidden contests still 404. Tests: Task 3 and Task 6.
5. **Old finished contests.** Snapshots taken before this phase have no `attempts`, `best_at` or `statuses`. The recap and the FINAL scoreboard render "—" for those instead of crashing or showing 0. Tests: Task 6 and Task 8.

---

## Part A — Backend (PR 4a)

### Task 1: B4 — contest problem order, problem count in contest detail

**Files:**
- Create: `backend/migrations/0026ContestProblemPosition.ts`
- Modify:
  - `backend/migrations/index.ts`
  - `backend/services/problemMigration.ts` (assign, remove, snapshot)
  - `backend/services/contestQueryService.ts` (detail: order + `problem_count`)
  - `backend/services/contestParticipantQueryService.ts`
  - `backend/services/contestScoreboardQueryService.ts` (problem lists only)
  - `backend/controllers/contestController.ts`
  - `backend/schemas/requestSchemas.ts`
  - `backend/types/models.ts`
- Create: `backend/services/contestProblemOrder.ts`
- Test:
  - `backend/tests/integration/contestProblemOrder.test.ts` (real SQL, throwaway schema; follow the pattern of `tests/integration/submissionListFields.test.ts`)
  - the migration-order test

**Interfaces:**
- Produces:
  - `contestProblemOrderSql(alias: string, positionColumn: 'contest_position' | 'position'): string` → `` `${alias}.${positionColumn} NULLS LAST, ${alias}.<id column>` `` (the id column is `id` for `problems`, `problem_id` for `contest_problems`). Every contest problem list orders by it.
  - `reorderContestProblems(contestId: string, problemIds: string[]): Promise<{ kind: 'ok' } | { kind: 'not_found' } | { kind: 'invalid_status' } | { kind: 'mismatch' }>`
  - `PUT /admin/contests/:id/problem-order` (staff|admin), body `{ problemIds: string[] }` (Zod: 1–100 non-empty strings, unique). Returns 204, 404, 409 (contest not scheduled/running), or 400 (the set ≠ the contest's problems).
  - `GET /contests/:id` adds `problem_count: number` for every viewer who can see the contest. This includes non-participants of a running contest, whose `problems` stays `[]`.

- [ ] **Step 1: Write the failing integration tests**
  - `assigning problems appends positions in the given order`: assign `['b','a']`, then `['c']` → positions b=1, a=2, c=3.
  - `removing a problem clears its position`
  - `contest lists order by position, then id`: participant problems, contest detail, live scoreboard `problems` all return `['b','a','c']`.
  - `the finish snapshot keeps the order`: after `migrateSubmissionsAfterContest`, `contest_problems.position` copies `contest_position`; finished detail/participant/scoreboard lists keep b, a, c.
  - `reorder rewrites positions 1..n`; `reorder rejects a different set (400)`; `reorder of a finished contest is 409`; `non-staff reorder is 403`.
  - `detail carries problem_count for a non-participant of a running contest, with problems []`.
  - `migration backfills positions by id for existing assigned problems and snapshots`.
- [ ] **Step 2: Run** `npm test -- tests/integration/contestProblemOrder.test.ts` → FAIL (column `contest_position` does not exist).
- [ ] **Step 3: Implement**
  - Migration `0026_contest_problem_position`:
    - add `problems.contest_position INTEGER` and `contest_problems.position INTEGER`;
    - backfill both with `ROW_NUMBER() OVER (PARTITION BY contest ORDER BY id)`.
  - Assignment: `contest_position = (current max for the contest) + array index + 1`, in one statement inside the existing assignment write.
  - Removal and the move back to main both set `contest_position = NULL`.
  - Snapshot: insert `position` from `contest_position`.
  - Replace every `ORDER BY id` / `ORDER BY problem_id` / `ORDER BY p.id` / `ORDER BY cp.problem_id` on a contest problem list with `contestProblemOrderSql`.
  - `reorderContestProblems` runs in `db.withTransaction`.
- [ ] **Step 4: Run** the new file plus `npm test -- tests/contestController.test.ts tests/contestVisibility.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(api): contest problem order (B4) and problem count in contest detail`

### Task 2: B9 — shared standings: attempts, time of best score, rank

**Files:**
- Create: `backend/services/contestStandingsSql.ts`
- Modify:
  - `backend/services/contestScoreboardQueryService.ts`
  - `backend/services/problemMigration.ts` (the snapshot insert uses the shared CTE)
  - `backend/types/models.ts`
- Test: `backend/tests/integration/contestStandings.test.ts`

**Interfaces:**
- Produces:
  - `contestStandingsCte(contestIdParam: string): string` — a `WITH … standings AS (…)` block. Columns per participant:
    - `user_id`
    - `total_score` (sum of best per problem)
    - `detailed_scores` (jsonb `{ [problemId]: { score, attempts, best_at, statuses } }`)
    - `last_score_improvement_time`
  - Per-problem rules:
    - `best_at` = the earliest `submitted_at` among that user's submissions with the problem's best score;
    - `attempts` = count of their submissions to it;
    - `statuses` = `jsonb_agg(r->>'status')` of that best submission's `results` when it is an array, else `[]`.
  - `last_score_improvement_time` = max `best_at` over problems with best score > 0; when there are none, `joined_at`.
  - Scoreboard rows (running, finishing, finished) gain `rank: number` = `RANK() OVER (ORDER BY total_score DESC, last_score_improvement_time ASC)`. Order is `rank, username`.
  - `ContestScoreboardResponse` gains `status: ContestStatus` and `start_time: string`, so the page can show `last hh:mm:ss` relative to the start.

- [ ] **Step 1: Write the failing tests**
  - `a non-improving resubmission does not move the tie-break`: u1 scores 100 at t1 then 100 again at t3; u2 scores 100 at t2 → u1 rank 1, u2 rank 2.
  - `attempts, best_at and statuses per problem`
  - `equal total and equal time share a rank` (competition: 1, 1, 3)
  - `participants with no submissions get 0 and joined_at`
  - `the finish snapshot stores the same detailed_scores and order as the live scoreboard` (same fixture through both paths)
  - `finished scoreboard of an old snapshot without attempts/best_at still returns rows with rank`
- [ ] **Step 2: Run** `npm test -- tests/integration/contestStandings.test.ts` → FAIL.
- [ ] **Step 3: Implement** the CTE and use it for both the live query and the snapshot insert. The finished branch computes `rank` at read time over `contest_scoreboards`.
- [ ] **Step 4: Run** the new file plus the scoreboard, controller and visibility suites → PASS. Then run the full backend gate.
- [ ] **Step 5: Commit** `feat(api): contest standings with attempts and best-score time (B9)`; push, open PR 4a against `ui-redesign/phase3c-student-pages`.

---

## Part B — Contest flow (PR 4b)

### Task 3: ContestLayout — one contest load, the right shell

**Files:**
- Create:
  - `frontend/src/features/contest/ContestLayout.tsx`
  - `frontend/src/features/contest/ContestContext.tsx`
- Modify:
  - `frontend/src/components/shell/ContestShell.tsx` (read the contest from context; drop its own `getById`)
  - `frontend/src/App.tsx` (route element `ContestLayout`; `RootLayout` keeps treating `/contests/:id` as self-shelled)
  - `frontend/src/hooks/useContestGuard.ts` (no redirect away from a finished contest; the recap lives at `/contests/:id`)
  - `frontend/src/types/models.ts` (`problem_count?: number`)
- Test: `frontend/src/tests/features/contest/ContestLayout.test.tsx`, plus updates to `useContestGuard.test.tsx`

**Interfaces:**
- Produces:
  - `useContest(): { contest: Contest | null; error: string | null; reload: () => void }`.
  - `ContestShell` renders inside `ContestLayout` only.
  - `useContestShellReload` becomes an alias of `useContest().reload`.
  - `inContestShell(contest: Contest): boolean` = `contest.is_participant && (status === 'running' || status === 'finishing')`.

- [ ] **Step 1: Failing tests**
  - `participant + running → ContestShell` (nav "Contest");
  - `non-participant + running → AppShell` (nav "Main");
  - `scheduled and finished → AppShell for everyone`;
  - `hidden contest 404 → "Contest not found."`;
  - `contest fetched once for shell + page`;
  - guard: `finished contest does not navigate`.
- [ ] **Step 2: Run** `npx jest src/tests/features/contest src/tests/hooks/useContestGuard.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** ContestLayout keeps the shell's transition reload: it schedules `reload` at `start_time`/`end_time` + 1 s.
- [ ] **Step 4: Run** → PASS; then run the frontend gate.
- [ ] **Step 5: Commit** `feat(web): contest layout picks the shell from contest state`

### Task 4: Contests list

**Files:**
- Modify: `frontend/src/pages/contest/Contests.tsx` (+ `.module.css`)
- Delete: `frontend/src/features/contest/ContestCard.tsx`, `ContestList.tsx` (+ CSS) once unused
- Test: `frontend/src/tests/pages/Contests.test.tsx` (rewrite)

**Interfaces:** consumes `contestService.getAll()` (already carries `participant_count`, `problem_count`, `is_participant`, `is_visible`).

- [ ] **Step 1: Failing tests**
  - `groups into Live / Upcoming / Past and hides empty groups`
  - `actions`:
    - running + participant → link `Enter` to `/contests/:id/problems`;
    - running → button `Join`;
    - scheduled + participant → `Registered` (link to the lobby);
    - scheduled → `Join`;
    - finishing/finished → link `Results`.
  - `meta line "n joined · n problems"` with the count pluralised ("1 problem")
  - `staff see HIDDEN on hidden contests; students never do`
  - `"No contests yet." when empty`
  - `PageHeader meta "1 live · 2 upcoming · 14 past"`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** PageHeader, sections as `<section aria-labelledby>` with a mono time window and mono countdown (`useCountdown`). Phones get two-line rows, per the mockup. **Step 4:** PASS. **Step 5: Commit** `feat(web): contests list with live, upcoming and past`

### Task 5: Lobby and running-not-joined

**Files:**
- Create: `frontend/src/features/contest/ContestLobby.tsx`, `ContestJoinGate.tsx` (+ CSS)
- Modify: `frontend/src/pages/contest/ContestDetail.tsx` (becomes the state router for `/contests/:id`), `frontend/src/hooks/useContestDetail.ts`
- Test: `frontend/src/tests/pages/ContestDetail.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `useContest()` from Task 3; `contestService.getScoreboard(id)` (for scheduled it lists registered usernames) for the roster.
- Produces the `ContestDetail` state rules:
  - scheduled → `ContestLobby`;
  - running + not participant → `ContestJoinGate`;
  - running/finishing + participant → `<Navigate to="problems" replace />`;
  - finished → `ContestRecap` (Task 6).

- [ ] **Step 1: Failing tests**
  - Lobby layout: `SCHEDULED tag, mono countdown, rule facts "Window", "Duration", "Problems", "Scoring" with "IOI · sum of best scores · ties by earliest last improvement"`.
  - `roster "Registered · 12"`
  - `Join → Registered (disabled) and reload()`
  - `at zero calls reload once and, if the contest is running, lands on problems`
  - `still scheduled after the reload → shows "Starting…" and does not loop` (fake timers; at most one extra reload)
  - Running, not joined: `letters A–E from problem_count, "Hidden until you join", Join contest → join() then navigate to problems/<first id> from getProblems()`
  - `join failure shows InlineError`
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): contest lobby and join gate`

### Task 6: Finished recap

**Files:**
- Create: `frontend/src/features/contest/ContestRecap.tsx` (+ CSS)
- Modify: `frontend/src/types/models.ts`: `ContestScoreboardEntry` gains `rank`. `ContestDetailedScore` values gain optional `attempts`, `best_at`, `statuses`. `ContestScoreboardPayload` gains `status`, `start_time`.
- Test: `frontend/src/tests/features/contest/ContestRecap.test.tsx`

**Interfaces:** consumes `useContest()` and `contestService.getScoreboard(id)`.

- [ ] **Step 1: Failing tests**
  - `participant: "Your final rank #14 of 74", "Points 380 / 600", "Solved 3 of 6"`
  - `per-problem rows: letter, title linking to /problems/<id>, strip from statuses, score, tries`
  - `non-participant: table and Scoreboard button, no rank block`
  - `old snapshot without attempts/statuses → "—" in Tries and no strip`
  - `FINAL tag and "Scoreboard" links to /contests/:id/scoreboard`
- [ ] **Step 2–4:** FAIL → implement (max points = 100 × problem count; solved = score 100) → PASS. **Step 5: Commit** `feat(web): finished contest recap`

### Task 7: Contest problem table, finishing state, contest problem page

**Files:**
- Modify:
  - `frontend/src/pages/contest/ContestProblems.tsx` (+ CSS)
  - `frontend/src/pages/problem/ProblemDetail.tsx` (contest branch)
  - `frontend/src/components/shell/ContestShell.tsx` (sidebar order and letters follow server order; total points)
- Test:
  - `frontend/src/tests/pages/ContestProblems.test.tsx`
  - `frontend/src/tests/pages/ProblemDetail.test.tsx` (contest cases)

**Interfaces:**
- Consumes: `useContest()`, `contestService.getProblems(id)` (server order from Task 1), `problemLetter(index)` (existing in ContestShell; move to `features/contest/letters.ts`).

- [ ] **Step 1: Failing tests**
  - Problem table:
    - `table rows in server order with letters A…: title link, best strip, score, tries`
    - `header meta "Mid-term practice · 300 / 500 points"`
  - Finishing: `status role "Judging final submissions…" and no Submit`
  - Contest problem page:
    - `header title "C Interval merge" (letter in mono) and breadcrumb "<contest title> › C"`
    - `at end_time the Submit tab shows "Contest ended — submissions closed." without a server call` (fake timers)
    - `finishing shows the same closed notice`
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): contest problem table and closed state`; push, open PR 4b against PR 4a's branch.

---

## Part C — Scoreboard, submissions, verification (PR 4c)

### Task 8: Contest scoreboard (§7.7, key-pages §3)

**Files:**
- Modify:
  - `frontend/src/pages/contest/ContestScoreboard.tsx` (+ CSS)
  - `frontend/src/hooks/useContestScoreboard.ts` (expose `connected: boolean` and `updatedAt: number`)
- Test:
  - `frontend/src/tests/pages/ContestScoreboard.test.tsx` (rewrite)
  - `useContestScoreboard.test.ts`

- [ ] **Step 1: Failing tests**
  - `header "Scoreboard" + LIVE while running, FINAL when finished; "updated Ns ago"; live dot only when connected`
  - `columns: Rank, Participant (link to profile), Total with "last hh:mm:ss" (time from start_time to last_score_improvement_time), one column per problem headed A, B… with the full title as tooltip/aria`
  - Cells:
    - `100 → data-tone="full"`;
    - `partial → plain`;
    - `0 → data-tone="zero"`;
    - `untried → "—"`;
    - `attempts shown under the score when present`.
  - `viewer row highlighted; "You · #14" bar when the viewer row is off-screen` (IntersectionObserver mocked)
  - `ranks come from the server (1, 1, 3)`
  - `old snapshot without best_at → no "last" line`
- [ ] **Step 2–4:** FAIL → implement (phones: rank, name and total sticky; problem columns scroll in an `overflow-x: auto` wrapper) → PASS. **Step 5: Commit** `feat(web): contest scoreboard with live state and pinned viewer`

### Task 9: Contest submissions default and visual baselines

**Files:**
- Modify: `frontend/src/hooks/useSubmissions.ts` (with `contestId`, staff default `all`, students `mine`)
- Create: `frontend/tests/visual/contest-pages.spec.ts` (+ snapshots); extend `frontend/tests/visual/fixtures.ts` with `mockContestApi(page, state)`
- Modify: `frontend/src/tests/design/designGuards.test.ts` (PageHeader list: `pages/contest/Contests.tsx`, `pages/contest/ContestProblems.tsx`, `pages/contest/ContestScoreboard.tsx` stay; add `features/contest/ContestRecap.tsx`, `features/contest/ContestLobby.tsx`)
- Test: `frontend/src/tests/pages/ContestSubmissions.test.tsx`

- [ ] **Step 1:** Failing test `contest submissions default to All for staff, Mine for students` → FAIL → implement → PASS.
- [ ] **Step 2:** Visual spec.
  - Shots, desktop + phone: `contests`, `contest-lobby`, `contest-join-gate`, `contest-problems`, `contest-finishing`, `contest-recap`, `contest-problem-ended`, `contest-scoreboard`. Add dark for `contest-problems` and `contest-scoreboard`.
  - Keyboard focus on the list's first action and the scoreboard's first participant link.
  - Run `npm run test:visual:update`, then **read every PNG** against `phase4-contests.html` / key-pages §3.
- [ ] **Step 3:** Gates, all green:
  - full backend suite (throwaway Postgres);
  - frontend gate;
  - `npm run build`;
  - `npm run test:visual`.
- [ ] **Step 4:** Real-stack smoke on a rebuilt local stack (`docker compose -p oj up --build -d`) with the throwaway smoke account.
  - Create a contest via the admin API as staff only if staff test credentials are available without reading secret files. Otherwise ledger the gap and smoke the student surfaces that exist.
- [ ] **Step 5: Commit** `test(web): phase 4 visual baselines and guards`; push, open PR 4c against PR 4b. Then the final whole-branch review per executing-plans.

---

## Rulings made while planning

- **B4 storage:** the spec puts `position` on `contest_problems`. But that table is only a finish-time snapshot; scheduled and running contests list problems via `problems.contest_id`. So the live order lives in `problems.contest_position` and is copied into `contest_problems.position` by the snapshot. Same order for users either way. Cost if wrong: one extra column.
- **B4 UI:** this phase adds the reorder endpoint and backfills id order; the drag-to-reorder admin UI is phase 5 (Contests editor). Cost if wrong: until phase 5, the order is assignment order.
- **Tie-break fix:** today's queries use a participant's latest submission time as "last improvement". The spec's rule is "ties by earliest last improvement", so Task 2 uses the time each best score was first reached. Old finished snapshots keep their stored times. Cost if wrong: tie order on new contests differs from what students saw before.
- **Recap tries and strips** come from the snapshot (`attempts`, `statuses`), because contest submissions are deleted after migration. Contests finished before this phase show "—". Cost if wrong: no history for old contests.
- **No new endpoint for the roster:** the scheduled scoreboard already lists registered participants.
