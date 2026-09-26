# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Grader System — an online judge for competitive programming. Users submit **C++ or Python** solutions and get per-testcase verdicts. Three-tier stack: React 19 frontend, Express 5 (TypeScript) backend, PostgreSQL, all wired together with Docker Compose behind an Nginx reverse proxy.

## Commands

Everything runs through Docker Compose from the repo root. Schema migrations are applied automatically before the backend starts (via the `migrate` service / `npm start` running `dist/scripts/migrate.js`), so a fresh database needs no manual schema step.

```bash
docker-compose up --build -d                          # build & start all services (app at http://localhost, or $HTTP_PORT)
docker-compose exec backend node dist/scripts/create_admin.js # interactive: create an admin account (after the stack is healthy)
cd backend && npm run db:migrate                      # apply pending migrations from the host
```

> `backend/scripts/init_db.ts` is a **destructive development reset** (drops all tables). Never use it to upgrade an existing database — use migrations. Health checks: `/api/health/live` (process) and `/api/health/ready` (DB + schema readiness). Production refuses to boot without `COOKIE_SECURE=true` (startup-time env check).

### Backend (`backend/`)

```bash
npm run dev        # tsx watch server.ts (hot reload)
npm run build      # tsc -> dist/
npm test           # jest + supertest (NODE_ENV=test via cross-env)
npm test -- path/to/file.test.ts          # single test file
npm test -- -t "test name substring"      # single test by name
```

### Frontend (`frontend/`)

Create React App (react-scripts). `npm test` runs in **watch mode** by default — use `CI=true` for one-shot.

```bash
npm start                                  # dev server
npm run build
CI=true npm test                           # run once
npm test -- src/tests/foo.test.tsx         # single test file
npm run validate                           # type-check + lint:check + test:ci (run before pushing)
npm run lint                               # eslint --fix
npm run type-check                         # tsc --noEmit
npm run test:visual                        # Playwright visual regression (admin shell + authoring profiles, desktop/mobile)
npm run test:visual:update                 # regenerate visual baselines after an intentional UI change
```

### Full suite

```bash
./tests/run_tests.sh    # backend then frontend; exit 0 only if both pass. Requires DB running.
```

## Architecture

### Request routing

Nginx (`nginx-proxy/*.conf`) serves the frontend at `/` and proxies `/api/*` to the backend, **stripping the `/api` prefix** (`rewrite ^/api/(.*)$ /$1`). Both configs overwrite `X-Real-IP`/`X-Forwarded-For` with `$remote_addr`, so the backend's rate limiters can trust the proxy-vouched client IP. So a frontend call to `/api/submit` hits the backend route `/submit`. All backend routers are mounted at `/` in `app.ts`. The frontend's axios base URL comes from `REACT_APP_API_URL` (= `/api`), baked in at build time.

### Backend layering

`controllers/ → services/ → db.ts`

- **`controllers/*.ts`** — Express routers. Each file defines routes, attaches middleware (auth, validation, upload), and delegates to services. All routers (`auth`, `admin`, `problem`, `submission`, `contest`, `health`, `analytics`, `userProfile`, `authorProfile`, `realtime`, and the authoring family) are registered in `app.ts`.
- **`services/*.ts`** — business logic and **raw parameterized SQL** via `db.query`. No ORM. Query-heavy logic lives in `*QueryService.ts` files. Multi-statement writes use `db.withTransaction` (admin user delete/update, password change, contest migration, authoring publish).
- **`db.ts`** — single `pg.Pool` (`max: 20`, `statement_timeout: 60s`; migrations run on a separate pool without the timeout); exports `query(text, params)`, `pool`, `withTransaction`, `createMigrationsPool`.

Cross-cutting concerns:
- **Auth** is session-based (`express-session` + `connect-pg-simple`, stored in the `user_sessions` table). `middleware/requestContext.ts` runs two middlewares on every request: `revalidateSessionUser` re-syncs the session's username/role/existence from the live `users` row (deleted user → request proceeds unauthenticated; role changes apply immediately), then `attachRequestUser` maps it to typed `req.user`. **Controllers read `req.user` only, never `req.session` directly.** `middleware/auth.ts` exposes `requireAuth`, `requireStaffOrAdmin`, `requireAdmin`. Roles: `admin`, `staff`, `user` (see `constants/index.ts`). The authoring family of routes is `staff|admin`, not admin-only.
- **Site access mode** — `system_settings.site_access_mode` (`public`/`private`, set from Admin Settings). `middleware/siteAccess.ts` (`requirePublicAccess`) guards public-browsing routes: in PUBLIC mode guests get read-only access to problem lists/statements, submissions feed, and scoreboards; in PRIVATE mode unauthenticated requests 401.
- **Rate limiting** — `middleware/rateLimit.ts`: general API limiter (1000/15min), auth limiter (10/15min on login/register), submit limiter (30/min), all keyed on the proxy-vouched IP; plus an in-memory per-account login lockout (10 failures/15min → 15min lockout). SSE and authoring-workspace polling paths are excluded from the general limiter.
- **Validation** — Zod schemas in `schemas/requestSchemas.ts`, applied via `middleware/validation.ts` (`validateRequest({ body, query, params })`).
- **Errors** — `middleware/errorHandler.ts` provides `asyncHandler`, `AppError`, plus `notFoundHandler`/`errorHandler` mounted last in `app.ts`. Use `utils/dbErrors.ts` (`isUniqueViolation`, Postgres 23505) to map duplicate-key errors to 409s instead of string-matching.
- **Uploads** — `middleware/upload.ts` (multer). General limit is 2 GiB (PDFs, testcase ZIPs, DB dumps); 10 MiB in-memory policies for author profile images, user avatars, and statement assets.
- **Maintenance mode** — `services/maintenanceMode.ts`: while a database import runs, a global gate 503s every other request (health checks and the token-authenticated import-progress endpoint stay reachable) and the contest scheduler skips ticks.
- **Constants** — magic values (roles, submission/contest statuses, judge config, sandbox identities, validation limits, query/pagination caps, XP progression in `constants/progression.ts`) are centralized in `backend/constants/`. Reuse these rather than hardcoding strings.
- **Logging** — use `backend/utils/logger.ts` (structured: JSON in production, level-tagged text in dev), not raw `console.*`. Failed logins, judge pipeline failures, and contest scheduler transitions are all logged through it.

### Judging pipeline

A submission flows: `submissionController` queues it → `judgeQueue` (concurrency gate, `MAX_CONCURRENT_JUDGES: 3`, with an in-flight registry) → `submissionService.processSubmission` → `judgeService.judge`.

1. **Compile/prepare** (`submissionService.ts`): C++ compiles with `g++ -std=c++20 -fsanitize=signed-integer-overflow` (the UBSan flag is intentional — signed integer overflow becomes a Runtime Error); Python is syntax-checked with `python3 -m py_compile`. The prepare step runs **unprivileged via `utils/sandboxProcess.ts`**: shell-less spawn as a per-submission sandbox identity (uid = gid, rotating pool 60000–60015), wrapped in `prlimit` caps, env-stripped, with hard wall-clock/output kills. Each submission gets a private workspace under `/tmp/oj-submissions/` owned by its sandbox identity by construction (uid-dropped create/write/chmod/remove — the container lacks CAP_CHOWN, so `chown` is never called). Compile failure → `Compilation Error` (sanitized stderr — no server paths).
2. **Run each testcase** (`judgeService.ts`): `timeout -k 2s <limit>s ./scripts/time_wrapper <exe> <mem_mb> <cpu_s> <uid>` plus a Node-side SIGKILL escalation timer. `scripts/time_wrapper.c` applies setrlimits, drops to the per-submission uid/gid, and installs a seccomp filter denying `socket`/`socketpair`/`unshare`/`setns`/`ptrace`/`mount`; it emits microsecond CPU time (`TIME_USED:`) and peak memory (`MEM_USED:`) on stderr. Verdicts are **evidence-based** (exit code/signal + measured memory vs limit; no stderr-keyword heuristics): exit 124 = TLE, SIGKILL with memory over limit = MLE, SIGSEGV = Runtime Error. Python runs get time ×4 / memory ×2 multipliers (`LANGUAGE_LIMITS`).
3. **Finalize**: the verdict UPDATE is conditional on the row still being in a judgeable state (a stale judge can't overwrite a newer verdict), and a first Accepted solve awards XP exactly once (`progressionService.awardSolveReward`, unique constraint on `user_problem_rewards`).

On boot, `sweepOrphanedSubmissions` (called from `server.ts` after listen) re-enqueues `Pending` rows and marks `Compiling`/`Running` rows as System Error "interrupted by server restart". Submissions to problems with zero testcases are rejected with 400 at submit time.

Submission statuses and judge tuning (buffers, timeout slack, kill grace, drain timeouts) live in `SUBMISSION_STATUS` / `JUDGE_CONFIG` in `constants/index.ts`. See `SANDBOX.md` for the full sandboxing threat model.

### Contests

- `services/contestScheduler.ts` — a `node-cron` job (every minute, **`Asia/Bangkok`** timezone) that transitions contests through `running` → `finishing` → `finished` and triggers post-contest submission migration. A failed migration retries up to 5 ticks (the contest stays `finishing`, never silently finishes). Ticks are skipped while maintenance mode is active.
- `services/problemMigration.ts` — `migrateSubmissionsAfterContest`. Problems assigned to a running contest are hidden as standalone problems and contest submissions are tracked separately (`contest_submissions`); after the contest ends they migrate to the general pool (draining in-flight judges first, 30s bound) and XP is awarded in-transaction for migrated Accepted solves. Each problem's pre-contest visibility is snapshotted (`is_visible_before_contest`) and restored on every exit path.
- **Contest visibility** (`contests.is_visible`, migration 0020) is an admin publishing gate independent from status: hidden contests 404 on every public surface (list, detail, join, problems, PDF, scoreboard, submission feed, search, SSE) for non-staff, while remaining fully manageable and untouched by the scheduler. Submit-time eligibility checks `start_time`/`end_time` directly (wall-clock gate), not just scheduler status.

### Progression (XP / levels / tiers)

`services/progressionService.ts` — `user_problem_rewards` (one row per unique first solve, migration 0016) is the single source of XP; level (`100·(L−1)²`), tier (Novice → Grandmaster) and global rank are always derived, never stored. XP per solve follows the difficulty-based formula in `constants/progression.ts`. `backend/scripts/backfill_xp.ts` backfills rewards from history; `seed_xp_tiers.ts` is a demo seeder.

### Realtime

`services/realtimeHub.ts` + `controllers/realtimeController.ts` expose **SSE streams** (`GET /realtime/submissions` for the user's own submission updates, `GET /realtime/contests/:id` for scoreboard pings) with 30s heartbeats. The frontend subscribes via `services/realtimeService.ts` and falls back to interval polling when the stream is down — intervals are in `POLLING_INTERVALS` / `REALTIME` in `frontend/src/config/constants.ts`.

### Database

Schema changes go through versioned, non-destructive migrations in `backend/migrations/` (`0001CoreSchema.ts`, … `0020ContestVisibility.ts`) applied by `backend/scripts/migrate.ts` under a Postgres advisory lock; applied versions are recorded in `schema_migrations`. Production `npm start` runs migrations before the API starts. Core tables: `users`, `system_settings`, `problems` (with `categories TEXT[]`, `difficulty`, `collection_id`), `testcases`, `submissions` (indexed on user_id / problem_id / submitted_at), `user_sessions`, the `contest_*` family (with `contests.is_visible`), `collections`, `user_problem_rewards`, and the authoring family (`author_profiles`, `problem_drafts`, `problem_draft_assets`, `problem_draft_testcases`, `authoring_jobs`, `authoring_job_inputs`, `authoring_job_files`, `authoring_published_problems`, `authoring_profile_syncs`, `authoring_profile_sync_items`). To change the schema, add a new numbered migration — do not edit an applied one. `backend/scripts/init_db.ts` remains only as a destructive dev reset (drops all tables). Full schema documentation: `.context/DATA_MODEL.md`.

### Frontend structure (`frontend/src/`)

- **`pages/`** — route-level screens, grouped by domain (`problem`, `contest`, `admin`, `auth`, …), mapped to routes in `App.tsx`.
- **`features/`** — larger composed feature modules, primarily the admin panels (`admin/users`, `admin/problems`, `admin/contests`, `admin/settings`, `admin/authoring`) plus `submission`, `scoreboard`, `user`.
- **`services/`** — typed axios API clients (one per domain; admin clients split under `services/admin/`) over the shared instance in `services/api.ts`.
- **`context/`** — global React context: `AuthContext` (with `refreshUser` for post-XP-award refresh), `SettingsContext` (site config from `/site-config`: access mode, registration, password-change toggle; refetches on window focus), `ThemeContext`.
- **`hooks/`** — page/feature logic, e.g. `useIncrementalProblems` (keyset "Show More" loading with debounced search, stale-response guard, dedupe).
- **`components/ui/`** — shared primitives: `Dialog`, `Button`, `ActionMenu` (portal-rendered, viewport-aware dropdown), `SegmentedControl`, `Drawer`, `StatusBadge`, `OverflowTable`. `components/styles/QuietAction.module.css` is the shared quiet-action style. Modals use the accessible `Dialog` (Escape, focus trap) — not raw overlay divs.
- **`layouts/`** — `MainLayout` / contest / admin layouts; `App.tsx` switches navbar + layout by URL pattern.
- **`config/`** — frontend constants (polling intervals, UI timeouts). Real-time updates (submission status, scoreboards) use SSE with polling fallback.
- **`Error handling** — a global `ErrorBoundary` wraps the app (`components/ErrorBoundary.tsx`); a 401 session-expiry interceptor in `services/api.ts` redirects to `/login?expired=1&returnTo=…` and re-arms after login (wrong-current-password 401s from `/profile/password` are exempted and shown inline).

Test config note: coverage is enforced only on `src/services/*.ts` (85% branches / 90% lines, excluding `api.ts`). There are separate `tsconfig.tests.*.json` for type-checking test subsets.

## Conventions

- TypeScript-first across both apps; backend `tsconfig` is `strict` with `NodeNext` modules.
- Keep request validation in Zod schemas, not ad-hoc checks in controllers.
- Read identity from `req.user` only (it is revalidated per request); never trust `req.session` fields in controllers.
- Map Postgres unique-violation errors with `utils/dbErrors.ts` (`isUniqueViolation`) → 409; wrap multi-statement writes in `db.withTransaction`.
- Add new shared magic values to the relevant `constants` file (backend) / `config` (frontend) rather than inlining.
- Additional design docs live in `.context/` (`ARCHITECTURE.md`, `DATA_MODEL.md`, `API_SCHEMA.md`, `STANDARDS.md`) — consult them for deeper detail.
