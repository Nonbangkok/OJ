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
| 0 | no old volume `<project>_db-data`, or an old volume without `PG_VERSION` (fresh install / already cleaned up); **or** `<project>_db-data-18` holds an 18 cluster with the migrated marker `.oj-pg18-migrated-from-16` whose pg_control fingerprint still matches the old volume (a hand-made marker without a fingerprint passes with a warning) | continues |
| 1 | Docker is unreachable, a volume could not be read, or `docker compose … config` failed / the project name could not be read from it | stops (fails closed) |
| 2 | the old volume holds a cluster (**any** `PG_VERSION`) that was not migrated: the 18 volume is missing, has no cluster, or has a cluster **without the migrated marker** (e.g. initialised empty by a raw `docker compose up`); **or** the marker's fingerprint no longer matches, i.e. Postgres 16 was started on the old volume after the migration (a **rollback**); **or** the 18 volume carries `.oj-pg18-migration-incomplete` (an interrupted or failed run; refused even when no old volume exists) | stops, prints this runbook's path, both volume names and the exact next command |
| 3 | the 18 volume has a `PG_VERSION` at its root, i.e. 16-era data was put into it | stops; investigate before doing anything else |

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
and `migrated_at` (UTC). It also holds `pg16_pg_control_sha256`, the sha256 of
the old volume's `global/pg_control` taken right after the temporary 16 server
stopped. The script writes it as its very last data step, only after the
16-vs-18 row counts matched, and atomically (temp file + `mv`). An interrupted
or failed run therefore never leaves it. While the old volume exists, the guard
passes only when this marker is present, its fingerprint still matches the old
volume, and `.oj-pg18-migration-incomplete` is absent.

**Why the fingerprint:** every start or stop of Postgres 16 rewrites
`pg_control`. After a rollback (16 running on the old volume again, taking new
writes), the fingerprint no longer matches, and a later routine
`git pull && ./deploy.sh` is refused (exit 2) instead of silently switching the
site to the stale first-migration 18 data. Once the old volume has been removed
(see Cleanup), the marker no longer matters.

**Creating it by hand** is only for the case where you restored the 18 database
some other way (for example from an admin export) **and** verified the data
(row counts of users / problems / testcases / submissions / contests against
the 16 data, plus the checklist below). Then, with the stack stopped:

```bash
docker run --rm -v <project>_db-data-18:/v alpine:3 \
  sh -c 'printf "from=manual\nby=%s\nmigrated_at=%s\n" "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /v/.oj-pg18-migrated-from-16' sh "$USER"
```

A hand-made marker has no fingerprint, so the guard cannot detect a later
rollback; it prints a warning on every deploy until the old volume is removed.

Never create it just to get past the guard: that is exactly the
empty-database deploy the guard exists to stop.

## Prerequisites

- **The release containing the Postgres 18 change** (this runbook,
  `scripts/pg18-migrate.sh`, `scripts/pg18-guard.sh`) is checked out on the
  server: `git pull` / `git checkout <release>`. Do **not** run `./deploy.sh`
  yet, and never run a raw `docker compose up` on this release (see the
  warning above).
- **Free disk: ≥ 6× the database's on-disk size when `backups/` and Docker's
  data directory share a filesystem (the usual case), otherwise ≥ 4× on the
  `backups/` filesystem and ≥ 2× on Docker's.** Testcase inputs/outputs are
  `TEXT`, stored TOAST-compressed on disk; the plain `pg_dumpall` writes them
  uncompressed, and writes `bytea` (assets) as hex at about 2× the raw size.
  So the `.sql` alone can be several times the on-disk size. On top of that
  come the `.dump`, its transient copies inside the temporary containers, and
  the new 18 cluster; the old volume is kept. After building the images and
  before stopping anything, the script measures the old cluster's data
  (`base/`) and the free space of both filesystems. It treats them as one when
  the device matches, prints `df -h` for both, and **aborts** if the rule above
  is not met. Override only if you are sure: `OJ_PG18_SKIP_DISK_CHECK=1`.
  Check by hand with `df -h . "$(docker info -f '{{.DockerRootDir}}')"` and
  `docker system df -v | grep db-data`.
  - **Measured on production (2026-11-13):** for 4950 MiB of `base/`, the
    `.sql` was 8.66 GB (1.75×), the `.dump` 3.07 GB (0.62×), the transient
    dump copy inside the container another 0.62×, and the new cluster 5.9 GB
    (1.2×, including 1 GB of WAL). The peak was about 4.3×, so the 6× rule
    held inside the VM.
  - **If the server is a VM on thin-provisioned storage** (e.g. Proxmox
    LVM-thin, qcow2, a cloud disk with a quota), the **host** must also have
    room for the guest to write those ~4–5× of new blocks. The script can only
    see the guest's filesystem. When the host pool fills, the VM is paused or
    gets I/O errors: everything stops at once (SSH, Tailscale, the Cloudflare
    tunnel), which is what happened on production mid-restore.
- **A maintenance window.** The site is down from the moment the script stops
  the stack until it restarts it; plan for a few minutes plus dump/restore
  time (roughly proportional to the database size). The script builds this
  release's images (`docker compose … build`) **before** it stops anything,
  so the build doesn't add to the downtime.
- **Run it inside `tmux` or `screen`.** A dropped SSH session sends SIGHUP.
  The script traps HUP/INT/TERM/PIPE. Before exiting it stops its temporary
  Postgres 16 server with `docker stop -t 120`, which gives Postgres 120 s for
  a clean shutdown and then SIGKILLs it. The script then polls (up to another
  120 s) until Docker confirms the container is no longer running; only a
  container that survives that is force-removed, and the script says so. A detached
  session avoids the interruption altogether. On Ctrl-C the same cleanup runs:
  wait for it rather than pressing Ctrl-C again or killing the terminal.
- **Run one migration at a time.** Two concurrent runs on the same project would
  fight over the same volumes and the same temporary container
  (`<project>-pg16-migrate`), so the script takes a lock first: it creates
  `backups/.pg18-migrate.lock` (with a `pid`/`started_at` file inside) before
  it touches Docker, and removes it on exit, also after a failure or Ctrl-C. A
  second run refuses while the lock exists, and changes nothing. A run that was
  killed outright (`kill -9`, power loss) leaves a stale lock. Remove it only
  after you confirm that no migration is running: `ps -ef | grep '[p]g18-migrate'`
  shows nothing, and neither does `docker ps -a --filter name=pg16-migrate`.
  Then run `rm -rf backups/.pg18-migrate.lock`.
- **Exactly one `cloudflared` connector for the tunnel.** `production.conf`
  trusts `X-Forwarded-Proto` only from the compose `cloudflared` at
  `172.30.250.3` and redirects every other plain-HTTP request to HTTPS. A second
  connector running with the same `TUNNEL_TOKEN` (e.g. an old hand-started
  `docker run` container on another network) gets about half the traffic, and
  every one of its requests is redirected again and again: browsers show "too
  many redirects" intermittently. List them before deploying and stop any that
  is not the compose service `cloudflared`:
  `docker ps --format '{{.Names}} {{.Networks}}' | grep -i cloudflared`.
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
  | tee -i "backups/pg18-migrate-$(date -u +%Y%m%dT%H%M%SZ).log"
cat backups/pg18-migrate.status   # final status + next command, also after a Ctrl-C

# 2. the normal path from here on: deploy this release (the guard now passes;
#    deploy.sh rebuilds, recreates and health-checks everything)
./deploy.sh
```

The `tee` keeps a log next to the backups (`-i` keeps tee alive on Ctrl-C, so
the FAILED message and next command still reach the log). The script also
writes its final status (`DONE`, or `FAILED` + stage + next command) to
`backups/pg18-migrate.status`. The pipeline's exit status is `tee`'s, so read
the status file rather than `$?`.

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

If that 18 volume holds a **completed** migration (migrated marker present), the
script first prints a loud warning with its `migrated_at` time: everything
written to 18 since then will be lost. Export it first (see "Backups of the 18
database" below) unless you are sure.

An 18 volume left over from a **rollback** (marker renamed to
`.oj-pg18-rolled-back`, see Rollback step 2) gets no such warning, because it
has no migrated marker any more. It may still hold writes made on 18 between
the migration and the rollback, so export it first in the same way if any of
them could matter.

## What the script checks and does

1. Resolves the project name with `docker compose <args> config --format json`.
2. Preconditions (nothing is stopped if these fail; the Docker daemon must be
   reachable):
   - `<project>_db-data` exists and its `PG_VERSION` is `16`;
   - `<project>_db-data-18` is missing or empty, else it refuses unless
     `--force-recreate-18` is given and the volume name is typed back;
   - `backups/` is writable; pulls `postgres:16-alpine`, `alpine:3` and the
     compose database image, and runs `docker compose <args> build` (fails →
     aborts with the site still up); then the free-disk check above.
3. `docker compose <args> stop -t 60` for all services, removes a leftover
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
6. Stops the temporary container (`docker stop -t 120`: clean shutdown, SIGKILL
   at 120 s; then it waits until Docker confirms it has exited), records
   the sha256 of the old volume's `global/pg_control` (read-only mount), and
   removes the container; the volume stays.
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
    `.oj-pg18-migrated-from-16` with the fingerprint (see above). It re-runs the guard (which must
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
  [ ] docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version()"'  -> PostgreSQL 18
<!-- checklist:end -->

## Backups of the 18 database

Run these from the repository root. The `sh -c '…'` makes `$POSTGRES_USER` /
`$POSTGRES_DB` expand **inside** the database container, where they are set;
your host shell does not have them. `-T` disables the TTY, which would
otherwise corrupt a binary archive.

The `( umask 077; … )` subshell makes the files mode 600, like the script's
own backups (they contain password hashes), without changing your shell's umask.

```bash
# custom-format archive of the app database, then check that it is readable
( umask 077; docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T database \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/pg18-$(date -u +%Y%m%dT%H%M%SZ).dump )
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T database \
  pg_restore -l < backups/pg18-<UTC>.dump | head

# whole cluster (roles + all databases) as plain SQL
( umask 077; docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T database \
  sh -c 'pg_dumpall -U "$POSTGRES_USER"' > backups/pg18-$(date -u +%Y%m%dT%H%M%SZ).sql )
tail -n 3 backups/pg18-<UTC>.sql   # ends with "PostgreSQL database cluster dump complete"
```

An 18 export **cannot be restored into Postgres 16 as-is**: pg_restore 16
rejects archives written by pg_dump 18, and plain dumps from pg_dump 17+ emit
settings such as `SET transaction_timeout` that 16 does not know. Keep such
exports for safekeeping and for re-entering data by hand.

## Rollback

The old volume `<project>_db-data` still holds the Postgres 16 data as of the
moment the script stopped the stack. Its data is unmodified; only Postgres's
own system/WAL files were rewritten by the clean start/stop of the temporary
server. Rolling back loses anything written to Postgres 18 after the migration
(new users, submissions, …). If that matters, export it first (admin export, or
the commands under "Backups of the 18 database" above, e.g. to
`backups/pg18-before-rollback.dump`).

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
2. **Invalidate the migrated marker** so no later deploy of the 18 release can
   pick up this (soon stale) 18 data. The guard would also detect the rollback
   through the fingerprint; this makes it explicit:
   ```bash
   docker run --rm -v <project>_db-data-18:/v alpine:3 mv /v/.oj-pg18-migrated-from-16 /v/.oj-pg18-rolled-back
   ```
   If you are rolling back from a **failed** migration there is no migrated
   marker, so this `mv` fails with "No such file or directory". That is
   harmless: without the marker the guard already refuses that 18 volume.

   **Changed your mind before step 4?** As long as Postgres 16 has **not**
   been started on `<project>_db-data`, undo the rename and deploy the 18
   release again with `./deploy.sh`:
   ```bash
   docker run --rm -v <project>_db-data-18:/v alpine:3 mv /v/.oj-pg18-rolled-back /v/.oj-pg18-migrated-from-16
   ```
   Once 16 has run on the old volume, the undo is not valid: the old volume's
   `pg_control` has changed, so the guard refuses the restored marker anyway
   (exit 2). Finish the rollback, then use "Migrating again later".
3. Check out the previous release (the one that used `postgres:16-alpine`
   with `db-data:/var/lib/postgresql/data`):
   `git checkout <previous release tag or commit>`
4. Deploy it: `./deploy.sh`. The old release has no guard and starts
   Postgres 16 on `<project>_db-data`.
5. Verify with the checklist above (the version line should say 16).
6. Keep `<project>_db-data-18` for investigation; do not delete either volume.

**Migrating again later** (after fixing whatever caused the rollback):

1. Check out the 18 release: `git checkout <18 release>`.
2. `scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml; echo $?`
   → `2`: the 18 volume has no valid marker (or the fingerprint no longer matches).
3. Go through Prerequisites again (disk, window, tmux), then run the migration
   with `--force-recreate-18`. It deletes **only** the stale 18 volume and
   migrates the current 16 data, including everything written during the
   rollback period:
   ```bash
   scripts/pg18-migrate.sh --force-recreate-18 -f docker-compose.yml -f docker-compose.production.yml 2>&1 \
     | tee -i "backups/pg18-migrate-$(date -u +%Y%m%dT%H%M%SZ).log"
   ```
4. `./deploy.sh`, then the checklist.

If the 16 volume itself were ever damaged, `backups/pg16-<UTC>.sql` restores a
complete 16 cluster: start `postgres:16-alpine` on a new, empty volume and run
`psql -U <user> -d postgres -f pg16-<UTC>.sql` inside it.

## Cleanup (later, not on upgrade day)

Remove the old volume only when all of these hold:

- at least **N = 14 days** have passed on Postgres 18 without needing a rollback;
- a **fresh backup** of the 18 database exists and has been copied off the
  server (admin export, or the `pg_dump -Fc` / `pg_dumpall` commands under
  "Backups of the 18 database" above);
- the backup was checked to be non-empty and readable (`pg_restore -l` lists
  its contents / the `.sql` ends with "PostgreSQL database cluster dump complete").

Then:

```bash
docker volume rm <project>_db-data        # e.g. oj_db-data; never the -18 volume
scripts/pg18-guard.sh -f docker-compose.yml -f docker-compose.production.yml   # still exit 0
```

Move or delete the old `backups/pg16-*` files according to your retention policy.
