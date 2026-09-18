# Local Development Foundation Design

**Date:** 2026-09-12
**Status:** Implemented and verified
**Branch:** `codex/local-dev-foundation` (based on `origin/local`)

## Purpose

Make WOI Grader start reliably on a clean local machine before adding the
Problem Authoring Workspace. Local development must be the safe default, while
production-specific networking and security settings remain explicit and
preserved.

This is Slice 0. It changes development and deployment foundations only; it
does not add problem-authoring tables, APIs, or UI.

## Current verified problems

1. The `local` and `master` branches carry different versions of runtime
   configuration in the same files. Merging feature work therefore requires
   repeated manual conflict resolution and risks leaking local settings into
   production.
2. Host installs use whatever Node/npm happens to be installed. On the current
   machine, Node 25/npm 11 fails during `npm ci` with `Exit handler never
   called`, while the Dockerfiles use Node 20 successfully.
3. Backend Jest cannot start from a clean lockfile install because
   `jest.config.ts` requires `ts-node`, but `ts-node` is not declared.
4. The frontend test baseline is healthy under Node 20: 57 suites and 271 tests
   pass. Its production Docker build can hide TypeScript failures through
   `TSC_COMPILE_ON_ERROR=true`.
5. A fresh PostgreSQL database has no application tables. The backend can still
   be reported healthy even while the contest scheduler fails because the
   `contests` table does not exist.
6. The available database initializer drops existing tables. It is unsafe as a
   normal startup/bootstrap mechanism.
7. The documented database commands use stale output paths in `README.md`, and
   the current contribution guide requires a manual destructive initialization
   step.
8. Production-only concerns such as Cloudflare Tunnel, certificate mounts,
   secure cookies, fixed cookie domains, and fixed CORS origins make the default
   Compose workflow unsuitable for local use.

## Design decisions

### 1. One application branch model, configuration selected at runtime

Application code will no longer depend on a long-lived branch carrying a
different copy of `server.ts` or Nginx configuration.

- `docker-compose.yml` is the local-safe default and starts the application at
  `http://localhost` with `docker compose up --build`.
- `docker-compose.production.yml` is an explicit production overlay. Production
  starts with both files, so Cloudflare Tunnel, certificates, production Nginx,
  and production environment values are opt-in.
- Nginx local and production configurations live in separate named files.
- The backend reads cookie and CORS behavior from validated environment values;
  it does not infer a production domain from a Git branch.

This makes `local -> master` a normal code merge rather than a recurring
configuration transplant.

### 2. Same-origin local HTTP by default

The frontend will use `REACT_APP_API_URL=/api`. Nginx proxies `/api/*` to the
backend, so browsers do not require cross-origin access for the standard local
workflow.

Backend environment controls:

- `COOKIE_SECURE`: boolean; false locally and true in production.
- `COOKIE_DOMAIN`: optional; omitted locally so the browser uses a host-only
  cookie, set explicitly in production.
- `CORS_ORIGINS`: optional comma-separated allowlist. Empty disables CORS
  middleware; production supplies the public origins.
- `TRUST_PROXY`: validated proxy-hop count, set to `1` in Compose.

Invalid values fail startup with a useful configuration error.

### 3. Versioned, non-destructive migrations

Replace destructive initialization as the normal path with a migration runner:

- SQL migrations are ordered and immutable after release.
- `schema_migrations` records completed versions.
- Each pending migration runs in a transaction and is recorded only after it
  succeeds.
- The first migration creates the current core schema without dropping data and
  is safe on both a fresh database and an existing compatible database.
- The destructive reset script remains available only as an explicitly named
  development recovery command; it is never run automatically.

Compose adds a one-shot `migrate` service. The backend starts only after the
database is healthy and migrations complete successfully. This same mechanism
will later apply the Problem Authoring schema from Slice 1.

### 4. Separate liveness and readiness

- `GET /health/live` reports that the Node process is serving requests and does
  not query dependencies.
- `GET /health/ready` checks PostgreSQL connectivity and verifies the required
  migration state. It returns HTTP 503 with a small non-sensitive response when
  the application is not ready.
- Docker healthchecks use `/health/ready`, preventing the frontend/proxy from
  being marked ready over an empty schema.
- The existing root response remains for compatibility but is not a readiness
  signal.

### 5. Node 20 is the supported development runtime

- Add `.nvmrc` and package `engines` declarations for Node 20.
- Docker continues to build on Node 20.
- Add the missing backend Jest runtime dependency so a clean install can run
  tests.
- Documentation recommends Docker as the primary workflow and Node 20 for host
  commands.

### 6. Builds must not hide TypeScript errors

Remove `TSC_COMPILE_ON_ERROR=true` from the frontend Dockerfile. Fix the existing
response-header type error, then require frontend type-check and production build
to succeed normally.

## Compose topology

Local default:

```text
browser -> nginx-proxy :80 -> frontend :80
                         -> backend :3000 -> database :5432
                                      ^
                         migrate -----|
```

Production overlay adds production Nginx mounts/settings and `cloudflared`.
Neither certificates nor a tunnel token are needed for the local topology.

## Expected file changes

- `.nvmrc`
- `.env.example`
- `.env.production.example` (new)
- `docker-compose.yml`
- `docker-compose.production.yml` (new)
- `nginx-proxy/local.conf` (new or renamed from the current local config)
- `nginx-proxy/production.conf` (new, based on the current master config)
- `backend/config/env.ts`
- `backend/server.ts` and an extracted app factory if needed for route tests
- `backend/scripts/migrate.ts` and `backend/migrations/*`
- backend migration/readiness tests
- backend/frontend `package.json` and lockfiles
- `frontend/Dockerfile`
- `frontend/src/hooks/admin/useProblemManagement.ts`
- `README.md` and `CONTRIBUTING.md`

Exact filenames may be adjusted during the implementation plan if existing test
seams make a smaller change possible.

## Verification contract

Slice 0 is complete only when all of the following are demonstrated from a clean
state:

1. Clean Node 20 installs succeed from both lockfiles.
2. Backend and frontend test suites pass.
3. Backend and frontend TypeScript checks pass.
4. Frontend production build succeeds without compile-error bypasses.
5. `docker compose up --build` needs no Cloudflare token or host certificates.
6. A fresh database is migrated automatically and core tables exist.
7. Re-running migrations makes no schema changes and does not delete data.
8. `/health/ready` is 503 before required schema is available and 200 afterward.
9. Login/session cookies work on `http://localhost`.
10. The production overlay renders a valid merged Compose configuration with
    secure cookie/CORS values and the tunnel service enabled.

## Merge strategy

1. Implement and verify Slice 0 in `codex/local-dev-foundation`.
2. Incorporate `master` into this branch deliberately, preserving security
   hardening and moving environment differences into the new config files.
3. Review the final diff against both `origin/local` and `master`.
4. Merge the feature branch into `local`.
5. After local verification, merge `local` into `master` without restoring
   branch-specific copies of application code.

No force-push, reset, or destructive database operation is part of this flow.

## Deferred work

- Problem Authoring database entities, APIs, and Admin Panel UI (Slice 1+)
- PDF writer integration
- testcase generator execution and seeded reproducibility warnings
- solution compilation/judging workflow
- upload/publish into the grader
- AI-assisted authoring
- redesigning the judge into a separate network-isolated service
- broad dependency upgrades or vulnerability remediation unrelated to making the
  supported local workflow deterministic
