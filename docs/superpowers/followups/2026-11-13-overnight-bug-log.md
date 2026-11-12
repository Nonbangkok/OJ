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

- **`npx tsc -p backend/tsconfig.test.json`** already reports 145 errors on `main` (`req.user` / `SessionData` augmentation). CI doesn't run it, and the count is unchanged.
- **React Compiler lint rules** (react-hooks v7) are off and tracked in `docs/superpowers/followups/2026-11-12-react-compiler-rules.md`.
- **Playwright visual baselines are stale on `main`.** admin-shell desktop and mobile fail because the fixtures don't cover `/admin/authoring/drafts?scope=mine`.
- **node-cron's global logger** (`setLogger`) is still used for its own shutdown and start-failure messages. Only the per-task hook is routed.
- **The Postgres 18 migration script has no run lock.** The runbook says to run one migration at a time.
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

## Production action needed (you)

After PR #15 (step 9) is merged, `deploy.sh` **refuses** to deploy on a server that still has Postgres 16 data. Follow `docs/runbooks/postgres-18-upgrade.md` to migrate. Run it inside tmux, with ≥ 4–6× the database size in free disk, and keep the old `db-data` volume until you're sure.
