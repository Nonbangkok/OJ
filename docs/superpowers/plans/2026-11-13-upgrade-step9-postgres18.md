# Upgrade Step 9 — Postgres 16 → 18 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the database on Postgres 18 with a safe, rehearsed path for production data. A deploy can never bring the site up on an empty database.

**Architecture:**
- Compose moves to `postgres:18-alpine` with a **new** named volume, `db-data-18`, mounted at `/var/lib/postgresql`. That is the 18 image's layout; `PGDATA` is `/var/lib/postgresql/18/docker`.
- The old `db-data` volume (Postgres 16) is never touched. It is the rollback.
- A guard script, run by `deploy.sh`, refuses to start when the old 16 volume exists and the new volume has not been migrated.
- A migration script does the rest: dump from a temporary 16 container, restore into 18, and compare every table's row count.

**Tech Stack:** `postgres:18-alpine` (18.6), `postgresql-client-18` from apt.postgresql.org (pgdg) in `backend/Dockerfile`, POSIX shell scripts, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 9). The user runs the production migration themselves. The builder only prepares and rehearses it.

**Probe already done (2026-11-13):**
- **The 18 image's layout.** `postgres:18-alpine` declares `VOLUME /var/lib/postgresql` and `PGDATA=/var/lib/postgresql/18/docker`.
- **Starting it on the old mount path.** With a volume at `/var/lib/postgresql/data`, the entrypoint **refuses to start**: "This is usually the result of upgrading the Docker image without upgrading the underlying database…". So 18 can never silently reuse the old mount.
- **The real danger.** If someone mounts the *old* volume at `/var/lib/postgresql`, the 18 entrypoint runs `initdb` in `18/docker/` next to the 16 files. The site then comes up on an **empty** database. Using a new volume name and adding the guard closes this off.
- **Client tools.**
  - The backend image installs `postgresql-client-16` from pgdg (`backend/Dockerfile:12-14`).
  - Admin export runs `pg_dump -F p --exclude-table=user_sessions`. Admin import runs `psql -v ON_ERROR_STOP=1 -f` (`.sql`) or `pg_restore` (`.dump`/`.tar`).
  - `backend/tests/integration/databaseRestore.test.ts` runs `pg_dump` and `psql` against the integration database.
  - pg_dump refuses to dump a server newer than itself, so the client must be 18. pg_dump 18 plain dumps carry `\restrict`/`\unrestrict` lines, which psql 18 understands.
- **BUG LOG #1** (flaky CI on PR #13): `curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc` hit a transient TLS EOF. The pgdg key fetch has no retry. It is fixed here, since the same lines change anyway.

## Global Constraints

- **Users can tell nothing changed.** After migration every table holds exactly the same rows, logins keep working (sessions may be dropped), and judging and contests are unaffected.
- **The site never comes up on an empty database by accident.**
  - `deploy.sh` must exit non-zero and print `docs/runbooks/postgres-18-upgrade.md` whenever the project's old volume `<project>_db-data` exists with `PG_VERSION` = `16` and `<project>_db-data-18` is missing or holds no initialised 18 cluster (`18/docker/PG_VERSION` = `18`).
  - It must also refuse if `<project>_db-data-18` has a 16-era `PG_VERSION` at its root.
  - A fresh install (neither volume exists) must pass.
- **The old volume is never modified or removed** by any script. The runbook's rollback is: check out the previous release (16) and deploy; the old volume still mounts at `/var/lib/postgresql/data`.
- **Migration script:**
  - It refuses to run if the 18 volume already holds a cluster, unless the operator passes `--force-recreate-18`, which re-creates *only* the 18 volume after a confirmation prompt.
  - It writes a full `pg_dumpall` backup to `backups/pg16-<UTC timestamp>.sql` and keeps it.
  - It compares exact row counts for **every** table in the app database's `public` schema between 16 and 18. It names `users`, `problems`, `testcases`, `submissions` and `contests` in its output, and exits non-zero on any mismatch, leaving the app stopped.
- **The builder never touches production.** Rehearsal happens only on a local copy with real-shaped data.
- `tests/authoring/compose.yml` uses `postgres:18-alpine` too, with its tmpfs at `/var/lib/postgresql`.
- Commits: the user is the sole author, no `Co-Authored-By` trailer. Branch `build/postgres-18` from the latest `main`. Squash-merge.

## Review Focus

1. **The guard is fooled by the project name.** `deploy.sh` runs compose with the default project name (the directory name, lowercased), or `COMPOSE_PROJECT_NAME` if set. The guard must read the project name the same way compose does (`docker compose … config --format json` → `.name`), and must not hardcode `oj`. Task 2's tests run the guard with two different project names.
2. **Restore loses objects that row counts can't see**: sequences, defaults, indexes, constraints, extensions. The rehearsal compares `pg_dump --schema-only` output from 16 and 18, normalised by dropping comments, `SET` lines and the `\restrict` lines. It checks each sequence's `last_value` too, so new inserts don't collide.
3. **Migration aborts halfway, leaving the operator with neither database running.** The script uses `set -eu` plus a trap that always prints the current state and the next command to run. The rehearsal also kills it after the dump step and checks that re-running it works.
4. **The integration and CI images still pull client 16**, or the pgdg key fetch stays flaky. Task 1 checks `pg_dump --version` inside the built backend image, and its tests pin `postgresql-client-18` and the curl retry flags.
5. **Admin DB export/import breaks against 18**: a plain dump from pg_dump 18 must import through the app's own `psql` path. The rehearsal exercises both through the API.

---

### Task 1: Compose, Dockerfile and tests on Postgres 18

**Files:**
- Modify: `docker-compose.yml` (database image, volume mount, volumes section), `tests/authoring/compose.yml` (image, tmpfs), `backend/Dockerfile` (`postgresql-client-18`, curl retry flags on the pgdg key fetch), `tests/composeConfig.test.mjs`
- Possibly modify: any other file that pins `postgres:16`, `postgresql-client-16` or `/var/lib/postgresql/data`. Run `git grep -n "postgres:16\|postgresql-client-16\|/var/lib/postgresql/data"` across the repo except `docs/superpowers/`, and update each hit, including docs (README, CLAUDE.md, `.context/*`).

- [ ] **Step 1: Failing tests first.** Extend `tests/composeConfig.test.mjs`:
  - `database runs Postgres 18 on the 18 volume layout`:
    - the local config's `services.database.image === 'postgres:18-alpine'`;
    - its volumes contain `{ type: 'volume', source: 'db-data-18', target: '/var/lib/postgresql' }`;
    - no volume targets `/var/lib/postgresql/data`;
    - `config.volumes['db-data-18']` exists and `config.volumes['db-data']` is absent.
  - `integration stack uses Postgres 18`: parse `tests/authoring/compose.yml` and assert:
    - `image: postgres:18-alpine`;
    - the tmpfs list contains `/var/lib/postgresql` and not `/var/lib/postgresql/data`.
  - `backend image installs the Postgres 18 client and retries the pgdg key fetch`: read `backend/Dockerfile` and assert:
    - it matches `/postgresql-client-18\b/` and does not match `/postgresql-client-16/`;
    - the line containing `ACCC4CF8.asc` includes `--retry 5` and `--retry-all-errors`.
  - The production overlay (`docker-compose.production.yml`) must not override the database image or volumes. Assert this through the merged config, as the existing production test does.

  Run `node --test tests/composeConfig.test.mjs` and expect the new tests to FAIL.
- [ ] **Step 2: Implement.**
  - `docker-compose.yml`: `image: postgres:18-alpine`, `- db-data-18:/var/lib/postgresql`, and the top-level `volumes:` gets `db-data-18: { driver: local }` with `db-data` removed. Add a comment next to the volume pointing to `docs/runbooks/postgres-18-upgrade.md` and saying the old `db-data` volume is kept on purpose.
  - `tests/authoring/compose.yml`: `image: postgres:18-alpine`, tmpfs `/var/lib/postgresql`.
  - `backend/Dockerfile`: `postgresql-client-18`, and the key fetch becomes `curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://www.postgresql.org/media/keys/ACCC4CF8.asc`.
  - Update every other `git grep` hit.
- [ ] **Step 3: Verify.**
  - `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs` passes.
  - `docker build -f backend/Dockerfile --target <each target the file defines> .` succeeds, and in the image `pg_dump --version` and `psql --version` print 18.x.
  - Integration stack: `COMPOSE_PROJECT_NAME=oj-pg18 docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests` reports 0 failed, with totals ≥ step 8's (125 suites / 1498 tests), and `databaseRestore.test.ts` ran and passed. Then `down -v`.
- [ ] **Step 4: Commit.** `git commit -m "build: Postgres 18 (compose, integration stack, client tools)"`

### Task 2: Upgrade guard, migration script and runbook

**Files:**
- Create: `scripts/pg18-guard.sh`, `scripts/pg18-migrate.sh`, `docs/runbooks/postgres-18-upgrade.md`, `tests/pg18Guard.test.mjs`
- Modify: `deploy.sh` (call the guard before `build`), `.github/workflows/ci.yml` (add `tests/pg18Guard.test.mjs` to the docker job's `node --test` list), `.gitignore` (`backups/`)

**Interfaces:**
- `scripts/pg18-guard.sh [compose args…]`:
  - Arguments: the same `-f` file arguments `deploy.sh` passes to `docker compose`.
  - Project name: resolved with `docker compose <args> config --format json` → `.name`. Parse it with `sed`/`awk`, not `jq`, which may be absent on the server. `OJ_PG_GUARD_PROJECT` overrides it, for tests only.
  - Reading a volume: `docker run --rm -v <vol>:/v:ro alpine:3 cat <path>`.
  - Exit codes:
    - 0: fresh install, or migrated;
    - 2: migration required, printing `Postgres 18 upgrade required: see docs/runbooks/postgres-18-upgrade.md` plus both volume names;
    - 3: the 18 volume holds 16-era data at its root.
- `scripts/pg18-migrate.sh [--force-recreate-18] [compose args…]`: runs the migration end to end, as specified in the Global Constraints.

- [ ] **Step 1: Failing guard tests.** `tests/pg18Guard.test.mjs` (`node:test`) uses Docker and creates throwaway volumes with a unique prefix per run, removed in `after()`. Each case calls the guard with `OJ_PG_GUARD_PROJECT=<prefix>`:
  - (a) no volumes → exit 0;
  - (b) `<p>_db-data` with `PG_VERSION` containing `16` and no `<p>_db-data-18` → exit 2, and stdout mentions the runbook path;
  - (c) the same plus `<p>_db-data-18` holding `18/docker/PG_VERSION` = `18` → exit 0;
  - (d) only `<p>_db-data-18`, with root `PG_VERSION` = `16` → exit 3;
  - (e) a second, different prefix behaves the same as (b) → exit 2. This proves the project name isn't hardcoded.

  Seed volumes with `docker run --rm -v <vol>:/v alpine:3 sh -c 'mkdir -p … && echo 16 > …'`. Run them and see them fail, because the script doesn't exist yet.
- [ ] **Step 2: `scripts/pg18-guard.sh`.** POSIX `sh` with `set -eu`; implements the interface above. Then wire it into `deploy.sh` right after the `compose=(…)` line: `scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml || exit $?`. Re-run the guard tests: all pass.
- [ ] **Step 3: `scripts/pg18-migrate.sh`.** POSIX `sh` with `set -eu` and a `trap` that prints the state and the next command on any exit. In order:
  1. Resolve the project name the same way the guard does.
  2. Preconditions: the old volume exists with `PG_VERSION` 16. The 18 volume is missing or empty; if it holds a cluster, abort unless `--force-recreate-18` (with a prompt).
  3. `docker compose <args> stop` for all services.
  4. Start a temporary `postgres:16-alpine` container on the old volume at `/var/lib/postgresql/data`, on no network, with the same `POSTGRES_*` env read from the compose config. Wait for `pg_isready`.
  5. Write `backups/pg16-<UTC>.sql` with `pg_dumpall`, and a custom-format `pg_dump -Fc` of the app database to `backups/pg16-<UTC>.dump`. Record exact `count(*)` for every `public` table to `backups/pg16-<UTC>.counts`.
  6. Stop and remove the temporary container. Its volume stays.
  7. `docker compose <args> up -d database`, which initialises 18 with the same env. Wait until healthy.
  8. Restore: `pg_restore --no-owner --role=$POSTGRES_USER -d $POSTGRES_DB` from the `.dump`, then restore any non-default roles from the `pg_dumpall` globals. Ignore only "role already exists".
  9. Write the 18-side counts and diff them against the 16 counts. On a mismatch, exit 1 and leave the app stopped.
  10. `docker compose <args> up -d`, then print the verification checklist from the runbook.
- [ ] **Step 4: Runbook** `docs/runbooks/postgres-18-upgrade.md`. Cover:
  - why it is needed;
  - the prerequisites: free disk ≥ 2× the database, a maintenance window, and the release that contains this PR;
  - the exact commands;
  - what the script checks;
  - the manual verification: login, recent submissions, a contest scoreboard, admin export;
  - rollback, step by step, keeping `db-data`;
  - cleanup of `db-data` only after N days and a fresh backup.

  Add one line to `CLAUDE.md` / `README.md` deployment notes pointing to the runbook.
- [ ] **Step 5: Verify.**
  - `node --test tests/pg18Guard.test.mjs tests/composeConfig.test.mjs` passes.
  - `sh -n scripts/*.sh` is clean, and `shellcheck` too if it's available (run via the `koalaman/shellcheck` image).
  - `bash -n deploy.sh` is clean.
- [ ] **Step 6: Commit.** `git commit -m "ops: Postgres 18 upgrade guard, migration script and runbook"`

### Task 3: Rehearsal, verification and PR

- [ ] **Step 1: Real-shaped 16 database.**
  - In a `git worktree` of `main` at the commit before this branch, start a stack with `COMPOSE_PROJECT_NAME=oj-pgrehearse HTTP_PORT=8091 docker compose --env-file .env.example up --build -d`. That stack runs Postgres 16 with volume `oj-pgrehearse_db-data`.
  - Create an admin and seed data through the API and the seed scripts:
    - at least 20 users (batch user creation);
    - 5 problems with testcases;
    - at least 30 submissions with mixed verdicts;
    - 2 contests, one finished;
    - an author profile with an image;
    - a draft with a statement asset;
    - XP rewards (`seed_xp_tiers` if it runs against the stack).
  - Record the per-table counts. Then `docker compose … down` **without** `-v`.
- [ ] **Step 2: Guard.** From this branch's worktree, with `COMPOSE_PROJECT_NAME=oj-pgrehearse`, run `scripts/pg18-guard.sh -f docker-compose.yml`: it exits 2 and prints the runbook. Running the branch's `docker compose up -d` without migrating would bring up 18 on the empty new volume, which is exactly what the guard prevents. Do NOT do it on the rehearsal project.
- [ ] **Step 3: Migrate.**
  - Run `scripts/pg18-migrate.sh -f docker-compose.yml`, with the env file arguments if needed. The counts must match.
  - Compare normalised `pg_dump --schema-only` output (16 from the `.dump` via `pg_restore -s -f`, 18 live) and every sequence's `last_value`.
  - Abort-and-rerun check: re-create the 18 volume with `--force-recreate-18` and kill the script right after the dump step. A rerun must complete.
- [ ] **Step 4: Site on 18.**
  - Check the guard now exits 0. Then, in the browser:
    - log in with the seeded admin;
    - the problem list, submissions and the finished contest's scoreboard show the seeded data;
    - submit C++ → Accepted (new IDs don't collide with the sequences);
    - admin **DB export** downloads a plain dump made with pg_dump 18, and **re-importing** that file through admin import succeeds.
  - Rollback drill: check out `main`'s compose (16) on the same project and start it. The old data is all there, and nothing in `db-data` changed. Then tear everything down with `down -v` and remove both rehearsal volumes.
- [ ] **Step 5: CI-equivalent.** `node --test tests/*.test.mjs` from the repo root. Integration stack, as in Task 1 Step 3.
- [ ] **Step 6: PR.**
  - Branch `build/postgres-18`, title `build: Postgres 18 with upgrade guard and migration runbook (step 9/9)`.
  - The body includes:
    - the before/after;
    - why the volume name changed;
    - how the guard behaves, case by case;
    - the rehearsal transcript summary (counts table, schema diff, sequences, abort/rerun, rollback drill);
    - the bug-log fix (curl retry);
    - a bold reminder that **the production migration is the user's to run, following the runbook, and that `deploy.sh` will refuse until it's done**;
    - what was not verified.
  - No Claude footer. Squash-merge.
