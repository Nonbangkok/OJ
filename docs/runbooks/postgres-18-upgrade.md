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
| 0 | fresh install (no `<project>_db-data` with `PG_VERSION` 16; no marker needed), or `<project>_db-data-18` holds an 18 cluster **with the migrated marker** `.oj-pg18-migrated-from-16` | continues |
| 2 | **migration required**: the old 16 volume exists and the 18 volume is missing, has no initialised cluster, has a cluster **without the migrated marker** (it was initialised without migrating, e.g. by a raw `docker compose up`), or carries the `.oj-pg18-migration-incomplete` marker of an interrupted/failed run | stops, prints this runbook's path, both volume names and the next command (`scripts/pg18-migrate.sh --force-recreate-18 …` when the 18 volume already holds a cluster) |
| 3 | the 18 volume has a `PG_VERSION` at its root, i.e. old-layout data was put into it | stops; investigate before doing anything else |
| 1 | the guard could not inspect the volumes (Docker error) | stops (fails closed) |

> **Warning: deploy only with `./deploy.sh`.** A raw `docker compose up`
> (or `up -d database`) on the 18 release bypasses the guard: Postgres 18
> initialises an **empty** cluster in `<project>_db-data-18` and the site serves
> an empty database. If that happens, stop the stack; the 16 data is still
> intact in `<project>_db-data`. The guard keeps refusing that 18 volume (no
> migrated marker), and `scripts/pg18-migrate.sh --force-recreate-18 …`
> replaces it with a real migration.

### The migrated marker

`scripts/pg18-migrate.sh` writes `.oj-pg18-migrated-from-16` at the **root of
the 18 volume** (`/var/lib/postgresql/.oj-pg18-migrated-from-16` inside the
database container, next to `18/`). It holds the source volume, the backup name
and a UTC timestamp. The script writes it as its very last data step, only
after the 16-vs-18 row counts matched, and atomically (temp file + `mv`). An
interrupted or failed run therefore never leaves it. While the old 16 volume
exists, the guard passes only when this marker is present and the
`.oj-pg18-migration-incomplete` marker is absent. Once the old volume has been
removed (see Cleanup), the marker no longer matters.

**Creating it by hand** is only for the case where you restored the 18 database
some other way (for example from an admin export) **and** verified the data
(row counts of users / problems / testcases / submissions / contests against
the 16 data, plus the checklist below). Then, with the stack stopped:

```bash
docker run --rm -v <project>_db-data-18:/v alpine:3 \
  sh -c 'printf "from=manual\nby=%s\nat=%s\n" "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /v/.oj-pg18-migrated-from-16' sh "$USER"
```

Never create it just to get past the guard: that is exactly the
empty-database deploy the guard exists to stop.

## Prerequisites

- **The release containing the Postgres 18 change** (this runbook,
  `scripts/pg18-migrate.sh`, `scripts/pg18-guard.sh`) is checked out on the
  server: `git pull` / `git checkout <release>`. Do **not** run `./deploy.sh`
  yet, and never run a raw `docker compose up` on this release (see the
  warning above).
- **Free disk ≥ 4× the database size.** The data is mostly `bytea`
  (testcases, assets), and the plain `pg_dumpall` writes bytea as hex, about
  2× the raw size. On top of that come the `.dump`, its transient copies inside
  the temporary containers, and the new 18 cluster; the old volume is kept. The
  script measures the old cluster's data (`base/`). Before stopping anything it
  **aborts** if the `backups/` filesystem has less than 4× that free, or
  Docker's data filesystem (`docker info -f '{{.DockerRootDir}}'`, where the
  18 volume lives) less than 2×. It prints `df -h` for both. Override only if
  you are sure: `OJ_PG18_SKIP_DISK_CHECK=1`. Check by hand with
  `df -h . "$(docker info -f '{{.DockerRootDir}}')"` and
  `docker system df -v | grep db-data`.
- **A maintenance window.** The site is down from the moment the script stops
  the stack until it restarts it; plan for a few minutes plus dump/restore
  time (roughly proportional to the database size). The script builds this
  release's images (`docker compose … build`) **before** it stops anything,
  so the build doesn't add to the downtime.
- **Run it inside `tmux` or `screen`.** A dropped SSH session sends SIGHUP.
  The script traps HUP/INT/TERM/PIPE and always stops its temporary Postgres 16
  server before exiting, but a detached session avoids the interruption
  altogether. Ctrl-C is safe in the same way.
- The server's `.env` is the one production uses (the scripts read
  `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` through compose).
- Announce the window to users.

## Commands

From the repository root on the server:

```bash
tmux new -s pg18        # or: screen -S pg18

# 0. confirm the guard sees a pending migration (exit 2 expected)
scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml; echo "guard exit: $?"

# 1. migrate (checks disk, builds images, stops the stack, backs up, restores
#    into 18, verifies, starts the stack, checks the backend's pg_dump is 18)
mkdir -p backups
scripts/pg18-migrate.sh -f docker-compose.yml -f docker-compose.production.yml 2>&1 \
  | tee "backups/pg18-migrate-$(date -u +%Y%m%dT%H%M%SZ).log"

# 2. the normal path from here on: deploy this release (the guard now passes;
#    deploy.sh rebuilds, recreates and health-checks everything)
./deploy.sh
```

The `tee` keeps a log next to the backups; the script's own last lines say
`DONE` or `FAILED` (the pipeline's exit status is `tee`'s).

If the script stops with an error it prints the stage it reached, the state the
system is in, and the exact next command. No script removes, re-initialises or
writes user data to the old volume. Postgres itself rewrites its own system,
WAL and statistics files there when the temporary 16 server starts and stops
cleanly, so the volume is not byte-identical afterwards, but its data is
unchanged.

If the 18 volume already holds data (for example after a failed attempt, or
after someone ran `docker compose up` before migrating), the script refuses. To
delete **only** the 18 volume and start over from the (data-unmodified) 16 volume:

```bash
scripts/pg18-migrate.sh --force-recreate-18 -f docker-compose.yml -f docker-compose.production.yml
# type the volume name (e.g. oj_db-data-18) when asked
```

## What the script checks and does

1. Resolves the project name with `docker compose <args> config --format json`.
2. Preconditions (nothing is stopped if these fail; the Docker daemon must be
   reachable):
   - `<project>_db-data` exists and its `PG_VERSION` is `16`;
   - `<project>_db-data-18` is missing or empty, else it refuses unless
     `--force-recreate-18` is given and the volume name is typed back;
   - `backups/` is writable; free disk passes the 4× / 2× check above; pulls
     `postgres:16-alpine`, `alpine:3` and the compose database image, and runs
     `docker compose <args> build` (fails → aborts with the site still up).
3. `docker compose <args> stop` for all services, removes a leftover
   `<project>-pg16-migrate` container from an earlier killed run, then
   verifies that no running container still uses either volume.
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
   is; only "role already exists" errors are tolerated, and psql failing to
   connect or run aborts), then the app database with
   `pg_restore --no-owner --role=$POSTGRES_USER --single-transaction --exit-on-error`.

   **Not carried over:** database-level settings, i.e. `ALTER DATABASE … SET`,
   database-level `GRANT`/`REVOKE CONNECT`, and per-role-in-database settings
   (`ALTER ROLE … IN DATABASE … SET`). `pg_dump` without `--create` doesn't emit
   them, and the database itself is created by the 18 image. The app uses none
   of these. If you added any by hand, re-apply them on 18 after the migration.
9. Writes `pg18-<UTC>.counts` and diffs it against the 16 counts, printing
   users / problems / testcases / submissions / contests side by side. **Any
   difference exits 1 and leaves the app stopped** (the incomplete marker stays
   and no migrated marker is written, so `deploy.sh` refuses too).
10. Removes the incomplete marker, then atomically writes the migrated marker
    `.oj-pg18-migrated-from-16` (see above). It re-runs the guard (which must
    pass), and runs `docker compose <args> up -d` with the images built in
    step 2. It then checks that `docker compose <args> exec -T backend pg_dump --version`
    reports major version **18**. A backend image left over from the 16 release
    (pg_dump 16) would make Admin → DB export fail with "server version
    mismatch", so the script fails loudly instead. Finally it prints the
    checklist below. Running `./deploy.sh` afterwards is still the normal path.

## Manual verification

<!-- checklist:start -->
Manual verification (docs/runbooks/postgres-18-upgrade.md):
  [ ] docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T backend pg_dump --version  -> 18.x
  [ ] ./deploy.sh finished with "OJ deployment healthy"
  [ ] Log in with an existing account (old sessions may need a fresh login)
  [ ] Submissions: the most recent submissions from before the window are listed with their verdicts
  [ ] Submit a solution to a problem and see it judged
  [ ] Open a contest scoreboard (a finished contest) and check ranks and scores
  [ ] Admin: run a database export and confirm the download completes
  [ ] docker compose -f docker-compose.yml -f docker-compose.production.yml exec database psql -U "$POSTGRES_USER" -c 'SELECT version()'  -> PostgreSQL 18
<!-- checklist:end -->

## Rollback

The old volume `<project>_db-data` still holds the Postgres 16 data as of the
moment the script stopped the stack (its data is unmodified; only Postgres's
own system/WAL files were rewritten by the clean start/stop of the temporary
server). Rolling back loses anything
written to Postgres 18 after the migration (new users, submissions, …); if that
matters, export it first (admin export, or
`docker compose … exec database pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backups/pg18-before-rollback.dump`).

0. **Make sure nothing else has the old volume open.** A second Postgres on
   the same data directory corrupts it:
   ```bash
   docker ps -a --filter volume=<project>_db-data --format '{{.Names}} {{.Status}}'
   ```
   This must list nothing except the compose database container
   (`<project>-database-1`). If `<project>-pg16-migrate` is listed (left by a
   migration that was killed outright), remove it first:
   `docker rm -f <project>-pg16-migrate`.
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
