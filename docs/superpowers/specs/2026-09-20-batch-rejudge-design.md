# Batch Rejudge — Design

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: approved by user (chat, 2026-09-20).

## Problem

There is no rejudge today: when an admin fixes a testcase or a judge bug,
existing submissions keep stale verdicts forever. The user wants batch
rejudge at both **per-problem** and **per-contest** levels.

## Design decisions (from the user conversation)

- Rejudge both per-problem and per-contest, triggered from the admin UI.
- Rejudge replays the existing pipeline (`processSubmission` /
  `processContestSubmission`) — it does not recompile from a stored artifact;
  it re-runs the full compile + judge using the submission's stored `code`
  and `language` against the **current** testcases/limits.
- Concurrency safety comes for free from `judgeQueue` (the in-process FIFO
  gate capped at `MAX_CONCURRENT_JUDGES`): the rejudge service simply
  enqueues every task through the same `enqueueJudge` call the submission
  controller uses. No new concurrency machinery.
- Scoreboards: for finished contests the frozen `contest_scoreboards`
  snapshot is **not** rewritten (historical record); if rejudge is needed for
  a finished contest, admin rejudges per-problem instead (the per-contest
  action is disabled for finished contests in the UI). For running contests
  the scoreboard is computed live from `contest_submissions`, so rejudged
  verdicts appear automatically on the next scoreboard read.

## Scope of changes

### Backend service — new `backend/services/rejudgeService.ts`

```ts
export const rejudgeProblem = async (problemId: string): Promise<RejudgeResult>;
export const rejudgeContest = async (contestId: number): Promise<RejudgeResult>;

interface RejudgeResult {
  queued: number;   // submissions accepted for rejudge
  skipped: number;  // non-judgeable rows (see below)
}
```

Behavior (both variants):

1. Select target submissions:
   - per-problem: rows in `submissions` AND `contest_submissions` where
     `problem_id = $1`;
   - per-contest: rows in `contest_submissions` where `contest_id = $1`.
2. Reset each row to `overall_status = 'Pending'`, clear `results`, keep
   `code`/`language`/`submitted_at` intact.
3. Enqueue `processSubmission(id)` / `processContestSubmission(id)` through
   `judgeQueue.enqueueJudge` (the same path a fresh submission takes), so the
   existing `MAX_CONCURRENT_JUDGES` gate bounds the burst.
4. **Skipped rows**: submissions in a terminal non-judgeable state are
   counted and excluded — specifically `Compilation Error` rows can be
   rejudged (compile may now succeed after a judge fix), but rows whose
   stored `code` is empty are skipped. Keep the skip set small and explicit.

Statuses flow through the normal lifecycle (`Pending → Compiling → Running
→ verdict`), so any UI polling submissions already renders progress. (With
the SSE feature, updates stream automatically — the pipeline emits; no
rejudge-specific wiring.)

### Controller — `backend/controllers/adminController.ts`

Two admin-only routes (existing `requireAdmin` middleware):

```
POST /admin/rejudge/problem/:problemId   → rejudgeProblem
POST /admin/rejudge/contest/:contestId   → rejudgeContest
```

Both respond `{ queued, skipped }`. Per-contest returns `409` when the
contest status is `finished` (frozen scoreboard — see design note above).
Use `asyncHandler`; log start/completion via `utils/logger.ts` with counts.

Guardrails:

- Log a warning when `queued` is large (> 500) but do not block — the judge
  queue throttles execution anyway.
- No request body → no Zod schema needed; path params validated as existing
  admin routes do.

### Frontend — admin problems/contests panels

- `frontend/src/features/admin/problems/ProblemManagement.tsx` (or the
  problem row/menu component it renders): a "Rejudge" action per problem
  with a confirm dialog (accessible `components/ui/Dialog`, like other
  destructive confirmations) — "Rejudge N submissions for problem X?"
  (fetch the count via the same endpoint response after confirmation, or
  show a generic confirm and report `queued/skipped` in the success toast).
- `frontend/src/features/admin/contests/` contest management: a "Rejudge"
  action per contest, disabled with a tooltip when status is `finished`.
- `frontend/src/services/adminService.ts` (or `admin/` service module):
  `rejudgeProblem(problemId)`, `rejudgeContest(contestId)` typed clients.

## Testing plan

- **Integration (rejudgeService)**: seed submissions with known verdicts →
  mutate a testcase → rejudge problem → verdicts/scores update; `queued`/
  `skipped` counts correct; contest variant scoped to `contest_submissions`.
- **Controller tests**: admin-only (403 for staff/user), 409 for finished
  contest, response shape.
- **Frontend**: confirm dialog flow; finished-contest button disabled.

## Acceptance criteria

1. An admin can trigger per-problem rejudge from the admin problems panel;
   all judgeable submissions for that problem (standalone + contest pools)
   are re-run against current testcases and limits.
2. An admin can trigger per-contest rejudge for scheduled/running/finishing
   contests; finished contests return 409 and the UI disables the action.
3. A burst rejudge does not spawn unbounded judge processes (goes through
   `judgeQueue`).
4. Responses report `{ queued, skipped }`; the start and completion are
   logged via `utils/logger.ts`.
5. All tests pass (`backend npm test`, `frontend npm run validate`).

## Out of scope

Selective rejudge (filtering by verdict/user), rejudge history/audit table,
auto-rejudge on testcase change, frozen-scoreboard rewriting.
