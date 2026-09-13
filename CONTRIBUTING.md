# Contributing to WOI Grader

Thanks for your interest in contributing to **WOI Grader**, an online judge for
competitive programming (React frontend, Express/TypeScript backend, PostgreSQL,
orchestrated with Docker Compose behind an Nginx reverse proxy).

This document explains how to set up the project, the workflow we follow, and the
conventions your changes are expected to meet.

## License of contributions

This project is licensed under the **GNU General Public License v3.0** (see
[`LICENSE`](LICENSE)). By submitting a contribution you agree that it is licensed
under **GPL-3.0-or-later**. Do not add code that is incompatible with this license.

## Prerequisites

You only need these on your host machine — everything else runs in containers:

- [Docker](https://www.docker.com/) (with Docker Compose v2, i.e. `docker compose`)
- [Git](https://git-scm.com/)
- Node.js 20 when running npm or root-level smoke tests on the host (optional
  when using only the container workflow; see `.nvmrc`)

## Getting started (local development)

Everything runs through Docker Compose from the repo root. The database schema is
applied automatically by the one-shot `migrate` service before the backend starts.

```bash
cp .env.example .env          # then edit POSTGRES_PASSWORD and SECRET_KEY
docker compose up --build -d  # app at http://localhost

# Create an admin account after the stack is healthy:
docker compose exec backend node dist/scripts/create_admin.js
```

Check `http://localhost/api/health/ready` when startup fails. Migrations are
versioned and non-destructive; do not use the legacy destructive initialization
script for normal development.

## Branch model

- **`local`** — the integration branch for development work. Branch from it and
  open feature pull requests against it.
- **`master`** — the release branch. Changes flow `local → master` after
  verification.

Both environments now live in the same codebase. `docker-compose.yml` is the
local-safe base; production adds `docker-compose.production.yml`. Do not encode
environment behavior by keeping conflicting versions of files on the two branches.

Use descriptive branch names, e.g. `feature/contest-export`, `fix/pdf-idor`,
`security/rate-limiting`.

## Development workflow

1. Create a branch from `local`.
2. Make focused changes that stay within one concern.
3. Add or update tests for the code you touch (see below).
4. Run the type-checks, linters, and tests locally until they pass.
5. Open a PR against `local` with a clear description of the what and the why.

### Backend (`backend/`)

```bash
npm run dev                                # tsx watch (hot reload)
npm run build                              # tsc -> dist/
npx tsc --noEmit                           # type-check only
npm test                                   # jest + supertest (NODE_ENV=test)
npm test -- path/to/file.test.ts           # a single test file
npm test -- -t "test name substring"       # a single test by name
```

### Frontend (`frontend/`)

Create React App. `npm test` runs in **watch mode** by default — use `CI=true`
for a one-shot run.

```bash
npm start                                  # dev server
npm run build
CI=true npm test                           # run once
npm test -- src/tests/foo.test.tsx         # a single test file
npm run type-check                         # tsc --noEmit
npm run lint                               # eslint --fix
npm run validate                           # type-check + lint:check + test:ci (run before pushing)
```

### Full suite

```bash
./tests/run_tests.sh    # backend then frontend; exit 0 only if both pass
```

Compose and localhost authentication smoke tests:

```bash
node --test tests/composeConfig.test.mjs
BASE_URL=http://127.0.0.1 node --test tests/localSessionSmoke.test.mjs
```

Before a production deployment, render and validate the combined configuration:

```bash
cp .env.production.example .env
docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
```

## Coding conventions

These mirror the existing codebase — match the surrounding style.

- **TypeScript-first.** The backend `tsconfig` is `strict` with `NodeNext`
  modules; keep both apps type-clean (`npx tsc --noEmit` must pass).
- **Validation lives in Zod schemas** (`backend/schemas/requestSchemas.ts`)
  applied via `validateRequest`, not ad-hoc checks in controllers. Every
  user-supplied string should have a finite `.max()`.
- **Layering:** `controllers/ → services/ → db.ts`. Controllers wire routes and
  middleware; services hold business logic and **raw parameterized SQL** (no
  string interpolation of values — always use `$1, $2, …`).
- **Centralize magic values** in `backend/constants/index.ts` and
  `frontend/src/config` / `frontend/src/utils/constants.ts` rather than inlining.
- **Reproducible installs:** dependencies are pinned via `package-lock.json`
  (committed); the Docker images use `npm ci`. If you add a dependency, commit the
  updated lockfile.
- Deeper design docs live in [`.context/`](.context) (`ARCHITECTURE.md`,
  `DATA_MODEL.md`, `API_SCHEMA.md`, `STANDARDS.md`).

## Testing expectations

- Add unit tests for new logic and update existing tests you affect.
- Backend tests mock `pg` (no live DB needed) — see `backend/tests/setup.ts`.
- Coverage on the frontend is enforced for `src/services/*.ts`
  (85% branches / 90% lines, excluding `api.ts`).
- A PR should not reduce coverage or leave the suite red.

## Security

Security is critical for an online judge that compiles and runs untrusted C++.

- **Report vulnerabilities privately** to the maintainer rather than opening a
  public issue.
- The judging path executes untrusted code: never widen its privileges, never
  hand it the backend's environment/secrets, and keep the resource limits
  (`backend/scripts/time_wrapper.c`, the compile guards, and the docker-compose
  hardening) intact. See [`SANDBOX.md`](SANDBOX.md).
- Never log secrets (DB passwords, `SECRET_KEY`) and never commit `.env`.

## Commit & PR guidelines

- Write clear, imperative commit messages (e.g. "Add rate limiting to /submit").
- Keep commits scoped; avoid mixing unrelated changes.
- Ensure type-checks and the relevant tests pass before requesting review.
- Reference related issues in the PR description.

Thank you for contributing! 🎉
