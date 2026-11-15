# Runbook: continuous deployment (production)

A green push to `main` can be deployed to production by approving a single
button in GitHub. This runbook is for the person approving and the person
debugging a failed run. Design background:
[docs/superpowers/specs/2026-11-14-continuous-deployment-design.md](../superpowers/specs/2026-11-14-continuous-deployment-design.md).

> **Status.** Live since 2026-11-15 (first CD deploy: `801739d`). The rollback
> path was rehearsed **on the production host** the same day and passed: see
> [the rehearsal](#rollback-rehearsal-on-the-production-host-2026-11-15-passed).
> A deploy takes about 11 minutes, about 9 of them the pre-deploy `pg_dump`
> (~3 GB at the time).

## One-time setup

All of this was done on 2026-11-15. Redo it when the server is rebuilt, a
credential is rotated, or the tailnet changes. Each step names the failure it
prevents, because every one of them was hit at least once on the first deploy.

1. **Pin the server's SSH host key.** `.github/deploy-known-hosts` holds
   `<keytype> <base64>` lines (no host column); with no key line **every deploy
   fails closed before connecting.** The safest source is a machine that has
   already connected to the server, since its key was verified then:

   ```bash
   ssh-keygen -F <server-tailnet-ip>      # take the ssh-ed25519 line, drop the host column
   ```

   or, on the server itself: `awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub`.
   (That command only works **on the server**; `/etc/ssh/ssh_host_*` on a Mac is
   the Mac's own key, or absent.)
2. **Create the Tailscale OAuth client in the tailnet that actually contains the
   server.** An account can belong to more than one tailnet, and a client made in
   the wrong one joins fine and then cannot see the server at all: the run says
   `ssh: connect to host *** port 22: Connection timed out`, and the reachability
   step fails in milliseconds. Before creating anything, open **Machines** and
   check `oj-server` is listed there (on the server, `tailscale status --json |
   jq -r .CurrentTailnet.Name` prints the tailnet it is in). A `hosts` entry in
   the policy file proves nothing: it is an alias anyone can type. In **that**
   tailnet:
   - add `"tagOwners": { "tag:ci": ["autogroup:admin"] }` to the policy file and
     **Save** (the Tags field of the next step does not appear until the tag
     exists);
   - generate the OAuth client (Settings → Keys, or Trust credentials), tick
     **Auth Keys → Write** only (the **Tags** field appears only after that
     tick), and choose `tag:ci`;
   - set `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` in the `production`
     environment. A wrong pair fails at "Join the tailnet" with
     `oauth2: cannot fetch token: 401 Unauthorized` / `API token invalid`.
3. **Upload the deploy key from its file; never paste it.** A pasted key fails
   with `Load key ".../deploy_key": error in libcrypto` followed by
   `Permission denied (publickey)`. From the machine that holds it:

   ```bash
   gh secret set DEPLOY_SSH_KEY --env production --repo Nonbangkok/OJ < ~/.ssh/oj-deploy
   ```

   Its public half must be in the deploy user's `~/.ssh/authorized_keys` on the
   server; compare fingerprints with `ssh-keygen -lf` on both ends.
4. **Bring the server's checkout to the merge commit by hand, once.** The
   workflow runs `scripts/cd-deploy.sh` *from the checkout as it stands* — the
   last deployed release, which predates this branch and has no such file, so the
   first approved deploy would exit 127. On the server, with no contest running:

   ```bash
   cd /srv/docker/apps/OJ
   git status                       # must be clean (tracked files); .env and backups/ are fine
   git fetch origin main
   git checkout --detach origin/main
   ls -l scripts/cd-deploy.sh       # must be executable (-rwxr-xr-x)
   ./deploy.sh                      # the ordinary hand deploy, so the running release matches the tree
   ```

   The general rule, from then on: **a change to `cd-deploy.sh` always takes
   effect on the deploy *after* the one that ships it** — the deploy that ships
   it runs the previous version of the script. Treat a change to it like a change
   to the deploy mechanism, not to the app.
5. **Make sure all three images carry the `:local` tag, then prove the first
   deploy is rollbackable.** The rollback target is the tag the *backend*
   container runs (`local` after a hand deploy); the snapshot needs **all three**
   of `oj-backend:local`, `oj-frontend:local` and `oj-authoring-runner:local`. On
   this box the frontend and authoring-runner images were once built with no tag
   at all (`oj-frontend:latest`), so `oj-frontend:local` did not exist — and a
   first deploy that failed **could not have been rolled back** (exit 22).
   Step 4's `./deploy.sh` normally creates all three (compose names them
   `oj-<service>:${OJ_IMAGE_TAG:-local}`); check, and tag whatever is missing:

   ```bash
   docker image ls 'oj-*'                                        # each of the three must show :local
   docker tag oj-frontend:latest oj-frontend:local               # only if :local is missing
   docker tag oj-authoring-runner:latest oj-authoring-runner:local
   ```

   Then confirm it, without deploying anything:

   ```bash
   cd /srv/docker/apps/OJ && CD_DRY_RUN=1 scripts/cd-deploy.sh "$(git rev-parse origin/main)"
   ```

   The last lines must say `a failed deploy COULD be rolled back`. If they say
   `COULD NOT BE ROLLED BACK` they name the missing images; fix those and run it
   again. A dry run runs the guards, records the rollback target and snapshots
   it; the only state it creates is the `:cd-rollback` image tags and
   `.last-release`.

The GitHub side: the `production` environment with required reviewers, and the
`TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_HOST` (the server's tailnet
address), `DEPLOY_USER` and `DEPLOY_SSH_KEY` environment secrets. The workflow
references them by those names.

Two things that look like suspects and are not, on this host: **ufw** does not
govern tailnet traffic (tailscaled runs with netfilter mode on and accepts
`tailscale0` traffic before ufw's chains), so do not add ufw rules for tailnet
SSH; and the server has **no direct path** from outside its LAN, so every peer
reaches it through a DERP relay. That is normal and works; it is why the
reachability check uses `tailscale ping --until-direct=false` (plain `tailscale
ping` exits 1 on a relay-only path even when the pong comes back).

## How a deploy happens

1. A push to `main` runs the `CI` workflow.
2. When CI is green, `.github/workflows/deploy.yml` starts. Its one `deploy`
   job uses the `production` environment, which has **required reviewers**, so
   it waits for approval. The job only runs for a successful CI run of a
   `push` to `main` in this repository (a fork's pull request cannot reach the
   approval prompt).
3. After approval the job joins the tailnet, writes the deploy key, pins the
   host key from `.github/deploy-known-hosts`, and checks the server answers
   over the tailnet (polling up to a minute). If it does not, a **Diagnose the
   tailnet path** step prints the netmap facts and the verbatim ping result —
   aggregates and scrubbed text only, since the repository is public. Then it
   runs one command over SSH: `scripts/cd-deploy.sh <sha>` in
   `/srv/docker/apps/OJ` on the server. `<sha>` is the commit CI tested
   (`workflow_run.head_sha`), not whatever `main` points at after you approve.
4. A last `curl` of the public URL only warns; it cannot fail the job.

`scripts/cd-deploy.sh` runs, in order: take the host lock, guards, record and
snapshot the rollback target, backup, re-check the judge queue, checkout, deploy,
verify, roll back on failure, prune old images.
`deploy.sh` is still what actually builds and starts the stack, and what you run
for a hand deploy; `cd-deploy.sh` wraps it with guards, a database backup and an
automatic rollback. The script's header documents every environment variable.

When a release changes `nginx-proxy/production.conf`, `deploy.sh` **recreates**
the `nginx-proxy` container (a second or two in which connections drop) instead
of reloading it, through `scripts/refresh-proxy.sh`: the file is a single-file
bind mount, `git checkout` gives a changed file a new inode, and a reload would
re-read the stale one. When the file is unchanged it still does the graceful
`nginx -s reload`, which also picks up renewed certificates.

The workflow passes **no** environment, so every `CD_*` variable keeps its
default; in particular **production leaves `CD_DOCKER_ROOT_DIR` unset** so the
disk guard asks `docker info` where Docker's data root actually is. Do not export
it on the server (nor put it in a shell profile): a stale value would make the
guard measure the wrong filesystem and pass while the real one is full.

Runs are serialized on the host by `flock` on `backups/.cd-deploy.lock`, so an
operator running the script by hand cannot collide with a run left behind by a
cancelled Actions job (the second one exits 1, changing nothing).

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
guards (10-14) and the backup failure (20) all refuse **before anything is
deployed**: production is exactly as it was. (A refusal can leave three traces,
none of which touch what is running: the run log, `.last-release` rewritten from
live state, and the `:cd-rollback` snapshot tags.)

| Exit | Meaning | State of production | What to do |
|---|---|---|---|
| 0 | Deployed | New release live | Nothing |
| 1 | Usage error, a database/internal failure (fails closed), the run log could not be written, or **another `cd-deploy` is already running on the host** | Unchanged | Read the message; fix the cause (database container down, an invalid `CD_*` value, disk full) and re-run. For the lock: wait for the other run (the newest `backups/cd-deploy-*.log` says what it is doing); runs are serialized on `backups/.cd-deploy.lock`, which also catches a run left behind by a cancelled Actions job |
| 10 | A contest is running or finishing | Unchanged | Re-run after it ends. Operator override, only by running the script by hand on the server (the workflow passes no environment): `ALLOW_DURING_CONTEST=1 scripts/cd-deploy.sh <sha>`. It restarts the stack under people being graded; only with a good reason |
| 11 | The judge queue did not drain: submissions still Compiling/Running after `CD_QUEUE_WAIT_SECONDS` (default 300). Checked twice: in the guards, and again after the backup (which can take minutes), still before the checkout | Unchanged | Re-run in a quiet moment; a restart would turn those into System Errors |
| 12 | Free disk below `CD_MIN_FREE_GB` (default 5) | Unchanged | Free space, re-run |
| 13 | The production tree has modified **tracked** files | Unchanged | `git -C /srv/docker/apps/OJ status`; commit, revert or stash the edit on the server, re-run. Untracked files (`.env`, `backups/`) are fine |
| 14 | The SHA is not an ancestor of `origin/main` | Unchanged | The commit is not on `main` (for instance it was force-pushed away); deploy one that is. (A failed `git fetch` is not 14: it exits 1) |
| 20 | The backup failed or could not be verified (`pg_dump` error or timeout, or `pg_restore -l` could not read it) | Unchanged | Check the database container and disk; re-run. The script never deploys without a backup |
| 21 | The deploy failed **and was rolled back** | Previous release running again and re-verified; database not restored | Read the run log to see why it failed, fix on `main`, redeploy |
| 22 | The deploy failed **and the rollback also failed** | **May be down or on a broken release. Needs hands now** | See "Rollback failed" below |

A run that fails **before** the deploy step never reached the server, and
production is untouched. The ones seen on the first deploy:

| Failing step and message | Cause | Fix |
|---|---|---|
| Join the tailnet: `oauth2: cannot fetch token: 401 Unauthorized`, `API token invalid` | The OAuth client ID/secret pair is wrong, or is not an OAuth client | One-time setup step 2: regenerate it, set both secrets |
| Reachability check fails in milliseconds; or the deploy step says `connect to host *** port 22: Connection timed out` | The OAuth client belongs to a tailnet the server is not in | One-time setup step 2: create it in the tailnet whose **Machines** list shows `oj-server` |
| Reachability check fails after a minute; Diagnose shows `target_online` false or no pong | The server is offline in the tailnet, or the path is genuinely down | Check `oj-server` in the Tailscale console; `tailscale status` on the server |
| Deploy step: `Load key ".../deploy_key": error in libcrypto`, `Permission denied (publickey)` | `DEPLOY_SSH_KEY` holds a mangled copy of the key | One-time setup step 3: upload it from the file |

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
P="-f docker-compose.yml -f docker-compose.production.yml"
git checkout --detach <previous-sha>
OJ_IMAGE_TAG=<previous-tag> docker compose $P up -d --no-build
# nginx-proxy's compose spec is the same in every release, so `up -d` neither
# recreates nor reloads it: without this it keeps serving the FAILED release's
# nginx-proxy/production.conf. Recreating it (rather than `nginx -s reload`) is
# deliberate: the config is a bind-mounted FILE, and the checkout above gave that
# path a new inode, so the old container's mount may not see the restored file at
# all (`nginx -t` then fails with "No such file or directory").
docker compose $P up -d --no-build --no-deps --force-recreate nginx-proxy
curl -fsS --resolve nonbangkokgrader.com:443:127.0.0.1 https://nonbangkokgrader.com/api/health/ready   # use your HTTPS_PORT from .env instead of 443 if it is set
```

If the loopback check above passes but the public URL does not answer, restart
the tunnel so it reconnects to the new proxy container:
`docker compose $P restart cloudflared`.

If there was no rollback target (nothing was running before), fix forward or
restore a known-good commit with `./deploy.sh`. The database is **never
restored automatically**; the log names the pre-deploy backup.

## Backups, the rollback target, and rolling back by hand

- **Backup.** `backups/pre-deploy-<sha>-<timestamp>.dump`, a custom-format
  `pg_dump` (`-Fc`), verified with `pg_restore -l`, capped by a wall-clock
  timeout (`CD_BACKUP_TIMEOUT_SECONDS`, default 1800). The newest
  `CD_BACKUP_KEEP` (default 3) are kept. `backups/` is git-ignored.
- **Rollback target.** Recorded from live state before the deploy: the tag the
  backend container runs and the checked-out `HEAD`, written to `.last-release`.
  The three images (`oj-backend`, `oj-frontend`, `oj-authoring-runner`) are also
  tagged `:cd-rollback` then. **If any of the three cannot be tagged, the log
  says `THIS DEPLOY CANNOT BE ROLLED BACK` and names the missing images**; the
  deploy still goes ahead (fixing forward may be the only way out), but a failure
  will end at exit 22. `CD_DRY_RUN=1` reports that without deploying — see
  one-time setup step 5. A rollback restores the image tags from the snapshot, then the
  tree, brings the stack up without building, recreates `nginx-proxy` so it stops
  serving the failed release's configuration, re-verifies readiness
  (`/api/health/ready`) and migrations, and finally prunes the failed release's
  images (so repeated failures cannot fill the disk into exit 12).
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
overwritten with the NEW tag and commit. Take them from the **newest** run log
(`ls -t backups/cd-deploy-*.log | head -n 1`) — the bad deploy's own log, whose
`rollback target:` line names the release it replaced, which is the one that
matches that deploy's dump. An older log names a release further back, which
would not match the dump you are restoring. (If you need them another way: the
tag is the first twelve characters of the previous commit, or `local` if that
release was built by hand.)

## Rollback rehearsal on the production host (2026-11-15): passed

The real `scripts/cd-deploy.sh`, run on `oj-server` itself by its own
`/bin/sh` (dash), against a throwaway environment that could not touch the live
site:

- a fresh clone of the repository from GitHub in `/tmp` (not the live checkout);
- a compose project `ojreh<random>` with no published ports and no shared
  volumes, three services standing in for backend / frontend / authoring-runner,
  and a stock nginx standing in for `nginx-proxy`;
- its own Postgres container for the guards, the backup and the migration check;
- image tags under that project's own prefix, two visibly different image sets
  (release A from `postgres:18-alpine`, release B from `nginx:1.30-alpine`),
  removed afterwards by untagging only.

Release A (`16e144e`, tag `aaa`) was running. The script was asked to deploy
release B (`801739d`) with a deploy command that **really brought release B
up** and then exited 1. The script had to notice and restore everything by
itself.

What it proved: exit **21**; the working tree back on release A; all three
services back on release A's images (compose had to *recreate* them, so release
B really had been running); `nginx-proxy` recreated; release B's tags pruned and
A's kept with the `:cd-rollback` snapshot. On the same host Docker and compose
versions, and under the same shell, as a real deploy. Afterwards the host held
no trace of it, and the live stack was untouched (same containers, same uptime,
`/api/health/ready` still `ready`).

```text
== host: oj-server  /bin/sh -> /usr/bin/dash  Docker Compose version 2.40.3+ds1-0ubuntu1~24.04.1
== project: ojreh0ada4c12   workdir: /tmp/cdreh.rMM3Yy
== release A = 16e144e6925ce3ef338f3f2f46f96b30e17cf2ac (tag aaa); release B = 801739dd6c311d3e1d22ee7764bd587c3a6e62c5 (tag 801739dd6c31)
== image A = 101873345701   image B = 583b7f2fce1c
== BEFORE: HEAD 16e144e6925c  backend=101873345701 frontend=101873345701 authoring-runner=101873345701
== running scripts/cd-deploy.sh 801739dd6c311d3e1d22ee7764bd587c3a6e62c5 (deploy command fails on purpose)
------------------------------------------------------------------------
2026-11-15T10:11:59 cd-deploy: log file: /tmp/cdreh.rMM3Yy/repo/backups/cd-deploy-801739dd6c31-20261115T101159.log
2026-11-15T10:12:00 cd-deploy: preflight ok for 801739dd6c311d3e1d22ee7764bd587c3a6e62c5
2026-11-15T10:12:00 cd-deploy: rollback target: tag aaa at 16e144e6925ce3ef338f3f2f46f96b30e17cf2ac (recorded in /tmp/cdreh.rMM3Yy/repo/.last-release)
2026-11-15T10:12:01 cd-deploy: backing up postgres to /tmp/cdreh.rMM3Yy/repo/backups/pre-deploy-801739dd6c31-20261115T101201.dump
2026-11-15T10:12:01 cd-deploy: backup verified: 5789 bytes
2026-11-15T10:12:01 cd-deploy: checking out 801739dd6c311d3e1d22ee7764bd587c3a6e62c5
2026-11-15T10:12:01 cd-deploy: deploying with OJ_IMAGE_TAG=801739dd6c31: ./rehearsal-stub-deploy.sh
rehearsal stub: release B is up on tag 801739dd6c31; failing on purpose
2026-11-15T10:12:28 cd-deploy: deploy command failed
2026-11-15T10:12:28 cd-deploy: DEPLOY FAILED for 801739dd6c311d3e1d22ee7764bd587c3a6e62c5
2026-11-15T10:12:28 cd-deploy: rolling back to tag aaa (16e144e6925ce3ef338f3f2f46f96b30e17cf2ac)
 Container ojreh0ada4c12-nginx-proxy-1  Running
 Container ojreh0ada4c12-backend-1  Recreate
 Container ojreh0ada4c12-authoring-runner-1  Recreate
 Container ojreh0ada4c12-frontend-1  Recreate
 Container ojreh0ada4c12-backend-1  Recreated
 Container ojreh0ada4c12-authoring-runner-1  Recreated
 Container ojreh0ada4c12-frontend-1  Recreated
 Container ojreh0ada4c12-authoring-runner-1  Starting
 Container ojreh0ada4c12-frontend-1  Starting
 Container ojreh0ada4c12-backend-1  Starting
 Container ojreh0ada4c12-backend-1  Started
 Container ojreh0ada4c12-authoring-runner-1  Started
 Container ojreh0ada4c12-frontend-1  Started
 Container ojreh0ada4c12-nginx-proxy-1  Recreate
 Container ojreh0ada4c12-nginx-proxy-1  Recreated
 Container ojreh0ada4c12-nginx-proxy-1  Starting
 Container ojreh0ada4c12-nginx-proxy-1  Started
2026-11-15T10:12:57 cd-deploy: nginx-proxy recreated onto the restored configuration
2026-11-15T10:12:57 cd-deploy: pruned image ojreh0ada4c12-backend:801739dd6c31
2026-11-15T10:12:57 cd-deploy: pruned image ojreh0ada4c12-frontend:801739dd6c31
2026-11-15T10:12:57 cd-deploy: pruned image ojreh0ada4c12-authoring-runner:801739dd6c31
2026-11-15T10:12:57 cd-deploy: ROLLBACK OK: tag aaa at 16e144e6925ce3ef338f3f2f46f96b30e17cf2ac is running again (the database was not restored)
2026-11-15T10:12:57 cd-deploy: Full log of this run on the server: /tmp/cdreh.rMM3Yy/repo/backups/cd-deploy-801739dd6c31-20261115T101159.log
------------------------------------------------------------------------
== exit code: 21 (21 = deploy failed and was rolled back)
== AFTER:  HEAD 16e144e6925c  backend=101873345701 frontend=101873345701 authoring-runner=101873345701
== proxy container: 2e1e72491ca2 -> ad6be383b02d
== .last-release: aaa 16e144e6925ce3ef338f3f2f46f96b30e17cf2ac
== image tags left: ojreh0ada4c12-authoring-runner:aaa ojreh0ada4c12-authoring-runner:cd-rollback ojreh0ada4c12-backend:aaa ojreh0ada4c12-backend:cd-rollback ojreh0ada4c12-frontend:aaa ojreh0ada4c12-frontend:cd-rollback
== REHEARSAL PASSED
== cleanup: removed project ojreh0ada4c12, its db container, its image tags and /tmp/cdreh.rMM3Yy
```

What it did **not** cover, by design: restoring a database dump (never automatic;
see above), and the real `deploy.sh` (bound to the live domain, certificate and
tunnel). The same rollback logic runs on every pull request in CI's `docker` job,
whose Ubuntu runner also uses dash as `/bin/sh`.
