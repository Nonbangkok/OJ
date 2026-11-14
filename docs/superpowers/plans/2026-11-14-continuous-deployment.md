# Continuous Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A push to `main` that passes CI waits for a human to approve, then deploys the tested commit to production with a verified backup first and an automatic rollback if it does not come up healthy.

**Architecture:** A second workflow (`deploy.yml`) triggered by `workflow_run` on CI success, gated by the `production` environment's required reviewers. It joins the tailnet, SSHes to the server and runs `scripts/cd-deploy.sh <sha>`, which holds all the logic: preflight guards, compressed backup, tagged build via the existing `deploy.sh`, verification, and rollback of both images and working tree.

**Tech Stack:** GitHub Actions (`workflow_run`, environments), `tailscale/github-action`, OpenSSH, POSIX shell, Docker Compose, `pg_dump -Fc`, `node --test` for the script's unit tests.

**Spec:** `docs/superpowers/specs/2026-11-14-continuous-deployment-design.md`

## Global Constraints

- The repository is **public**: no self-hosted runners; credentials live only as **environment** secrets of `production`.
- Already configured, do not re-create: environment `production` (reviewers `Nonbangkok`, `DraSoGo`; branches limited to `main`), secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`; Tailscale `tag:ci` + host `oj-server` in the ACL; the deploy key installed with `restrict`.
- Production checkout: `/srv/docker/apps/OJ`, user `drasogo`, host `100.64.111.112`, hostname `oj-server`.
- Deploy **exactly** `github.event.workflow_run.head_sha`; never `git pull`.
- **Never** change `deploy.sh`'s interface or its existing guards; `cd-deploy.sh` calls it.
- The database is never restored automatically. Rollback = previous images **and** previous working tree.
- Backups use `pg_dump -Fc` (not `pg_dumpall`, not plain SQL), are verified with `pg_restore -l`, and retain the newest 3.
- Pruning enumerates `oj-*` tags by name. **Never** `docker image prune -a`: `dozzle-agent`, `portainer-agent` and `beszel-agent` share the daemon.
- Public-URL (through Cloudflare) check is warning-only and never triggers rollback.
- Commits: conventional message, **no** `Co-Authored-By` trailer.

## Review Focus

1. A deploy requested for a SHA that is not an ancestor of `origin/main` (force-push, deleted branch) → refuse before touching anything, name the SHA.
2. Backup written but truncated or unreadable (disk fills mid-dump) → `pg_restore -l` fails, deploy aborts, partial file removed.
3. Rollback requested when the previous tag's images no longer exist (pruned, or manual `:local` deploy overwrote them) → say so explicitly rather than "rolling back" into a broken state.
4. Two deploys approved close together → the second waits; neither leaves a half-checked-out tree.
5. `.last-release` missing or corrupt on first run → treated as "no rollback target", deploy proceeds with a warning, never crashes on parse.

---

### Task 1: Tag every built image so a rollback has something to return to

**Files:**
- Modify: `docker-compose.yml` (the `frontend` and `authoring-runner` services)
- Test: `tests/composeConfig.test.mjs`

**Interfaces:**
- Produces: image names `oj-frontend:${OJ_IMAGE_TAG:-local}` and `oj-authoring-runner:${OJ_IMAGE_TAG:-local}`, matching the existing `oj-backend:${OJ_IMAGE_TAG:-local}`. Task 3 relies on all three resolving from one `OJ_IMAGE_TAG`.

- [ ] **Step 1: Write the failing test** in `tests/composeConfig.test.mjs`, in the existing config test:

```js
assert.equal(config.services.frontend.image, 'oj-frontend:local');
assert.equal(config.services['authoring-runner'].image, 'oj-authoring-runner:local');
assert.equal(config.services.backend.image, 'oj-backend:local');
```

- [ ] **Step 2: Run it** — `node --test tests/composeConfig.test.mjs`. Expected: FAIL, `frontend.image` is `undefined`.
- [ ] **Step 3: Add the `image:` lines** to the two services, in the same `${OJ_IMAGE_TAG:-local}` form the backend already uses.
- [ ] **Step 4: Run it** → PASS. Also run `docker compose --env-file .env.example config --quiet` and `OJ_IMAGE_TAG=t1 docker compose --env-file .env.example config --quiet` to confirm both resolve.
- [ ] **Step 5: Commit** — `build: tag frontend and authoring-runner images like the backend`

### Task 2: Preflight guards

**Files:**
- Create: `scripts/cd-deploy.sh` (guards only; later tasks extend it)
- Test: `tests/cdDeployGuards.test.mjs`

**Interfaces:**
- Produces: `scripts/cd-deploy.sh <commit-sha>`, POSIX `sh`, `set -eu`. Exit codes: `0` ok, `10` contest running, `11` judge queue busy, `12` low disk, `13` dirty tracked tree, `14` SHA not on `origin/main`. Honours `ALLOW_DURING_CONTEST=1`, `CD_MIN_FREE_GB`, `CD_QUEUE_WAIT_SECONDS`, `CD_DRY_RUN=1` (run guards, then exit 0 without deploying). Reads the database through `docker exec <db container> psql`, so the test can point it at a throwaway container.

- [ ] **Step 1: Write the failing tests** in `tests/cdDeployGuards.test.mjs`, following the throwaway-container style of `tests/pg18Guard.test.mjs` (random names, cleaned up in `after()`). Seed a Postgres container with a `contests` and a `submissions` table, then assert on exit codes with `CD_DRY_RUN=1`:
  - a row with `contests.status = 'running'` → exit `10`; same with `'finishing'` → exit `10`; `ALLOW_DURING_CONTEST=1` → exit `0`
  - a row with `submissions.overall_status = 'Running'` and `CD_QUEUE_WAIT_SECONDS=2` → exit `11`; deleting it while the script waits → exit `0`
  - `CD_MIN_FREE_GB=999999` → exit `12`
  - a SHA that is not an ancestor of `origin/main` → exit `14`
  - all clear → exit `0`
- [ ] **Step 2: Run** `node --test tests/cdDeployGuards.test.mjs` → FAIL (script missing).
- [ ] **Step 3: Implement the guards** in that order (cheapest and most local first: tree, SHA, disk, contest, queue). The queue guard polls until the window expires. Every refusal prints one line naming the reason and the numbers behind it.
- [ ] **Step 4: Run** → PASS. Then `shellcheck scripts/cd-deploy.sh` (or `sh -n` if shellcheck is unavailable) → clean.
- [ ] **Step 5: Commit** — `feat(ops): cd-deploy preflight guards`

### Task 3: Backup, deploy, verify, roll back

**Files:**
- Modify: `scripts/cd-deploy.sh`
- Test: `tests/cdDeployRollback.test.mjs`

**Interfaces:**
- Consumes: Task 1's three tagged images; Task 2's guards and exit codes.
- Produces: new exit codes `20` backup failed, `21` deploy failed **and rolled back**, `22` deploy failed and **rollback also failed**. Writes `backups/pre-deploy-<sha>-<ts>.dump` and `.last-release` (two lines: `tag` and `sha`). Env: `CD_BACKUP_KEEP` (default 3), `CD_DEPLOY_CMD` (default `./deploy.sh`, overridden in tests).

- [ ] **Step 1: Write the failing rollback test.** Using a throwaway compose project (its own name, ports and volumes, local overlay only — **not** `deploy.sh`, which is bound to the real domain, certificate and tunnel):
  - build and start tag `aaa`, write `.last-release` for it
  - run the script for tag `bbb` with `CD_DEPLOY_CMD` pointing at a stub that exits non-zero
  - assert: exit `21`; the running containers are back on the `aaa` images; the checkout is back on the `aaa` SHA; stdout says the deploy failed and the rollback succeeded
  - second case: same, but delete the `aaa` images first → exit `22`, and the message says the rollback target is missing (Review Focus 3)
  - third case: `.last-release` absent → the script warns "no rollback target" and still deploys (Review Focus 5)
- [ ] **Step 2: Run** `node --test tests/cdDeployRollback.test.mjs` → FAIL.
- [ ] **Step 3: Implement steps 2–7 of the design's script section**: backup (`pg_dump -Fc`, verify with `pg_restore -l`, delete the file and exit `20` if either fails, prune to `CD_BACKUP_KEEP`); record `.last-release`; `git fetch` + `git checkout --detach <sha>`; `OJ_IMAGE_TAG=<short-sha> $CD_DEPLOY_CMD`; verify loopback `/api/health/ready` and that the newest `schema_migrations` row matches the shipped migrations; on any failure restore **tree and images** and re-verify; prune `oj-*` tags older than the kept two by name.
- [ ] **Step 4: Run** both test files → PASS. `shellcheck` → clean.
- [ ] **Step 5: Commit** — `feat(ops): cd-deploy backup, verify and rollback`

### Task 4: The deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`
- Test: `tests/deployWorkflow.test.mjs`

**Interfaces:**
- Consumes: `scripts/cd-deploy.sh` from Tasks 2–3.
- Produces: workflow `Deploy`, job `deploy`, environment `production`.

- [ ] **Step 1: Write the failing test** in `tests/deployWorkflow.test.mjs`. There is **no YAML parser in this repo** — `composeConfig.test.mjs` parses the JSON that `docker compose config` emits, which does not apply here. Follow `tests/proxyHealthcheck.test.mjs` instead: `readFileSync` the workflow and assert on its text. Each assertion pins one guarantee from the design:

```js
assert.match(wf, /workflows:\s*\[CI\]/);               // fires on the CI workflow
assert.match(wf, /branches:\s*\[main\]/);              // main only
assert.match(wf, /environment:\s*production/);         // the human gate
assert.match(wf, /cancel-in-progress:\s*false/);       // deploys queue, never cancel
assert.match(wf, /workflow_run\.conclusion == 'success'/);  // red CI never deploys
assert.match(wf, /workflow_run\.head_sha/);            // the tested commit, not a branch
assert.doesNotMatch(wf, /StrictHostKeyChecking[= ]no/);
assert.doesNotMatch(wf, /runs-on:\s*self-hosted/);     // public repo
```

- [ ] **Step 2: Run** `node --test tests/deployWorkflow.test.mjs` → FAIL (file missing).
- [ ] **Step 3: Write the workflow.** Steps: checkout (for nothing but the known_hosts file if used), `tailscale/github-action` pinned to a released version with `oauth-client-id`/`oauth-secret`/`tags: tag:ci`, write `DEPLOY_SSH_KEY` to a 0600 file, pin the host key into `known_hosts`, then one `ssh` running `scripts/cd-deploy.sh <sha>`; finally a warning-only `curl` of `https://nonbangkokgrader.com/` with `continue-on-error: true`. `permissions: contents: read`.
- [ ] **Step 4: Run** → PASS. Add the new test file to the repo-config test command in `.github/workflows/ci.yml` and in `CONTRIBUTING.md`.
- [ ] **Step 5: Commit** — `feat(ops): deploy workflow gated on CI and a human approval`

### Task 5: Prove the rollback on the real server, then document

**Files:**
- Create: `docs/runbooks/continuous-deployment.md`
- Modify: `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Rehearse on the production host, in a throwaway compose project.** Clone the checkout to a temp dir, start tag `aaa`, run `cd-deploy.sh` for a tag whose deploy command fails, confirm the previous images and tree return. Record the actual output in the runbook. This is the first time the rollback path runs on the machine it protects; do not skip it because the tests passed on another box.
- [ ] **Step 2: Write the runbook** — how to approve a deploy, how to read a failed one, how to roll back by hand, where backups live and how to restore one (explicitly: restoring loses submissions made since the dump), and the exit-code table from Tasks 2–3.
- [ ] **Step 3: Update the three docs** — one short section each, linking the runbook; CLAUDE.md gets the deploy flow beside the existing deploy notes.
- [ ] **Step 4: Verify** — `node --test` over the repo-config tests, `./tests/run_tests.sh`, `cd frontend && npm run validate`.
- [ ] **Step 5: Commit** — `docs: continuous deployment runbook`

### Task 6: First live deploy

- [ ] **Step 1:** Merge to `main` and watch CI finish.
- [ ] **Step 2:** Confirm the deploy job parks on the approval and that `main` CI for a later push is **not** blocked behind it (the reason the workflows are split).
- [ ] **Step 3:** Approve. Watch the log: guards, backup size and `pg_restore -l` result, build, health, migration check.
- [ ] **Step 4:** Confirm on the server — site 200, `schema_migrations` unchanged (this release has no migration), `backups/` holds the new dump, `.last-release` names the new tag, and the previous release's images are still present.
- [ ] **Step 5:** Report to the user: what the pipeline did, how long it took, and that the next deploy is the first one with a real rollback target.
