# Runbook: Postgres 16 → 18 upgrade (production)

This is a one-time, operator-run procedure. Nothing in CI or in `deploy.sh`
migrates data automatically; `deploy.sh` only refuses to start until the
migration below has been done.

## Why it is needed

The release that moves the stack to `postgres:18-alpine` also changes where the
data lives:

| | Postgres 16 (before) | Postgres 18 (after) |
|---|---|---|
| Volume | `<project>_db-data` | `<project>_db-data-18` |
| Mount point | `/var/lib/postgresql/data` | `/var/lib/postgresql` |
| Data directory | volume root (`PG_VERSION` = `16`) | `18/docker/` (`18/docker/PG_VERSION` = `18`) |

Postgres cannot open a data directory from a different major version, and the
18 image refuses a volume at the old mount point. If the 18 server simply
started on a new, empty volume, the site would come up **with an empty
database** while the real data sat unused in the old volume. So the data has to
be dumped from 16 and restored into 18 once.

`<project>` is the Docker Compose project name (normally the checkout
directory's name, e.g. `oj`, or `COMPOSE_PROJECT_NAME`). The scripts work it out
themselves with `docker compose … config`; check it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config --format json | head -n 3
docker volume ls | grep db-data
```

### The deploy guard

`deploy.sh` runs `scripts/pg18-guard.sh` before it builds anything. The guard only
reads the volumes (through a read-only mount) and exits:

| Exit | Meaning | What `deploy.sh` does |
|---|---|---|
| 0 | fresh install (no `<project>_db-data` with `PG_VERSION` 16), or `<project>_db-data-18` holds a completed 18 cluster | continues |
| 2 | **migration required**: the old 16 volume exists and the 18 volume is missing, has no initialised cluster, or carries the "migration incomplete" marker left by an interrupted run | stops, prints this runbook's path and both volume names |
| 3 | the 18 volume has a `PG_VERSION` at its root, i.e. old-layout data was put into it | stops; investigate before doing anything else |
| 1 | the guard could not inspect the volumes (Docker error) | stops (fails closed) |

## Prerequisites

- **The release containing the Postgres 18 change** (this runbook,
  `scripts/pg18-migrate.sh`, `scripts/pg18-guard.sh`) is checked out on the
  server: `git pull` / `git checkout <release>`. Do **not** run `./deploy.sh` or
  `docker compose up` yet.
- **Free disk ≥ 2× the database size**: one copy for the backups in `backups/`
  and one for the new 18 volume (the old volume is kept). Check with
  `df -h . /var/lib/docker` and, for the current size,
  `docker system df -v | grep db-data`.
- **A maintenance window.** The site is down from the moment the script stops
  the stack until it restarts it; plan for a few minutes plus dump/restore
  time (roughly proportional to the database size).
- The server's `.env` is the one production uses (the scripts read
  `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` through compose).
- Announce the window to users.

## Commands

From the repository root on the server:

```bash
# 0. confirm the guard sees a pending migration (exit 2 expected)
scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml; echo "guard exit: $?"

# 1. migrate (stops the stack, backs up, restores into 18, verifies, starts the stack)
mkdir -p backups
scripts/pg18-migrate.sh -f docker-compose.yml -f docker-compose.production.yml 2>&1 \
  | tee "backups/pg18-migrate-$(date -u +%Y%m%dT%H%M%SZ).log"

# 2. build and roll out this release properly (the guard now passes)
./deploy.sh
```

The `tee` keeps a log next to the backups; the script's own last lines say
`DONE` or `FAILED` (the pipeline's exit status is `tee`'s).

If the script stops with an error it prints the stage it reached, the state the
system is in, and the exact next command. The old volume is never removed or
recreated by either script.

If the 18 volume already holds data (for example after a failed attempt, or
after someone ran `docker compose up` before migrating), the script refuses. To
delete **only** the 18 volume and start over from the untouched 16 volume:

```bash
scripts/pg18-migrate.sh --force-recreate-18 -f docker-compose.yml -f docker-compose.production.yml
# type the volume name (e.g. oj_db-data-18) when asked
```

## What the script checks and does

1. Resolves the project name with `docker compose <args> config --format json`.
2. Preconditions (nothing is stopped if these fail):
   - `<project>_db-data` exists and its `PG_VERSION` is `16`;
   - `<project>_db-data-18` is missing or empty, else it refuses unless
     `--force-recreate-18` is given and the volume name is typed back;
   - `backups/` is writable; prints free space; pulls `postgres:16-alpine`,
     `alpine:3` and the compose database image ahead of the downtime.
3. `docker compose <args> stop` for all services, then verifies that no
   running container still uses either volume.
4. Reads `POSTGRES_*` exactly as compose passes them to the database service,
   writes a `.oj-pg18-migration-incomplete` marker into the 18 volume (the guard
   refuses to deploy while it is there), and starts a temporary
   `postgres:16-alpine` container on the old volume with no network.
5. Backups in `backups/` (mode 600; they contain password hashes, keep them
   private):
   - `pg16-<UTC>.sql`: full `pg_dumpall` (kept as the cold backup);
   - `pg16-<UTC>.globals.sql`: roles only;
   - `pg16-<UTC>.dump`: `pg_dump -Fc` of the app database, checked with `pg_restore -l`;
   - `pg16-<UTC>.counts`: exact `count(*)` of every table in the app
     database's `public` schema. The script refuses to continue if `users`,
     `problems`, `testcases`, `submissions` or `contests` is missing.
6. Stops and removes the temporary container (clean shutdown); the volume stays.
7. `docker compose <args> up -d database`, which initialises Postgres 18 with
   the same env; waits until it is healthy and accepting TCP connections,
   checks the server version is 18 and the app database is empty.
8. Restores roles from the globals (the compose-created superuser is kept as
   is; only "role already exists" errors are tolerated), then the app database
   with `pg_restore --no-owner --role=$POSTGRES_USER --single-transaction --exit-on-error`.
9. Writes `pg18-<UTC>.counts` and diffs it against the 16 counts, printing
   users / problems / testcases / submissions / contests side by side. **Any
   difference exits 1 and leaves the app stopped** (the marker stays, so
   `deploy.sh` refuses too).
10. Removes the marker, records `.oj-pg18-migrated-from-16` in the 18 volume,
    re-runs the guard (must pass), `docker compose <args> up -d`, and prints the
    checklist below.

## Manual verification

<!-- checklist:start -->
Manual verification (docs/runbooks/postgres-18-upgrade.md):
  [ ] ./deploy.sh finished with "OJ deployment healthy"
  [ ] Log in with an existing account (old sessions may need a fresh login)
  [ ] Submissions: the most recent submissions from before the window are listed with their verdicts
  [ ] Submit a solution to a problem and see it judged
  [ ] Open a contest scoreboard (a finished contest) and check ranks and scores
  [ ] Admin: run a database export and confirm the download completes
  [ ] docker compose -f docker-compose.yml -f docker-compose.production.yml exec database psql -U "$POSTGRES_USER" -c 'SELECT version()'  -> PostgreSQL 18
<!-- checklist:end -->

## Rollback

The old volume `<project>_db-data` is untouched and still holds the Postgres 16
data as of the moment the script stopped the stack. Rolling back loses anything
written to Postgres 18 after the migration (new users, submissions, …); if that
matters, export it first (admin export, or
`docker compose … exec database pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backups/pg18-before-rollback.dump`).

1. Stop the stack:
   `docker compose -f docker-compose.yml -f docker-compose.production.yml stop`
2. Check out the previous release (the one that used `postgres:16-alpine`
   with `db-data:/var/lib/postgresql/data`):
   `git checkout <previous release tag or commit>`
3. Deploy it: `./deploy.sh`. The old release has no guard and starts
   Postgres 16 on `<project>_db-data`.
4. Verify with the checklist above (the version line should say 16).
5. Keep `<project>_db-data-18` for investigation; do not delete either volume.
   To try the upgrade again later, check out the 18 release and run
   `scripts/pg18-migrate.sh --force-recreate-18 …`.

If the 16 volume itself were ever damaged, `backups/pg16-<UTC>.sql` restores a
complete 16 cluster: start `postgres:16-alpine` on a new, empty volume and run
`psql -U <user> -d postgres -f pg16-<UTC>.sql` inside it.

## Cleanup (later, not on upgrade day)

Remove the old volume only when all of these hold:

- at least **N = 14 days** have passed on Postgres 18 without needing a rollback;
- a **fresh backup** of the 18 database exists and has been copied off the
  server (admin export, or
  `docker compose … exec database pg_dumpall -U "$POSTGRES_USER" > backups/pg18-$(date -u +%Y%m%d).sql`);
- the backup was checked to be non-empty and readable.

Then:

```bash
docker volume rm <project>_db-data        # e.g. oj_db-data; never the -18 volume
scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml   # still exit 0
```

Move or delete the old `backups/pg16-*` files according to your retention policy.
