# Upgrade Step 1 — Node 26 Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Node pin from 20 to 26 without changing the Debian base the judge runs on.

**Architecture:** One pinned major (`26`) declared in `.nvmrc`, mirrored in both `package.json` `engines`, both lockfiles' root `engines`, and every Node base image. A root-level `node --test` guard keeps them in sync. The backend and authoring-runner build stages use `node:26-bookworm-slim` so g++ 12 / Python 3.11 and the runner's glibc floor stay as today.

**Tech Stack:** Node 26 (LTS "Lithium", 26.13.x), Docker, GitHub Actions (`setup-node` reads `.nvmrc`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 1)

**Pre-check already done (2026-11-12):** on `node:26-bookworm-slim`, frontend `npm ci --legacy-peer-deps`, type-check, lint:check, 1020/1020 tests and CRA build pass; backend `npm ci`, build, and `bcrypt`/`sharp` load pass.

## Global Constraints

- Node major: `26` everywhere. `engines.node`: `"26.x"`.
- Backend image: `node:26-bookworm-slim` (judge stays g++ 12 / Python 3.11 — compiler upgrade is spec Step 2, not here).
- Authoring runner build stage: `node:26-bookworm-slim` (its `node` binary is copied into `ubuntu:24.04`).
- Frontend build stage: `node:26-alpine`. Frontend runtime stage `nginx:1.25-alpine` unchanged (spec Step 3).
- No dependency version changes; lockfiles change only in the root `engines` field.
- `--legacy-peer-deps` stays (removed in spec Step 6).
- Historical logs (`.context/AUTHORING_PROGRESS.md`, `.superpowers/sdd/**`, old plans/specs) are not edited.
- Commits: user is sole author — no `Co-Authored-By` trailer. Branch `chore/node-26` from latest `main`. Builder opens the PR and stops; the user merges.

## Review Focus

1. Runner image: the copied Node 26 binary must start on `ubuntu:24.04` → Task 2 checks `node --version` inside the built runner image.
2. Judge toolchain unchanged → Task 2 checks `g++ --version` reports 12.x and `python3 --version` 3.11.x in the backend image.
3. Native modules inside the real backend image (not just a dev container) → Task 2 loads `bcrypt` and `sharp` in the built image.
4. Contest scheduler timezone → Task 2 checks `Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok' })` resolves in the backend image.
5. A later edit bumping one pin but not the others → Task 1's guard test fails in CI.

---

### Task 1: Node version guard + pins

**Files:**
- Create: `tests/nodeVersion.test.mjs`
- Modify: `.nvmrc`, `backend/package.json` (`engines`), `frontend/package.json` (`engines`), `backend/package-lock.json` and `frontend/package-lock.json` (`packages[""].engines.node` only), `.github/workflows/ci.yml` (docker job test command)

**Interfaces:**
- Produces: `tests/nodeVersion.test.mjs`, run by the CI docker job next to `composeConfig.test.mjs`. Task 2 makes its Dockerfile assertions pass.

- [ ] **Step 1: Write the failing guard test** — `node:test` + `node:assert/strict`, reading files relative to the repo root (same pattern as `tests/composeConfig.test.mjs`):
  - `test('.nvmrc pins Node 26')`: `.nvmrc` trimmed equals `'26'`.
  - `test('package engines match .nvmrc')`: for `backend` and `frontend`, `package.json` `engines.node` and `package-lock.json` `packages[''].engines.node` equal `'26.x'`.
  - `test('Node base images match .nvmrc')`: every `FROM node:<tag>` line in `backend/Dockerfile`, `backend/authoring/Dockerfile`, `frontend/Dockerfile` has a tag starting with `26-`.
  - `test('judge and runner build stages stay on bookworm')`: `backend/Dockerfile` contains `FROM node:26-bookworm-slim`; `backend/authoring/Dockerfile` contains `FROM node:26-bookworm-slim AS build`.

- [ ] **Step 2: Run it, expect failures** — `node --test tests/nodeVersion.test.mjs` → all 4 tests FAIL (still `20`).

- [ ] **Step 3: Update pins** — `.nvmrc` → `26`; both `engines.node` → `"26.x"`; both lockfiles' `packages[""].engines.node` → `"26.x"` (edit the field; do not regenerate the lockfile).

- [ ] **Step 4: Run the guard** — `node --test tests/nodeVersion.test.mjs` → the first two tests PASS, the Dockerfile tests still FAIL (fixed in Task 2).

- [ ] **Step 5: CI runs the guard** — in `.github/workflows/ci.yml` docker job, change `node --test tests/composeConfig.test.mjs` to `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs`. Do **not** use a glob: `tests/localSessionSmoke.test.mjs` needs a running stack and must stay out of CI.

- [ ] **Step 6: Lockfiles still install cleanly** — `cd backend && npm ci --no-audit --install-links` and `cd frontend && npm ci --legacy-peer-deps --no-audit --install-links` succeed with no `EBADENGINE` under Node 26 (run inside `node:26-bookworm-slim` if the host Node is not 26). `git diff --stat` on lockfiles shows exactly one changed line each.

- [ ] **Step 7: Commit** — `git commit -m "chore: pin Node 26 and guard version consistency"` (Dockerfiles not yet included; guard is red on purpose until Task 2 — do not push between tasks).

### Task 2: Node 26 base images

**Files:**
- Modify: `backend/Dockerfile:2`, `backend/authoring/Dockerfile:1,9` (`FROM` and the "retaining Node 20" comment → Node 26), `frontend/Dockerfile:2`

**Interfaces:**
- Consumes: guard test from Task 1.

- [ ] **Step 1: Change the base images** — `backend/Dockerfile` → `FROM node:26-bookworm-slim`; `backend/authoring/Dockerfile` → `FROM node:26-bookworm-slim AS build` and comment "while retaining Node 26"; `frontend/Dockerfile` → `FROM node:26-alpine AS build`. Leave the `bookworm-pgdg` apt line in `backend/Dockerfile` as is (still correct on bookworm).

- [ ] **Step 2: Guard passes** — `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs` → nodeVersion 4/4 and composeConfig 5/5 PASS.

- [ ] **Step 3: Build all images** — `docker compose --env-file .env.example build` and `docker compose -f tests/authoring/compose.yml build` succeed.

- [ ] **Step 4: Runtime checks in the built images** (Review Focus 1–4). Use the image names compose printed:
  - backend: `node -v` → `v26.`; `g++ --version` first line contains ` 12.`; `python3 --version` → `Python 3.11.`; `node -e "require('bcrypt').hashSync('x',4);require('sharp');new Intl.DateTimeFormat('en',{timeZone:'Asia/Bangkok'}).format(new Date());console.log('ok')"` → `ok`.
  - authoring runner: `node -v` → `v26.`; `node -e "require('/runner/node_modules/katex');require('/runner/node_modules/marked');console.log('ok')"` → `ok`.

- [ ] **Step 5: Commit** — `git commit -m "build: move Docker images to Node 26 (judge stays on bookworm)"`

### Task 3: Docs

**Files:**
- Modify: `README.md:92,283`, `CONTRIBUTING.md:22`, `.context/STANDARDS.md:246`

- [ ] **Step 1: Replace "Node 20" / "Node.js 20" with "Node 26" / "Node.js 26"** on those lines only. Confirm with `git grep -n -E "Node(\.js)? ?20|node:20" -- ':!.context/AUTHORING_PROGRESS.md' ':!.superpowers' ':!docs/superpowers'` → no matches.

- [ ] **Step 2: Commit** — `git commit -m "docs: Node 26 is the supported runtime"`

### Task 4: Full verification and PR

- [ ] **Step 1: Backend suite on Node 26** — inside the built backend image or `node:26-bookworm-slim` with the CI apt packages: `npm run build && npm test -- --ci` → 0 failures (baseline: 1222 passed, 253 skipped).
- [ ] **Step 2: Frontend** — on Node 26: `npm run validate` and the CRA build with `REACT_APP_API_URL=/api DISABLE_ESLINT_PLUGIN=true INLINE_RUNTIME_CHUNK=false` → pass (baseline: 1020 tests).
- [ ] **Step 3: Integration stack** — `docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests` (project name `oj-node26`) → `Tests: … 0 failed` (baseline 1471), then `down -v`.
- [ ] **Step 4: Local app smoke test** — `docker compose --env-file .env.example up --build -d`, wait for `/api/health/ready` = 200, then in a browser: log in, problem list, open a problem, submit a C++ and a Python solution (verdicts appear), contest scoreboard, admin panel. No CSP errors in the console. Tear down.
- [ ] **Step 5: Push and open the PR** — branch `chore/node-26`, base `main`, title `chore: upgrade to Node 26 (step 1/9)`. Body: what changed, the runtime-check outputs from Task 2 Step 4, test counts, and what was not verified. No Claude attribution footer. Stop for user review.
