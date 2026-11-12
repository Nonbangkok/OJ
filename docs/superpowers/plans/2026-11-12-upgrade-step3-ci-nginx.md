# Upgrade Step 3 — CI Actions and nginx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the GitHub Actions to their current majors and both nginx images from 1.25 to the current stable line (1.30), with no change to how the site is served.

**Architecture:** One guard test pins the nginx tag so the reverse proxy (`docker-compose.yml`) and the frontend runtime stage (`frontend/Dockerfile`) can never drift apart. Then the tag bump, verified by `nginx -t` on all three configs and by behaviour checks (HTTPS redirect, spoofed-proto resistance, ACME path, security headers/CSP). The Actions bump is verified by CI itself on the PR.

**Tech Stack:** nginx 1.30.x (`nginx:1.30-alpine`), GitHub Actions `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 3; "CI actions and infra images (non-database)")

**Research already done (2026-11-12):**
- Latest: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2. nginx stable is 1.30.6 (`nginx:1.30-alpine`); mainline is 1.31.
- Breaking changes v4→v7, none affecting this workflow:
  - all three now run on the Node 24 action runtime (GitHub-hosted runners qualify);
  - setup-node v6 limits *automatic* caching to npm — we pass `cache: npm` explicitly;
  - checkout v7 refuses fork checkouts under `pull_request_target` / `workflow_run` — we use `pull_request`;
  - upload-artifact v7 adds an opt-in `archive: false` and moves to ESM — our `name`/`path` usage is unchanged.
- `nginx -t` passes with no warnings for `nginx-proxy/production.conf`, `nginx-proxy/local.conf` and `frontend/nginx.conf` on both 1.25 and 1.30.6. No `http2`, `spdy` or other deprecated directives are used.

## Global Constraints

- nginx tag: `nginx:1.30-alpine` in **both** `docker-compose.yml` (`nginx-proxy` service) and `frontend/Dockerfile` (runtime stage). No config file changes unless 1.30 rejects or warns on something — it does not today.
- Actions: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7` (major tags, matching the existing style). No other workflow changes: same jobs, triggers, permissions, steps, commands, `cache: npm` + `cache-dependency-path`, artifact `name`/`path`.
- `cloudflare/cloudflared` stays on its pinned digest (spec: untestable without the production token).
- The authoring runner and judge images are untouched.
- Commits: user is sole author — no `Co-Authored-By` trailer. Branch `chore/ci-nginx` from latest `main`. Builder opens the PR and stops; the user merges.

## Review Focus

1. The proxy and the frontend runtime drift to different nginx versions later → Task 1's guard.
2. Production HTTPS behaviour silently changes under the new nginx (redirect, spoofed `X-Forwarded-Proto`, ACME) → Task 2 Step 4 checks on `nginx:1.30-alpine`.
3. Security headers or CSP lost or altered → Task 2 Step 5 compares response headers from the local stack before/after.
4. Coverage artifact silently stops uploading after the `upload-artifact` bump → Task 4 checks the PR's CI run lists the artifact.
5. A cached `setup-node` npm cache keyed differently makes CI slower or misses → Task 4 reports cache hit/miss from the run log (informational, not a failure).

---

### Task 1: nginx tag guard

**Files:**
- Create: `tests/nginxVersion.test.mjs`
- Modify: `.github/workflows/ci.yml` (the docker job's "Repo config tests (compose + Node version)" step: add the new file to the explicit list and rename the step to "Repo config tests (compose, Node and nginx versions)")

**Interfaces:**
- Produces: `tests/nginxVersion.test.mjs`, run by CI next to `composeConfig.test.mjs` and `nodeVersion.test.mjs`.

- [ ] **Step 1: Write the failing guard** (style of `tests/nodeVersion.test.mjs`):
  - `test('reverse proxy and frontend runtime use the same nginx image')`: the `image:` of the `nginx-proxy` service in `docker-compose.yml` (read the file text; match `^\s*image:\s*(nginx:\S+)` within the service, or render with `docker compose config --format json` like `composeConfig.test.mjs`) equals the `FROM nginx:…` tag in `frontend/Dockerfile`.
  - `test('nginx is on the 1.30 stable line')`: that shared tag equals `nginx:1.30-alpine`.
- [ ] **Step 2: Run, expect failure** — `node --test tests/nginxVersion.test.mjs` → the first test PASSES (both are 1.25 today), the second FAILS (`nginx:1.25-alpine`). Record both.
- [ ] **Step 3: Wire into CI** as listed under Files. Do not use a glob (`tests/localSessionSmoke.test.mjs` needs a running stack).
- [ ] **Step 4: Commit** — `git commit -m "test: guard the shared nginx image version"` (guard red on purpose until Task 2; do not push between tasks).

### Task 2: nginx 1.30

**Files:**
- Modify: `docker-compose.yml:134`, `frontend/Dockerfile:36`, `.context/ARCHITECTURE.md:25` (`| Reverse Proxy | Nginx | 1.25 |` → `1.30`)

- [ ] **Step 1: Bump both tags** to `nginx:1.30-alpine`; update the ARCHITECTURE.md table row.
- [ ] **Step 2: Guard green** — `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs` → all pass.
- [ ] **Step 3: Config syntax** — for each of `nginx-proxy/production.conf`, `nginx-proxy/local.conf`, `frontend/nginx.conf`: `docker run --rm --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 -v "$PWD/<conf>:/etc/nginx/conf.d/default.conf:ro" -v <dummy-letsencrypt>:/etc/letsencrypt:ro nginx:1.30-alpine nginx -t` → "test is successful" with no `[warn]`/`[emerg]` lines. The dummy letsencrypt dir holds a throwaway self-signed `live/nonbangkokgrader.com/{fullchain,privkey}.pem` in a temp dir, deleted afterwards.
- [ ] **Step 4: Production proxy behaviour on 1.30** — run `nginx:1.30-alpine` with `production.conf` (same mounts plus a temp `/var/www/certbot` containing `.well-known/acme-challenge/t`), publish port 80 on a free local port, and check:
  - `curl -H 'Host: nonbangkokgrader.com' http://127.0.0.1:<p>/api/health/live` → `301` to `https://nonbangkokgrader.com/api/health/live`
  - same with `-H 'X-Forwarded-Proto: https'` (untrusted peer) → still `301`
  - `-H 'Host: upload.nonbangkokgrader.com' …/api/x` → `301` to `https://upload.nonbangkokgrader.com/api/x`
  - `…/.well-known/acme-challenge/t` → `200`, body `tok`
  Remove the container and temp dir.
- [ ] **Step 5: Local stack headers and app** — `COMPOSE_PROJECT_NAME=oj-nginx-smoke HTTP_PORT=8088 docker compose --env-file .env.example up --build -d`, wait for `/api/health/ready` = 200, then:
  - `docker compose … exec nginx-proxy nginx -v` → `nginx/1.30.`; `docker compose … exec frontend nginx -v` → `nginx/1.30.`
  - `curl -sI http://127.0.0.1:8088/` and `curl -sI http://127.0.0.1:8088/api/health/live`: record `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy`; they must match the values in `nginx-proxy/local.conf` / `frontend/nginx.conf` exactly.
  - `curl -s http://127.0.0.1:8088/ | grep -c '<script src='` ≥ 1 and the page's JS/CSS assets return 200.
  Tear down with `down -v`.
- [ ] **Step 6: Commit** — `git commit -m "build: nginx 1.30 for the proxy and the frontend runtime"`

### Task 3: GitHub Actions v7

**Files:**
- Modify: `.github/workflows/ci.yml` (every `actions/checkout@v4` → `@v7`, `actions/setup-node@v4` → `@v7`, `actions/upload-artifact@v4` → `@v7`)

- [ ] **Step 1: Bump the three actions**; nothing else in the file changes. `git diff .github/workflows/ci.yml` shows only `uses:` lines.
- [ ] **Step 2: YAML still parses** — `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` (no output, exit 0).
- [ ] **Step 3: Commit** — `git commit -m "ci: move GitHub Actions to v7"`

### Task 4: Verification and PR

- [ ] **Step 1: Root tests** — `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs` → all pass; `docker compose --env-file .env.example config --quiet` and with the production overlay (`CLOUDFLARE_TUNNEL_TOKEN=test-only`) → exit 0.
- [ ] **Step 2: Browser smoke** on the Task 2 stack (re-create it if it was torn down): load the site, log in as a throwaway local admin, open problems and the admin panel — no console errors, in particular no CSP violations. Tear down with `down -v`.
- [ ] **Step 3: Push and open the PR** — branch `chore/ci-nginx`, base `main`, title `chore: GitHub Actions v7 and nginx 1.30 (step 3/9)`. Body: versions before/after, the release-note review above, the `nginx -t` and behaviour-check results, headers before/after, what is verified only by this PR's CI (the Actions bump). No Claude attribution footer.
- [ ] **Step 4: Check the PR's CI run** — all 4 jobs green; the run lists the `frontend-coverage` artifact (`gh api repos/Nonbangkok/OJ/actions/runs/<run-id>/artifacts -q '.artifacts[].name'`) — note the step uses `if-no-files-found: ignore`, so a missing artifact would not fail CI on its own; note setup-node cache hit/miss for each job. Stop for user review.
