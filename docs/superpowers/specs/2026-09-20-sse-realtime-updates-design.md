# SSE Real-Time Updates — Design

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: approved by user (chat, 2026-09-20).

## Problem

Submission status and contest scoreboards currently update by polling
(`POLLING_INTERVALS.SUBMISSIONS = 2500ms`, `SCOREBOARD = 30000ms` in
`frontend/src/config/constants.ts`). The user wants real-time updates via
Server-Sent Events, with polling kept as fallback.

## Design decisions (from the user conversation)

- **SSE (not WebSocket)** for both submission status and scoreboards:
  one-directional server→client fits both use cases, works with the existing
  session auth, and passes through the existing Nginx proxy config unchanged
  (`proxy_buffering off` + `proxy_read_timeout 300s` are already set on
  `/api/` in both `nginx-proxy/local.conf` and `production.conf`).
- **Polling remains as fallback**: if `EventSource` errors or the browser
  lacks support, the hooks fall back to the current interval polling. SSE is
  a latency improvement, never a correctness dependency.

## Architecture

### Backend — a tiny pub/sub hub (new `backend/services/realtimeHub.ts`)

An in-process event hub (no Redis — the backend is single-instance today,
same assumption `judgeQueue` makes):

```ts
type RealtimeEvent =
  | { type: 'submission_update'; submissionId: number; table: 'submissions' | 'contest_submissions'; overall_status: string; score: number }
  | { type: 'scoreboard_update'; contestId: number };

export const publishRealtime = (event: RealtimeEvent): void;
export const subscribeRealtime = (listener: (event: RealtimeEvent) => void): (() => void);
```

Simple listener set; `publishRealtime` never throws (wrap listener calls in
try/catch — a broken subscriber must not break the judge pipeline).

### Emission points

1. **`backend/services/submissionService.ts`** — every status write in
   `runSubmissionPipeline` (`Compiling`, `Running`, and the final
   verdict/score update, plus `Compilation Error`/`System Error` paths)
   calls `publishRealtime({ type: 'submission_update', ... })` after the DB
   write succeeds. One line per status transition; no behavior change.
2. **Scoreboard**: rather than emitting from every contest submission
   (chatty), emit `scoreboard_update` from `runSubmissionPipeline` when a
   **contest** submission's final verdict lands (table === 
   `'contest_submissions'`), and from `problemMigration.ts` when the
   post-contest migration rewrites `contest_scoreboards`. Consumers then
   refetch the scoreboard payload — the event is a "something changed"
   ping, not the data itself. This keeps the hub trivially small and the
   scoreboard endpoint the single source of truth.

### SSE controller — new `backend/controllers/realtimeController.ts`

```
GET /realtime/submissions   (requireAuth)  → stream submission_update events,
                                             filtered to the requesting user's own submissions
GET /realtime/contests/:id  (requireAuth)  → stream scoreboard_update events for that contest
```

Implementation notes:

- Set headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`; `res.flushHeaders()`.
- Heartbeat: send a comment line (`:\n\n`) every 30s to keep intermediaries
  from closing the idle connection (within the 300s proxy read timeout).
- Client disconnect: `req.on('close')` unsubscribes the listener — this is
  the leak guard; add a test for it.
- Auth: same session middleware as other routes (`requireAuth`); the
  submission stream filters events server-side by `req.user.id` (submissions
  carry `user_id` — include it in the event payload from the hub or look it
  up at publish time from the pipeline row).
- Mount in `server.ts`/`app.ts` next to the other routers.
- Rate limiter: exempt SSE routes from `generalApiLimiter` (or ensure it
  doesn't count heartbeats) — long-lived connections must not be throttled.

Event wire format:

```
event: submission_update
data: {"submissionId":123,"overall_status":"Running","score":0}

event: scoreboard_update
data: {"contestId":7}
```

### Frontend

- **`frontend/src/services/realtimeService.ts`** (new): wraps `EventSource`
  on `/api/realtime/...` (base URL from the shared axios config's origin —
  `EventSource` cannot send axios headers but session cookies ride along
  automatically). Exposes `subscribeSubmissions(cb)` /
  `subscribeScoreboard(contestId, cb)` returning unsubscribe functions, with
  auto-reconnect left to the browser's native `EventSource` retry (it
  reconnects automatically on connection drop).
- **`frontend/src/hooks/useSubmissions.ts`**: subscribe to the submission
  stream; on event, update the matching row in state (or simply refetch —
  start with refetch-on-event, which is correct and simple; optimize to
  in-place patching only if the list flickers). Keep the existing
  `setInterval` polling **but lengthen it** (e.g. 2500ms → 30s) as a
  fallback/safety net; on `EventSource` `onerror` beyond native retry
  (e.g. `readyState === CLOSED`), restore the original fast interval.
- **`frontend/src/hooks/useContestScoreboard.ts`**: same pattern — refetch
  scoreboard on `scoreboard_update` for the viewed contest; keep a slow
  fallback poll (e.g. 5 min) and revert to 30s polling when the stream is
  down.
- **`frontend/src/config/constants.ts`**: add `REALTIME` constants
  (fallback poll intervals) next to `POLLING_INTERVALS`.
- Other polling hooks (`useContestGuard`, `useContestDetail`,
  `BATCH_PROCESS`) are **out of scope** — only the two above convert.

## Testing plan

- **Hub unit tests**: publish → all listeners called; throwing listener
  doesn't break others; unsubscribe stops delivery.
- **Controller tests**: SSE endpoint sends an initial comment/heartbeat,
  relays events, filters other users' submissions, and cleans up the
  listener on request close (use supertest with a manual `res.write`
  capture or a real socket test per existing patterns).
- **Pipeline integration**: judging a submission emits the status sequence
  (mock the hub listener in the existing submissionService tests).
- **Frontend**: hooks prefer SSE when available and fall back to polling
  when `EventSource` errors (mock EventSource in jsdom).

## Acceptance criteria

1. With the app open, a submission's status changes appear without waiting
   for the 2.5s poll tick; contest scoreboards update near-instantly after
   a verdict lands.
2. `EventSource` failure (server restart, network drop) degrades to the
   existing polling behavior — the page never stops updating.
3. A user cannot receive another user's submission events (server-side
   filtering by session user).
4. Idle SSE connections stay open past 60s (heartbeat) and are cleaned up
   on client disconnect (no listener leak — verified by test).
5. Polling remains as fallback in both converted hooks.
6. All tests pass (`backend npm test`, `frontend npm run validate`).

## Out of scope

Converting `useContestGuard`/`useContestDetail` polling, WebSocket support,
cross-instance pub/sub (Redis), SSE for batch upload progress, presence
indicators.
