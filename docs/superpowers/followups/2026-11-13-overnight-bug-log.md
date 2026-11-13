# Overnight bug log — toolchain upgrade steps 8–9 (2026-11-13)

This is every bug found while finishing the toolchain upgrade (spec `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md`) overnight, with where it was fixed. Items that were deliberately left for later are listed at the end.

## Fixed

| # | Found in | Bug | Fix |
|---|---|---|---|
| 1 | CI of PR #13 | The Integration job failed in `docker compose build`. `curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc` hit a transient TLS EOF, then `gpg: no valid OpenPGP data`. The key fetch had no retry, so CI was flaky. | PR #15 (step 9): `curl --retry 5 --retry-all-errors --retry-delay 2`. PR #13's job was re-run and passed. |
| 2 | Final review of step 8 | node-cron 4 writes its own coloured `console` warnings ("missed execution …", "Task failed …"). These bypass `utils/logger`, whose production output is JSON. v3 was silent. | PR #14: the per-task `logger` option forwards to `utils/logger` (`cronLogger`), with tests. |
| 3 | Review of the step 9 migration script | On SIGHUP (SSH drop), or Ctrl-C while output goes through `\| tee`, the trap cleanup was skipped. The temporary Postgres 16 container kept running on the old volume, and the runbook's rollback could then start a second postmaster on the same data directory. | PR #15: HUP/INT/TERM/PIPE are trapped, cleanup happens before any output, and a leftover container is removed on re-run. Reproduced with dash and verified. |
| 4 | Step 9 rehearsal | Image tags (`oj-backend:${OJ_IMAGE_TAG:-local}`) are shared across releases. After the migration the old release's backend (pg_dump 16) came up, and Admin DB export failed with "server version mismatch". | PR #15: the script builds the new images **before** stopping the app, and checks that the backend's `pg_dump` major version is 18. |
| 5 | Final review of step 9 | After a documented rollback to 16, the "migrated" marker stayed valid. The next routine `deploy.sh` would then pass the guard and switch the site to stale 18 data, silently losing everything written during the rollback. | PR #15: the marker records a hash of the old volume's `pg_control`; the guard refuses if 16 ran after the migration, and the rollback steps invalidate the marker. |
| 6 | Final review of step 9 | The runbook's backup commands (`exec database pg_dump -U "$POSTGRES_USER" …`) expanded the variables in the host shell, where they are empty, and allocated a TTY that corrupts `-Fc` archives. The result was empty or broken backups. | PR #15: `exec -T … sh -c '…'`, plus `pg_restore -l` verification. |

Earlier in the same run, the toolchain steps also caught and fixed these (details in their PRs):
- the statement-editor divider went to 0 px and could not be dragged over the preview iframe after react-resizable-panels 4 (PR #12);
- the statement-preview Web Worker broke under the Vite dev server (PR #11);
- `tests/run_tests.sh` hung in Jest watch mode (PR #11).

## Pre-existing bugs found and fixed

| Found in | Bug | Fix |
|---|---|---|
| Step 7 smoke | The contest date-picker header was covered by a 325 px blue button (`.form-container button` beat `.react-datepicker__navigation` on specificity), and the time list stayed white in dark theme. This reproduced on `main`. | PR #13 (separate session). |

## Left for later (not fixed on purpose)

- **Bare `npx jest` in `backend/`** fails because the ESM flag is only set by `npm test`. This is documented in CLAUDE.md and CONTRIBUTING.

## Fixed in the follow-up PR

These were in "Left for later" above and are fixed on `fix/overnight-residuals`:

- **`tests/composeConfig.test.mjs`** passed the developer's whole `process.env` to `docker compose`, so an exported `HTTP_PORT`, `COMPOSE_*` or `POSTGRES_*` overrode `.env.example` and failed the assertions locally. It now passes only what the docker CLI needs (`PATH`, `HOME`, `DOCKER_*`, `XDG_*`, `TMPDIR`/`TEMP`/`TMP`, `USER`, `LANG`, `LC_*`) plus the test's own overrides. `HTTP_PORT=9999 COMPOSE_PROJECT_NAME=zzz POSTGRES_DB=x node --test tests/composeConfig.test.mjs` failed before and passes now.
- **`scripts/pg18-migrate.sh` `stop_container`:** a `docker inspect` hiccup ended the wait early, and the `rm` → `rm -f` fallback could then SIGKILL a temporary 16 server that was still shutting down. An unreadable state now counts as "not confirmed stopped": it keeps polling (bounded, 120 s) until `State.Running` is `false`. `rm -f` is used only after that wait expires, with a warning, or after a re-check confirms the container stopped. The header and the runbook now say what really happens: `docker stop -t 120` SIGKILLs at its timeout, and the extra poll covers a container that survives that.
- **`scripts/pg18-migrate.sh` completed-migration check:** `[ "$(volume_file …)" != __MISSING__ ]` hid a `die` inside the command substitution, so a Docker error printed a spurious COMPLETED warning and carried on. The value is now captured first, so `set -e` aborts.
- **Runbook Rollback step 2:**
  - it says the marker `mv` fails harmlessly when there is no marker (rolling back a failed migration);
  - it has an undo step (rename `.oj-pg18-rolled-back` back) for an operator who cancels before 16 is started, and says the guard refuses that marker once 16 has run;
  - the `--force-recreate-18` section warns that a rolled-back 18 volume may still hold 18-era writes, and to export first.
- **Runbook manual backup commands** run in a `( umask 077; … )` subshell, so the files are mode 600 like the script's.
- **Guard exit 1** in the runbook's exit table also lists "`docker compose … config` failed / project name unreadable".

## Fixed (deferred-cleanup PR)

These were in "Left for later" above and are fixed on `fix/deferred-cleanup`:

- **`npx tsc -p backend/tsconfig.test.json`** reported 145 errors on `main`: 140 TS2339, 4 TS2352 and 1 TS2353, all from the `req.user` / `SessionData` augmentation. Its `include` (`tests/**/*.ts`) left out `types/express/index.d.ts` and `types/express-session/index.d.ts`. It now includes `types/**/*.d.ts` and reports 0 errors, with no test changes. CI's backend job runs it after `npm run build` (about 3 s).
- **node-cron's global logger:** `contestScheduler.start()` also calls `cron.setLogger(cronLogger)`, so node-cron's own shutdown and start-failure messages go through `utils/logger` too, and there is a unit test.
- **The Postgres 18 migration script has a run lock.** `backups/.pg18-migrate.lock` is created with an atomic `mkdir` and holds `pid`/`started_at`. It is taken before the script touches Docker and released in `on_exit`, after the container cleanup and the status file. A second run refuses (exit 1) and leaves the lock and the status file alone. The runbook says how to clear a stale lock.
- **Playwright visual fixtures:** `**/api/admin/authoring/drafts?scope=mine` is stubbed (`[]`). All 4 visual tests pass against the existing baselines, and none were regenerated.

## Fixed (React Compiler rules PR)

- **React Compiler lint rules** were partly off (69 findings). All five rules are now `'error'`; see `docs/superpowers/followups/2026-11-12-react-compiler-rules.md`.
- **Pre-existing bug, XP toast stuck on screen** (found while clearing those findings): the "+N XP" toast's auto-dismiss effect depended on the latest realtime event. A non-qualifying event arriving while the toast was up cleared the timer and started none, so the toast stayed until the next first-solve. A typical trigger is submitting again within 4 s, which sends a Running update. The timer is now keyed on the toast itself. A new test failed before the fix and passes after it.
- **Pre-existing bug, live preview stuck on "Rendering live preview…" for an empty statement** (found in the browser smoke of this PR): the preview worker renders an empty statement to `''`, and `useStatementPreview` only accepted a `rendered` message with truthy `html`. It had already cleared the 15 s fallback timer, so a new draft, or a statement cleared to nothing, showed "Rendering live preview…" forever and kept the old preview body. An empty render now counts as finished. A new test failed before the fix.

## Fixed (404 page / admin search PR)

Both found during the React Compiler PR (browser smoke and final review); both predate it.

- **Unknown URLs showed React Router's developer error screen** ("Unexpected Application Error! 404 Not Found … Hey developer 👋"): there was no catch-all route. A `path="*"` route now renders a "Page not found" page with a link home, including for unknown `/admin/...` paths. The route tree is exported as `appRoutes` so the test can render it in a memory router. The tests fail without the route.
- **Searching admin problems for the word "all" wiped the search box**: `updateUrlFilter` treated `'all'` as the "no filter" sentinel for every key, including the free-text search. Typing `all` deleted the `search` URL param, and the URL→control sync then cleared the box mid-word. The sentinel now applies only to the dropdown filters. A new test failed before the fix.

## Fixed (modals / Gecko code view / create_admin / caching PR)

- **Submission code could not be scrolled in Gecko browsers** (Firefox, Zen; reported by the user): the read-only code view was a `disabled` textarea, and Gecko does not let users interact with disabled form controls. It is now `readOnly` (scrollable, selectable, focusable). Because react-simple-code-editor still applies Enter, brackets and undo itself, those keys are cancelled first, and Tab moves focus. The authoring code editor, which is locked while a job runs, got the same fix.
- **Problem and contest modals ignored Escape and did not trap focus**: they were plain overlays, not the shared `Dialog`. Dialog's keyboard logic is now a shared `useModalFocus` hook used by both modals, with their look unchanged. Escape is ignored while an upload or save runs, and an Escape the date picker already handled (closing its calendar) no longer closes the dialog.
- **`create_admin.js` failed with piped input** (`ERR_USE_AFTER_CLOSE`): readline dropped answers that arrived while the script awaited its DB query. A queued line prompter fixes it. The script now also exits non-zero on failure and always releases stdin and the DB pool.
- **Browsers could run a stale build after a deploy** (found while verifying the fixes above): `index.html` was served without `Cache-Control`, so browsers cached it heuristically (10% of its age; hours for an old deploy) and kept requesting the previous build's hashed bundles, which no longer exist. `frontend/nginx.conf` now sends `no-cache` for `index.html` and `immutable` for `/assets/`. `tests/frontendCaching.test.mjs` runs the real config in nginx.

## Found during the production Postgres 18 migration (2026-11-13)

- **Production went down after deploying current main: the nginx-proxy healthcheck failed forever.** A security change on main made `nginx-proxy/production.conf` redirect plain-HTTP requests that do not come through the Cloudflare tunnel to HTTPS. The compose healthcheck (`wget --spider http://127.0.0.1/`) is such a request: it got a 301, followed it to an HTTPS URL whose certificate does not match `127.0.0.1`, and failed. `cloudflared` waits for a healthy proxy, so it never started and the site returned Cloudflare 530/1033, while the app itself was healthy. CI didn't catch it because CI runs `local.conf`. Fixed by giving the healthcheck its own `location = /nginx-health` (exact match, no upstream, no redirect) in both proxy configs. `tests/proxyHealthcheck.test.mjs` runs the real configs in nginx and runs the compose healthcheck command against them; CI runs it.
- **Correction (measured afterwards): the migration script's disk rule was not the problem.** An earlier version of this entry blamed the script. On production, for 4950 MiB of `base/` the `.sql` was 8.66 GB, the `.dump` 3.07 GB (plus a 3.07 GB transient copy inside the container), and the new cluster 5.9 GB. That is a peak of about 4.3× against 37.9 GB free, with 29.7 GB required by the 6× rule. The VM's filesystem peaked around 78% and never filled. The outage mid-restore (SSH, Tailscale and the tunnel all dropped at once, and the user reported the server's storage full) matches the VM's backing storage on the host filling up. A check inside the guest cannot see that. The runbook now has the measured ratios and a note to check the host's storage for thin-provisioned VMs.
- **Intermittent "too many redirects" on production after the deploy.** A second `cloudflared` container, `oj_cloudflared`, created by hand on 2026-09-26 outside compose, used the same tunnel token, so Cloudflare split traffic between it and the compose `cloudflared`. It sits on `oj_oj-network` (172.18.0.5), while nginx trusts `X-Forwarded-Proto` only from the compose connector at 172.30.250.3. Every request through it was therefore redirected to HTTPS again, in a loop. Before today's deploy the old `production.conf` trusted the header from anyone, so the duplicate was harmless. It was stopped with `--restart=no` and the container was kept; all 301s from 172.18.0.5 stopped and 55/55 requests returned 200. The runbook prerequisites now tell you to check for exactly one connector.

## Production migration

Done on 2026-11-13: production runs Postgres 18 (`oj_db-data-18`). The old `oj_db-data` volume and the `backups/pg16-20261113T033111Z.*` files are kept until the site is confirmed stable; remove them only as described in `docs/runbooks/postgres-18-upgrade.md`.
