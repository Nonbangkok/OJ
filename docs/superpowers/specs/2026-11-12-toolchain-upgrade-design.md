# Toolchain & Dependency Upgrade — Design

Date: 2026-11-12
Status: draft, awaiting approval

## Intent

Bring the whole repository up to current, supported tooling **before** it
becomes a problem. Nothing is broken today; the goal is to stay modern and
off end-of-life software (Node 20 reached EOL in April 2026).

Success = everything behaves exactly as it does today, running on current
tooling, with CI green at every step. Users of the site should not be able to
tell anything changed.

## Goals

- Every runtime, build tool, linter, type checker, library, base image and CI
  action moved to its current release, **except** where the ecosystem cannot
  support it yet (see Constraints) or where the user chose to freeze it.
- Done **one step at a time**: each step is its own branch + PR, must pass CI
  and be merged before the next step starts. A failure always points to one
  step and can be reverted alone.
- Use DraSoGo's commit `96266ce` (branch `security/hardening-2026-09`) as a
  reference for the CRA → Vite and Node/dep changes, but re-do the work on
  current `main`; do not cherry-pick it (it forked on 2026-09-30 and conflicts).

## Non-goals

- No new features, refactors or behaviour changes beyond what an upgrade
  forces. Code changes are limited to adapting to breaking API changes.
- No changes to how statements/markdown/math render.
- No production deploy or production data migration performed by the builder.

## Anti-goals (failure even if the build passes)

- Any page renders or looks different; any UI flow breaks.
- The CSP (`script-src 'self'`, no `unsafe-inline`) blocks a script — a white
  screen in production. (CRA needed `INLINE_RUNTIME_CHUNK=false` for this.)
- `REACT_APP_API_URL` / `REACT_APP_LARGE_UPLOAD_API_URL` not baked in at build
  time, or their meaning changes for the deployed compose stack.
- Contest scheduler stops transitioning contests (node-cron major bump).
- Uploads, avatars, image safety, ZIP import/export, DB export/import break.
- Statement or PDF output changes in any way.
- Sandbox guarantees change, or verdicts change for any reason other than
  the deliberate compiler/interpreter upgrade (step 2).
- CI goes red, or a test is weakened/deleted to make it pass.

## Constraints (decided by research, 2026-11-12)

| Item | Latest | Target | Why |
|---|---|---|---|
| Node | 26 (Active LTS "Lithium"), 24 maintenance | **26** | Longest support. *(Builder's call, user may override.)* |
| TypeScript | 7.0 | **6.0.x** | `typescript-eslint` peer `<6.1`, `ts-jest` peer `<7`. |
| ESLint | 10 | **9 (flat config)** | `eslint-plugin-react`, `jsx-a11y`, `import` peer max `^9`. |
| typescript-eslint | 8 | 8 | Supports ESLint 9 and TS 6.0. |
| Postgres | 18 | **18** (last step) | User decision. |

**Frozen by user decision — must not change:**

- `shared/statement-renderer`: `katex 0.15.1`, `marked 4.0.8`,
  `htmlparser2 10.0.0` (exact pins). Reason: markdown must render identically.
- Every other place that carries these libraries for rendering stays on the
  same exact versions, including `backend/package.json` `htmlparser2: 10.0.0`
  and the copies the authoring runner image takes from `backend/node_modules`
  (`marked`, `katex`, `htmlparser2`, `domhandler`, `domutils`,
  `dom-serializer`, `domelementtype`, `entities`). Transitive versions of
  these must stay byte-identical to today's lockfile.
- PDF template vendor assets (`backend/authoring/templates/**`).

## Steps (in order)

Each step: branch from latest `main`, PR, CI green, merged before the next.
Each PR description lists what changed and what was verified.

### 1. Node 26 everywhere (same Debian)
- `.nvmrc`, `engines` in both `package.json`s, docs mentioning Node 20.
- Base images: `node:26-bookworm-slim` for `backend/Dockerfile` (keeps the
  judge's g++ 12 / Python 3.11 unchanged in this step),
  `node:26-*` for the authoring runner build stage and `frontend/Dockerfile`.
- The authoring runner copies the `node` binary into `ubuntu:24.04`; confirm
  Node 26's binary runs there (glibc).
- Native modules (`bcrypt`, `sharp`) must install/build on Node 26.
- CI uses `.nvmrc`, so it follows automatically.

### 2. Judge toolchain: Debian trixie (g++ 14, Python 3.13)
User decision: upgrade the judge's compiler and interpreter.
- `backend/Dockerfile` → `node:26-trixie-slim`. Replace the hard-coded
  `bookworm-pgdg` apt repo with the image's own codename.
- Compile flags stay the same (`-std=c++20 -fsanitize=signed-integer-overflow`),
  `LANGUAGE_LIMITS` multipliers unchanged.
- The sandbox (`scripts/time_wrapper.c`, seccomp filter, prlimit,
  per-submission uid) must still build and pass its tests; any new syscall
  needed by the newer libc is investigated, not blanket-allowed.
- Fallback-avatar fonts (`fonts-dejavu-core`, `fonts-tlwg-garuda`) come from
  trixie; avatar rendering tests must pass.
- **Existing submissions are not re-judged or compared.** Old verdicts stay as
  they are; if a user reports a problem it is handled case by case. *(User
  decision.)*
- The PR states the before/after g++ and Python versions so the change is
  traceable.

### 3. CI actions and infra images (non-database)
- GitHub Actions to current majors (`checkout`, `setup-node`,
  `upload-artifact`).
- `nginx:1.25-alpine` → current stable (frontend runtime stage and
  `nginx-proxy`); re-run `nginx -t` and the redirect/ACME checks against
  `nginx-proxy/production.conf` and `local.conf`.
- `cloudflare/cloudflared` stays on its pinned digest: the tunnel cannot be
  tested without the production token. *(Builder's call.)*
- `ubuntu:24.04` runner base stays unless a newer LTS is required — but the
  pinned `wkhtmltopdf=0.12.6-2build2` package and Qt behaviour must not change
  (PDF output is frozen).

### 4. TypeScript 6.0 (frontend + backend)
- Frontend is on 5.5.4 (held back by CRA's `^4` peer, worked around with
  `--legacy-peer-deps`); backend on 5.9.3.
- Fix only what the compiler newly reports. Keep `strict` settings.
- If CRA cannot tolerate TS 6 in the frontend, do the frontend half of this
  step together with step 6 (Vite) and say so in the PR.

### 5. ESLint 9 flat config + typescript-eslint 8 (frontend)
- Convert `frontend/.eslintrc*` to `eslint.config.*`. Adopt the
  typescript-eslint v8 `recommended` preset (successor of today's v5
  `recommended`). Fix findings that are mechanical (no behaviour change);
  rules whose findings would need refactors are turned off or downgraded
  explicitly and listed in the PR. `eslint-plugin-import` stays unconfigured
  as today. *(Builder's call.)*
- `eslint-plugin-react-hooks` 4 → 7 adds new rules (React Compiler rules).
  Fix real findings; anything noisy that would require refactors is
  explicitly configured and listed in the PR, not left as failing lint.
- `eslint-config-prettier`, `eslint-import-resolver-typescript` to current.
- `npm run lint:check` and `npm run validate` must pass.

### 6. Frontend: CRA → Vite
- Reference: `96266ce` (`vite.config.mts`, root `index.html`, Jest + Babel
  config, Dockerfile changes, Playwright `webServer`).
- Keep `REACT_APP_API_URL` / `REACT_APP_LARGE_UPLOAD_API_URL` as the
  build-arg names in compose and CI (deployment contract unchanged); map them
  in Vite config. Default `/api` must match today.
- Built output must have **no inline scripts** (CSP). Verify by building and
  checking `build/index.html`, and by loading the built app behind
  `nginx-proxy/local.conf` with the CSP header.
- Output dir stays `build/` (frontend Dockerfile/nginx copy from it).
- Tests: Jest (+ jsdom, Babel or ts-jest) replacing `react-scripts test`;
  same tests, same coverage thresholds on `src/services/*.ts`.
  `tsconfig.tests.*.json` keep working.
- Drop `--legacy-peer-deps` everywhere (Dockerfile, CI) once peers resolve.
- Dev server proxy keeps `/api` → backend like CRA's `proxy` field did.
- Browser support: set an explicit `build.target` close to today's
  browserslist (`>0.2%, not dead`) — e.g. `['es2020', 'chrome87', 'safari14',
  'firefox78', 'edge88']` — with **no** `@vitejs/plugin-legacy` (it emits
  inline scripts the CSP blocks). Very old browsers that only worked through
  CRA's heavier transpilation are accepted as dropped; state it in the PR.
  *(Builder's call.)*
- Visual regression (`npm run test:visual`, macOS baselines, not in CI) is
  run locally before and after. Where pixels differ only from a new Chromium
  or CSS ordering, baselines may be regenerated **after manual review**, with
  before/after images or a diff summary in the PR. A real layout change is a
  bug, not a baseline update. Visual tests are not added to CI in this
  project. *(Builder's call.)*
- Update `CLAUDE.md`, `CONTRIBUTING.md`, `README.md` commands.

### 7. Frontend library majors
Each with only the code changes its breaking changes require:
`react-resizable-panels` 2→4, `react-datepicker` 7→9, `date-fns` 3→4,
`web-vitals` 2→6, `@testing-library/jest-dom` 6→7, `ajv-formats` 2→3,
`@types/node` to match Node 26, plus all minor/patch bumps (React 19.3,
axios, react-router, Playwright, …). If one library's migration turns out
large (e.g. resizable panels), it may get its own PR.

### 8. Backend library majors
`node-cron` 3→4 (remove `scheduled: true`; scheduler must still fire every
minute in `Asia/Bangkok`), `sharp` 0.34→0.35, `archiver` 7→8,
`connect-pg-simple` 9→10, `dotenv` 17→18, `express-sse` 0.5→1.0,
`multer` 2.x latest, remove unused `uuid`, `@types/*` and all minor/patch
bumps. `htmlparser2` stays at `10.0.0` (frozen).

### 9. Postgres 16 → 18 (last)
Code/config PR only:
- `postgres:18-alpine` in `docker-compose.yml` and
  `tests/authoring/compose.yml`; volume mount moved to `/var/lib/postgresql`
  (the 18 image's new `PGDATA` layout) — a fresh local DB must initialise and
  migrations must apply.
- `postgresql-client-18` in `backend/Dockerfile` so Admin DB export/import
  (`pg_dump`/`psql`) works against 18.
- A migration script + runbook (`docs/` or `scripts/`) for production:
  stop backend → `pg_dumpall` from 16 (kept as backup) → new volume on 18 →
  restore → row-count checks (users, problems, testcases, submissions,
  contests) → start backend; old volume kept for rollback.
- Guard against an accidental unmigrated deploy: `deploy.sh` (and the
  runbook) refuse to start Postgres 18 if the existing volume still holds a
  v16 data directory (`PG_VERSION` = 16), printing the runbook path instead.
  The site must never come up on an empty database. *(Builder's call.)*
- Rehearse the runbook locally on a copy of real-shaped data and record the
  result in the PR. **The user runs the production migration themselves.**

## Merging and deploying

- The builder opens each PR and stops; **the user reviews and merges** (as
  with PRs #1 and #2). The next step starts from `main` after that merge.
- Recommended: deploy to production after each merged step, so a
  production-only fault points to one step. *(Builder's recommendation; the
  user decides when to deploy.)*

## Verification required in every step

- CI (all 4 jobs) green.
- For steps touching frontend build/runtime: build the compose stack locally
  and click through login, problem list, problem view, submit, contest
  scoreboard, admin panels; no console CSP errors.
- For steps touching backend runtime: full backend suite plus the integration
  compose stack.
- PR description states what was verified and what was not.

## Left to the builder

- Exact patch versions within the targets above.
- Jest transform choice for the frontend (Babel vs ts-jest) as long as tests
  and coverage are unchanged.
- Splitting a step into more PRs if it grows; never merging two steps into one
  except the TS-6/Vite case noted in step 4.
