# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Grader System — an online judge for competitive programming. Users submit **C++ only** solutions and get per-testcase verdicts. Three-tier stack: React 19 frontend, Express 5 (TypeScript) backend, PostgreSQL, all wired together with Docker Compose behind an Nginx reverse proxy.

## Commands

Everything runs through Docker Compose from the repo root. Schema migrations are applied automatically before the backend starts (via the `migrate` service / `npm start` running `dist/scripts/migrate.js`), so a fresh database needs no manual schema step.

```bash
docker-compose up --build -d                          # build & start all services (app at http://localhost)
docker-compose exec backend node dist/scripts/create_admin.js # interactive: create an admin account (after the stack is healthy)
cd backend && npm run db:migrate                      # apply pending migrations from the host
```

> `backend/scripts/init_db.ts` is a **destructive development reset** (drops all tables). Never use it to upgrade an existing database — use migrations. Health checks: `/api/health/live` (process) and `/api/health/ready` (DB + schema readiness).

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

Nginx (`nginx-proxy/default.conf`) serves the frontend at `/` and proxies `/api/*` to the backend, **stripping the `/api` prefix** (`rewrite ^/api/(.*)$ /$1`). So a frontend call to `/api/submit` hits the backend route `/submit`. All backend routers are mounted at `/` in `server.ts`. The frontend's axios base URL comes from `REACT_APP_API_URL` (= `/api`), baked in at build time.

### Backend layering

`controllers/ → services/ → db.ts`

- **`controllers/*.ts`** — Express routers. Each file defines routes, attaches middleware (auth, validation, upload), and delegates to services. All five (`auth`, `admin`, `problem`, `submission`, `contest`) are registered in `server.ts`.
- **`services/*.ts`** — business logic and **raw parameterized SQL** via `db.query`. No ORM. Query-heavy logic lives in `*QueryService.ts` files.
- **`db.ts`** — single `pg.Pool`; export `query(text, params)` and `pool`.

Cross-cutting concerns:
- **Auth** is session-based (`express-session` + `connect-pg-simple`, stored in the `user_sessions` table). `middleware/requestContext.ts` (`attachRequestUser`) populates `req.user` from the session on every request. `middleware/auth.ts` exposes `requireAuth`, `requireStaffOrAdmin`, `requireAdmin`. Roles: `admin`, `staff`, `user` (see `constants/index.ts`).
- **Validation** — Zod schemas in `schemas/requestSchemas.ts`, applied via `middleware/validation.ts` (`validateRequest({ body, query, params })`).
- **Errors** — `middleware/errorHandler.ts` provides `asyncHandler`, `AppError`, plus `notFoundHandler`/`errorHandler` mounted last in `server.ts`.
- **Uploads** — `middleware/upload.ts` (multer). Limit is 1GB (PDFs, testcase ZIPs, DB dumps).
- **Constants** — magic values (roles, submission/contest statuses, judge config, validation limits) are centralized in `backend/constants/index.ts`. Reuse these rather than hardcoding strings.

### Judging pipeline

A submission flows: `submissionController` queues it → `submissionService.processSubmission` → `judgeService.judge`.

1. **Compile** (`submissionService.ts`): `g++ -std=c++20 -fsanitize=signed-integer-overflow`. The UBSan flag is intentional — it turns signed integer overflow into a Runtime Error verdict. Compile failure → `Compilation Error`.
2. **Run each testcase** (`judgeService.ts`): wraps execution in `timeout <s>s ./scripts/time_wrapper <exe>`. `scripts/time_wrapper.c` is a custom C wrapper compiled with `gcc` (in the backend Dockerfile) that emits microsecond CPU time (`TIME_USED:`) and peak memory (`MEM_USED:`) on stderr. The judge parses these to determine TLE/MLE/RE. `timeout` exit code 124 = TLE.

Submission statuses and judge tuning (buffers, timeout slack) live in `SUBMISSION_STATUS` / `JUDGE_CONFIG` in `constants/index.ts`.

### Contests

- `services/contestScheduler.ts` — a `node-cron` job (every minute, **`Asia/Bangkok`** timezone) that transitions contests through `running` → `finishing` → `finished` and triggers post-contest submission migration. Started from `server.ts` on boot.
- `services/problemMigration.ts` — `migrateSubmissionsAfterContest`. Problems assigned to a running contest are hidden as standalone problems and contest submissions are tracked separately (`contest_submissions`); after the contest ends they migrate to the general pool.

### Database

Schema changes go through versioned, non-destructive migrations in `backend/migrations/` (`0001CoreSchema.ts`, …) applied by `backend/scripts/migrate.ts` under a Postgres advisory lock; applied versions are recorded in `schema_migrations`. Production `npm start` runs migrations before the API starts. Core tables: `users`, `system_settings`, `problems`, `testcases`, `submissions`, `user_sessions`, the `contest_*` family, and the authoring family (`author_profiles`, `problem_drafts`, `problem_draft_assets`, `problem_draft_testcases`, `authoring_jobs`, `authoring_job_inputs`, `authoring_job_files`, `authoring_published_problems`). To change the schema, add a new numbered migration — do not edit an applied one. `backend/scripts/init_db.ts` remains only as a destructive dev reset (drops all tables).

### Frontend structure (`frontend/src/`)

- **`pages/`** — route-level screens, grouped by domain (`problem`, `contest`, `admin`, `auth`, …), mapped to routes in `App.tsx`.
- **`features/`** — larger composed feature modules, primarily the admin panels (`admin/users`, `admin/problems`, `admin/contests`, `admin/settings`).
- **`services/`** — typed axios API clients (one per domain) over the shared instance in `services/api.ts`.
- **`context/`** — global React context: `AuthContext`, `SettingsContext`, `ThemeContext`.
- **`layouts/`** — `MainLayout` / contest / admin layouts; `App.tsx` switches navbar + layout by URL pattern.
- **`config/`** — frontend constants (polling intervals, UI timeouts). Real-time updates (submission status, scoreboards) use **polling**, not websockets — intervals are in `POLLING_INTERVALS`.

Test config note: coverage is enforced only on `src/services/*.ts` (85% branches / 90% lines, excluding `api.ts`). There are separate `tsconfig.tests.*.json` for type-checking test subsets.

## Conventions

- TypeScript-first across both apps; backend `tsconfig` is `strict` with `NodeNext` modules.
- Keep request validation in Zod schemas, not ad-hoc checks in controllers.
- Add new shared magic values to the relevant `constants` file (backend) / `config` (frontend) rather than inlining.
- Additional design docs live in `.context/` (`ARCHITECTURE.md`, `DATA_MODEL.md`, `API_SCHEMA.md`, `STANDARDS.md`) — consult them for deeper detail.
