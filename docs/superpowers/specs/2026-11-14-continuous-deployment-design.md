# Continuous deployment with a human gate — Design

Date: 2026-11-14
Status: draft, awaiting approval

## Intent

Deploying the OJ is a manual SSH session today: `git pull`, `./deploy.sh`,
then eyeball the result. The 2026-11-14 header-problems release showed what
that costs — the operator had to remember a backup (and got it wrong twice:
an uncompressed `pg_dumpall` grew past 8.6 GB on a 4.7 GB database and had to
be killed), then check by hand that migration 0024 had applied and the site
answered.

Replace that with a pipeline that **refuses to deploy unverified code, takes a
usable backup every time, and can put the previous release back quickly** —
while still requiring a person to say go.

## Goals

- A push to `main` builds and tests as today, then **waits for a human** to
  approve the deploy. Nothing reaches production without that click.
- The deploy runs **only if every CI job passed**, and deploys **exactly the
  commit CI tested**, not whatever `main` points at by then.
- Every deploy is preceded by a **compressed database backup** that is verified
  readable; a failed backup aborts the deploy before anything changes.
- A deploy that does not come up healthy **rolls the previous release back
  automatically**, within about a minute, and reports failure loudly.
- Refuse to deploy while a **contest is running**, and wait for the judge
  queue to drain before restarting, since a restart turns in-flight
  submissions into System Error.
- The operator can still deploy by hand exactly as today; the pipeline is an
  addition, not a replacement.

## Non-goals

- Automatic database rollback. Migrations are additive and non-destructive by
  design, so the previous release runs against the newer schema. Restoring a
  dump loses every submission since it was taken — that stays a human decision
  made with the runbook, not something a workflow does at 2am.
- Deploying anything but `main` to production, or a staging environment.
- Zero-downtime deploys. The stack restarts; the gap is seconds and the
  contest guard covers the case where that matters.
- Replacing `deploy.sh`. The pipeline calls it; its guards (PG18, health,
  nginx config test, HTTPS probe) stay the source of truth for "did it come
  up".
- Secret rotation, alerting/paging, and deploy notifications to chat.

## Anti-goals

- A pipeline that deploys while CI is red, or that treats "the job finished"
  as "the site works".
- A backup step so slow or so large that the operator is tempted to skip it —
  this is what actually happened on 2026-11-14.
- A rollback path that has never been executed before the night it is needed.
- Holding credentials in the repository, or in a runner that strangers can
  reach. **The repository is public**, so anything a fork's workflow can read
  is public.

## Constraints (verified, not assumed)

- **The server is reachable only over Tailscale** (`100.64.111.112`,
  hostname `oj-server`); the site itself is published through a Cloudflare
  tunnel. GitHub-hosted runners therefore need to join the tailnet.
- **The repository is public.** Self-hosted runners are ruled out: a fork's
  pull request can run code on them. Environment secrets are the right home
  for credentials, since they are released only to an approved job.
- Environment protection rules (required reviewers) are available and
  **already configured**: environment `production`, reviewers `Nonbangkok` and
  `DraSoGo`, deployment branches limited to `main`, five secrets present
  (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `TS_OAUTH_CLIENT_ID`,
  `TS_OAUTH_SECRET`).
- A Tailscale OAuth credential scoped to `auth_keys: write` and tagged
  `tag:ci` exists; the policy file declares `tag:ci` and the host `oj-server`,
  and grants `tag:ci` → `oj-server:tcp:22`.
- The deploy SSH key is installed on the server with the `restrict` option
  (no port/agent forwarding, no PTY) and is verified able to reach the repo
  checkout and the Docker socket.
- The production checkout is `/srv/docker/apps/OJ`, on `main`, with untracked
  working files (`artifacts/`, `output/`, …) that a pull must not disturb.
- `deploy.sh` already runs `scripts/pg18-guard.sh`, builds, starts, reloads
  nginx and polls health for 180 s, and exits non-zero on failure.
- **Only `oj-backend` currently carries an explicit image tag**
  (`image: oj-backend:${OJ_IMAGE_TAG:-local}`). `frontend` and
  `authoring-runner` are built as implicit project images and are overwritten
  on every build, so today there is nothing to roll back to. The 2026-11-13
  bug log already records one incident caused by shared image tags.
- The database is ~4.7 GB; `pg_dumpall` in plain SQL exceeded 8.6 GB and ran
  for many minutes. Disk is 96 GB with ~51 GB free.
- The backend runs migrations at start (`npm start` → `migrate.js`), so a
  deploy applies schema changes implicitly.

## Approaches considered

- **A. GitHub Actions joins the tailnet and runs the deploy over SSH
  (chosen).** The approval gate, the logs and the history live in GitHub where
  the operator already is. Costs: GitHub holds two credentials that can reach
  the server, and the tailnet ACL must admit an ephemeral node.
- **B. A self-hosted runner on the server.** No inbound access and no
  credentials in GitHub. **Rejected outright**: on a public repository a fork's
  PR can execute on the runner, which is the production box.
- **C. A pull-based agent on the server** polling for a new tag and deploying
  itself. Strongest isolation, no credentials shared at all. Rejected because
  the approval becomes "someone pushed a tag" with no record of who approved
  what, no live log, and no obvious place to see a failure — which works
  against the point of asking for a human gate.

User picked A.

## Design

### The workflow

A **separate** `.github/workflows/deploy.yml`, triggered by the CI workflow
finishing:

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' ||
        github.event.workflow_run.conclusion == 'success'
    environment: production        # ← the human gate lives here
    runs-on: ubuntu-latest
    concurrency: { group: deploy-production, cancel-in-progress: false }
```

A second workflow rather than a job inside `ci.yml` — **the user chose this**
after the review surfaced the cost of the simpler shape. `ci.yml` has a
workflow-level `concurrency` with `cancel-in-progress: false`, so a job parked
on an approval keeps that run "in progress" and the next push to `main` gets
no CI at all until someone clears the gate. This repository pushes docs and
problem content to `main` often; every one of those would raise a deploy
approval and stall the queue behind it. Splitting the workflows keeps CI
answering on every push, while the deploy still waits for a person.

- `workflow_run` + `conclusion == 'success'` is the CI gate: a red CI run
  never produces a deploy.
- `environment: production` makes the job wait for a reviewer and only then
  releases the secrets.
- The SHA to deploy is `github.event.workflow_run.head_sha` — the commit CI
  actually tested, not whatever `main` points at after approval.
- `concurrency` without `cancel-in-progress` queues two merges rather than
  racing them; a half-finished deploy is never cancelled mid-flight.
- `workflow_dispatch` takes an optional `sha` input, defaulting to the current
  `main`, for redeploys and for deploying a commit whose approval expired.

Steps: join the tailnet with `tailscale/github-action` (ephemeral,
`tags: tag:ci`), write `DEPLOY_SSH_KEY` to a file, then a single SSH command
that runs `scripts/cd-deploy.sh <sha>` on the server and streams its output.
The deploy logic lives in the repository, not in YAML, so it can be read,
reviewed and run by hand.

### `scripts/cd-deploy.sh <commit-sha>`

Runs on the server, `set -euo pipefail`, every step logged with a timestamp.

1. **Preflight.** Refuse (exit non-zero, nothing changed) when:
   - a contest is `running` or `finishing` — one SQL query against the live
     database. An `ALLOW_DURING_CONTEST=1` escape hatch exists for the operator
     running the script by hand, never set by the workflow;
   - **the judge queue is busy.** A restart turns every `Compiling`/`Running`
     submission into a System Error ("interrupted by a server restart"), which
     the contest guard does not cover for ordinary practice. So: poll for rows
     in those states and wait for them to clear, up to a bounded window
     (minutes, not hours). If the queue drains, continue; if the window
     expires, abort without touching anything and say how many submissions
     were still in flight. **The user chose waiting over deploying anyway.**
     Aborting is deliberate — a deploy that silently breaks someone's verdict
     after a long wait is the outcome this guard exists to prevent;
   - free disk is below a threshold that leaves room for a backup plus the new
     images;
   - the working tree has modifications to **tracked** files (untracked files
     are expected and ignored);
   - the requested SHA is not an ancestor of `origin/main` after fetch.
2. **Backup.** `pg_dump -Fc` (custom format, compressed) of the application
   database into `backups/pre-deploy-<sha>-<ts>.dump`, verified by listing its
   table of contents (`pg_restore -l`), then prune to the newest 3. A failure
   or an unreadable dump aborts here. Deliberately `pg_dump`, not
   `pg_dumpall`: roles and the session table are not what a rollback needs,
   and the plain-SQL cluster dump is what blew up on 2026-11-14.
3. **Record the current release.** The running `OJ_IMAGE_TAG` and commit SHA
   are written to `.last-release` so step 6 can find them.
4. **Check out the tested commit.** `git fetch origin` then
   `git checkout --detach <sha>`. Detached HEAD is deliberate: production
   tracks a commit, not a moving branch.
5. **Deploy.** `OJ_IMAGE_TAG=<short-sha> ./deploy.sh`. The tag makes this
   release's images distinct from the previous one — the prerequisite for
   step 6 — and `deploy.sh`'s own health gate decides success.
6. **Verify, then roll back on failure.** Beyond `deploy.sh`'s checks:
   `/api/health/ready` returns ready over loopback, and the newest migration
   in `schema_migrations` matches the one shipped in the image.

   Rollback **restores the tree as well as the images**: `git checkout
   --detach <previous-sha>` and bring compose up with the previous
   `OJ_IMAGE_TAG`, without rebuilding. Images alone are not enough —
   `nginx-proxy/*.conf` is a bind mount, and `docker-compose*.yml`,
   `deploy.sh` and `scripts/pg18-guard.sh` all come from the working tree, so
   a tag-only rollback would run the old images against the new release's
   configuration: a combination nothing has ever tested.

   Then re-verify, and exit non-zero with a message stating plainly that the
   deploy failed and whether the rollback succeeded. **The database is never
   restored automatically.**

   **When there is no rollback target** — the first CD deploy, or any deploy
   after a manual `./deploy.sh` (which builds `:local` and overwrites it) —
   the script says so up front and proceeds without one. It does not try to
   make `deploy.sh` tag by SHA; keeping manual deploys working exactly as
   today is a stated non-goal of changing them.
7. **Prune.** Keep the previous release's images; delete older `oj-*` tags by
   name. Never `docker image prune -a`: the box also runs `dozzle-agent`,
   `portainer-agent` and `beszel-agent` on the same daemon, and a blanket
   prune would take their images too.

### Verifying from outside

`deploy.sh` probes HTTPS with `--resolve …:127.0.0.1`, which deliberately
bypasses the Cloudflare tunnel. The workflow additionally fetches the public
URL from the GitHub runner after a successful deploy — that is the only check
that exercises DNS and the tunnel.

A failure there is reported as a **warning, not a rollback trigger**. Cloudflare
or DNS breaking is not the release's fault and rolling back would not fix it;
reverting a good release because an edge network hiccuped is worse than
telling the operator to look.

### Making rollback possible

`frontend` and `authoring-runner` need explicit, tagged image names in
`docker-compose.yml`, mirroring `oj-backend`:

```yaml
image: oj-frontend:${OJ_IMAGE_TAG:-local}
image: oj-authoring-runner:${OJ_IMAGE_TAG:-local}
```

Without this, a rollback silently reuses the new frontend — the exact class of
bug recorded in the 2026-11-13 log. The default `local` keeps every existing
local and CI workflow working unchanged.

### Proving the rollback works

A rollback that has never run is a hope. Before this is called done, the
builder stages a deliberate failure and confirms the previous release comes
back.

The rehearsal does **not** go through `deploy.sh`: that script is bound to
`nonbangkokgrader.com`, the Let's Encrypt certificate, ports 80/443 and the
Cloudflare tunnel token, so a second copy cannot run beside the live stack.
What must be proven is the rollback *mechanism* — that tag A is running, a
deploy of tag B fails its health check, and the script restores tag A's images
**and** tag A's working tree. That is reproducible on a throwaway compose
project with its own name, ports and volumes, using the local overlay rather
than the production one.

The HTTPS-through-Cloudflare path is not part of the rehearsal; it is a
warning-only check anyway (above), and the first real deploy exercises it.

## Security notes

- Secrets are **environment** secrets, released only after approval; a fork's
  workflow cannot read them, and `pull_request` never reaches this job.
- The Tailscale credential can mint auth keys for `tag:ci` only, and the ACL
  lets that tag reach `oj-server:22` and nothing else.
- The SSH key carries `restrict`. Narrowing it further to a forced command
  (`command="scripts/cd-deploy.sh"`) is desirable once the script is stable;
  it is left out of the first version because it also blocks the operator's
  own use of that key for diagnosis.
- The workflow never echoes secrets; SSH host key checking uses a pinned
  `known_hosts` entry rather than `StrictHostKeyChecking=no`.

## Calls made after review (designer's calls, user may override)

The builder check raised seven questions. The user answered two (the separate
workflow, and waiting for the judge queue); these five are mine:

1. **Rollback restores the working tree too**, not just image tags — the
   config that defines the stack lives in the tree.
2. **No rollback target is a warning, not an error.** The first deploy and any
   deploy after a manual `./deploy.sh` proceed without one. `deploy.sh` is not
   changed to tag by SHA.
3. **The public-URL check is warning-only**; only loopback health and the
   migration check can trigger a rollback.
4. **The rollback rehearsal skips `deploy.sh`** and proves the mechanism on a
   throwaway compose project.
5. **Pruning enumerates `oj-*` tags**; no blanket prune, because three other
   agents share the daemon (verified on the box).

## What's left to the builder

- Exact step layout within the job, and which Tailscale action version to pin.
- Disk threshold, backup retention count, health-check and queue-drain
  timeouts.
- The precise SQL for the contest and judge-queue checks, and whether to reuse
  an existing service/endpoint instead.
- Whether `.last-release` lives in the checkout or alongside `backups/`.
