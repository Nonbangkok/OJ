# Runbook: continuous deployment (production)

A green push to `main` can be deployed to production by approving a single
button in GitHub. This runbook is for the person approving and the person
debugging a failed run. Design background:
[docs/superpowers/specs/2026-11-14-continuous-deployment-design.md](../superpowers/specs/2026-11-14-continuous-deployment-design.md).

> **Rollback rehearsal on the production host: NOT YET DONE.** See
> [the rehearsal section](#rollback-rehearsal-on-the-production-host-not-yet-done).
> Until it is filled in, the rollback path has only run in the local test
> suite, never on the machine it protects.

## Before the first deploy (operator prerequisites)

Both of these are still outstanding. Do them before expecting a deploy to work.

1. **Pin the server's SSH host key.** `.github/deploy-known-hosts` is committed
   with comments only, so **every deploy fails closed (before connecting) until
   a key line is added.** On the production server, over a channel you trust:

   ```bash
   awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub
   ```

   Paste the output (`ssh-ed25519 AAAA...`, one line per key, no host column)
   below the comments in `.github/deploy-known-hosts`, and merge it to `main`.
2. **Expect the first CI run of `shellcheck scripts/cd-deploy.sh` to be its first
   real run.** shellcheck was never run against the script locally, so the first
   push after this lands may fail that CI step on findings. Fix those first; a
   red CI run never reaches the deploy workflow.

The GitHub side must also exist: the `production` environment with required
reviewers, the `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_HOST`,
`DEPLOY_USER` and `DEPLOY_SSH_KEY` secrets, and the Tailscale `tag:ci`. The
workflow references them by those names.

## How a deploy happens

1. A push to `main` runs the `CI` workflow.
2. When CI is green, `.github/workflows/deploy.yml` starts. Its one `deploy`
   job uses the `production` environment, which has **required reviewers**, so
   it waits for approval. The job only runs for a successful CI run of a
   `push` to `main` in this repository (a fork's pull request cannot reach the
   approval prompt).
3. After approval the job joins the tailnet, writes the deploy key, pins the
   host key from `.github/deploy-known-hosts`, and runs one command over SSH:
   `scripts/cd-deploy.sh <sha>` in `/srv/docker/apps/OJ` on the server. `<sha>`
   is the commit CI tested (`workflow_run.head_sha`), not whatever `main` points
   at after you approve.
4. A last `curl` of the public URL only warns; it cannot fail the job.

`scripts/cd-deploy.sh` runs, in order: guards, backup, record the rollback
target, checkout, deploy, verify, roll back on failure, prune old images.
`deploy.sh` is still what actually builds and starts the stack, and what you run
for a hand deploy; `cd-deploy.sh` wraps it with guards, a database backup and an
automatic rollback. The script's header documents every environment variable.

## Approving a deploy

1. Open the **Deploy** run in the repository's Actions tab. It shows as waiting
   on the `production` environment.
2. Check that the commit is the one you mean to ship and that no contest is
   running (a running or finishing contest makes the deploy refuse, exit 10).
3. **Review deployments**, tick `production`, approve. Reject to skip it.
4. Watch the "Run scripts/cd-deploy.sh on the server" step. The first line of
   its output is the path of the run log on the server.

Deploys share one concurrency group and never cancel a running one. At most one
waits behind it: GitHub keeps a single pending run, so a third approval cancels
the second.

## A deploy failed: what now

Read the exit code in the red step's `::error::` line, then use the table. The
guards (10-14) and the backup failure (20) all refuse **before changing
anything**: production is exactly as it was.

| Exit | Meaning | State of production | What to do |
|---|---|---|---|
| 0 | Deployed | New release live | Nothing |
| 1 | Usage error, a database/internal failure (fails closed), or the run log could not be written | Unchanged | Read the message; fix the cause (database container down, an invalid `CD_*` value, disk full) and re-run |
| 10 | A contest is running or finishing | Unchanged | Re-run after it ends. Operator override, only by running the script by hand on the server (the workflow passes no environment): `ALLOW_DURING_CONTEST=1 scripts/cd-deploy.sh <sha>`. It restarts the stack under people being graded; only with a good reason |
| 11 | The judge queue did not drain: submissions still Compiling/Running after `CD_QUEUE_WAIT_SECONDS` (default 300) | Unchanged | Re-run in a quiet moment; a restart would turn those into System Errors |
| 12 | Free disk below `CD_MIN_FREE_GB` (default 5) | Unchanged | Free space, re-run |
| 13 | The production tree has modified **tracked** files | Unchanged | `git -C /srv/docker/apps/OJ status`; commit, revert or stash the edit on the server, re-run. Untracked files (`.env`, `backups/`) are fine |
| 14 | The SHA is not an ancestor of `origin/main` | Unchanged | The commit is not on `main` (for instance it was force-pushed away); deploy one that is. (A failed `git fetch` is not 14: it exits 1) |
| 20 | The backup failed or could not be verified (`pg_dump` error or timeout, or `pg_restore -l` could not read it) | Unchanged | Check the database container and disk; re-run. The script never deploys without a backup |
| 21 | The deploy failed **and was rolled back** | Previous release running again and re-verified; database not restored | Read the run log to see why it failed, fix on `main`, redeploy |
| 22 | The deploy failed **and the rollback also failed** | **May be down or on a broken release. Needs hands now** | See "Rollback failed" below |

Exit **255** is SSH itself (network, host key mismatch, key rejected, or a
dropped connection), not the script. The script ignores `SIGHUP` and `SIGPIPE`
and writes its log straight to a file, so **a dropped SSH session leaves it
running to completion, rollback included.** (That covers a hangup only: a `SIGKILL` or an out-of-memory kill of the script itself is not survived.) The Actions run can show a failure
while the deploy actually succeeded or rolled back. Check the server before
doing anything:

```bash
cd /srv/docker/apps/OJ
ls -t backups/cd-deploy-*.log | head -n 1      # newest run log
tail -n 40 "$(ls -t backups/cd-deploy-*.log | head -n 1)"
```

The log is `backups/cd-deploy-<sha>-<timestamp>.log`; its last lines say
`DEPLOY OK`, `ROLLBACK OK` or `ROLLBACK FAILED`.

### Rollback failed (exit 22)

The log's last lines say what state the checkout is in and print the exact
restore command. The general shape (substitute the values the log prints; the
previous release is also in `.last-release`: line 1 image tag, line 2 commit):

```bash
cd /srv/docker/apps/OJ
git checkout --detach <previous-sha>
OJ_IMAGE_TAG=<previous-tag> docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --no-build
curl -fsS --resolve nonbangkokgrader.com:443:127.0.0.1 https://nonbangkokgrader.com/api/health/ready   # use your HTTPS_PORT from .env instead of 443 if it is set
```

If there was no rollback target (nothing was running before), fix forward or
restore a known-good commit with `./deploy.sh`. The database is **never
restored automatically**; the log names the pre-deploy backup.

## Backups, the rollback target, and rolling back by hand

- **Backup.** `backups/pre-deploy-<sha>-<timestamp>.dump`, a custom-format
  `pg_dump` (`-Fc`), verified with `pg_restore -l`, capped by a wall-clock
  timeout (`CD_BACKUP_TIMEOUT_SECONDS`, default 1800). The newest
  `CD_BACKUP_KEEP` (default 3) are kept. `backups/` is git-ignored.
- **Rollback target.** Recorded from live state before the checkout: the tag the
  backend container runs and the checked-out `HEAD`, written to `.last-release`.
  Immediately before the deploy the three images (`oj-backend`, `oj-frontend`,
  `oj-authoring-runner`) are also tagged `:cd-rollback`. A rollback restores the
  tree, then the images from that snapshot, brings the stack up without building,
  and re-verifies readiness (`/api/health/ready`) and migrations.
- **Rolling back a release that verified but is wrong:** deploy the previous
  good commit through the normal flow (merge a revert to `main`), or on the
  server run `scripts/cd-deploy.sh <good-sha>` for a SHA that is on
  `origin/main`. That takes a fresh backup and keeps the guards. The command in
  "Rollback failed" is the emergency version, with no checks.

### Restoring a database backup

> **Restoring a dump loses every submission (and every other write) made since
> the dump was taken.** The deploy takes its dump immediately before the
> release, so for the newest dump that is the time since the deploy started; an
> older dump loses more. Only restore when the data itself is damaged (for
> example by a bad migration), not because the code was wrong: a code rollback
> does not need it.

Migrations only move forward, so a release that ran a bad migration needs both
the previous images and the matching dump. Outline (not rehearsed; check each
step on a real incident):

```bash
cd /srv/docker/apps/OJ
P="-f docker-compose.yml -f docker-compose.production.yml"   # the production pair; plain `docker compose` would not see this stack's overlay
# 1. Find the database container.
docker compose $P ps --format '{{.Name}}' database
# 2. Stop the database's clients (the backend; the one-shot migrate service
#    only runs at deploy time). The authoring runner has no network.
docker compose $P stop backend
# 3. Restore. POSTGRES_USER / POSTGRES_DB are read INSIDE the container, where
#    they are set, so nothing depends on your shell's environment.
docker exec -i <database-container> sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction' \
  < backups/pre-deploy-<sha>-<timestamp>.dump
```

Any other session still connected to the database (a `psql` left open, say)
can make `--clean` wait on a lock; find and close it rather than waiting it out.
If `pg_restore` aborts for any reason, `--single-transaction` leaves the database
exactly as it was, so you can fix the cause and run it again.

Then start the previous release with the "Rollback failed" commands above.
**Do not take the values from `.last-release` in this scenario:** the release
that ran the bad migration verified, so `.last-release` has already been
overwritten with the NEW tag and commit. Get the previous values from the
previous deploy's run log (`ls -t backups/cd-deploy-*.log`, the "rollback
target:" line) or from `git log`; the previous tag is the first
twelve characters of the previous commit (or `local` if that release was built
by hand).

## Rollback rehearsal on the production host: NOT YET DONE

> **PLACEHOLDER. THIS REHEARSAL HAS NOT BEEN RUN.**
>
> The plan: on the production host, clone the checkout to a temp directory,
> start a throwaway compose project with image tag `aaa`, run `cd-deploy.sh`
> for a tag whose deploy command fails, and confirm the previous images and
> tree return. The real transcript goes **below this line**.
>
> Until it is pasted here, **the rollback path has not been exercised on the
> machine it protects.** The local test suite has exercised it; that is not
> the same thing. Do not treat rollback as proven.

```text
(transcript of the production-host rehearsal goes here)
```
