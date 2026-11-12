# Upgrade Step 4 — TypeScript 6.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move backend (5.9.3) and frontend (5.5.4) to TypeScript 6.0.3, fixing only what TS 6 newly reports, with no runtime behaviour change.

**Architecture:** Backend is a pure version bump (0 new errors). Frontend needs its `tsconfig.json` modernised for TS 6: `moduleResolution: "bundler"` instead of the deprecated `node10`, the unused deprecated `baseUrl`/`paths` removed, and `noUncheckedSideEffectImports: false` to keep TS 5's handling of side-effect CSS imports under CRA. Three type errors that TS 6 surfaces get fixed at their source. CRA stays (Vite is spec Step 6).

**Tech Stack:** TypeScript 6.0.3, CRA 5 (`react-scripts`), ts-jest 29 (peer `<7`), typescript-eslint 5 (unchanged here; Step 5 moves it to v8).

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 4)

**Probe already done (2026-11-12, `node:26-bookworm-slim`, clean `npm ci`):**
- Backend + `typescript@6.0.3`: `tsc --noEmit` 0 errors; sample jest suites pass.
- Frontend + `typescript@6.0.3`, unchanged tsconfig: `TS5107` (moduleResolution `node10` deprecated) and `TS5101` (`baseUrl` deprecated); CRA build fails `TS2882` (side-effect import `highlight.js/styles/atom-one-dark.css`, from TS 6's new default `noUncheckedSideEffectImports: true`); lint passes; `test:ci` 1025/1025.
- Frontend with `bundler` + no `baseUrl`/`paths` + `noUncheckedSideEffectImports: false`, three errors remain:
  1. `src/App.tsx:156` and `src/tests/routing/problemListRestoration.test.tsx:63` — `fallbackElement` is not a prop of react-router 7.18's `RouterProvider` (the v7 type definitions have no `fallbackElement` at all; `node10` resolution had been reading older-shaped types and hiding it).
  2. `src/tests/utils/mockIntersectionObserver.ts:15` — TS 6's `lib.dom.d.ts` adds `readonly scrollMargin: string` to `IntersectionObserver` (also fails under `node10`, so it is TS 6 itself).
- `@/…` path aliases are used nowhere in `src/` (0 files), so dropping `baseUrl`/`paths` changes no import.
- Pre-existing, not TS 6: `npm run type-check:tests:hooks` already fails on TS 5.5 with 5 × `toHaveStyle does not exist on JestMatchers` in `src/tests/hooks/useNavSlider.test.tsx` (the hooks tsconfig doesn't include `src/setupTests.ts`, which imports `@testing-library/jest-dom`). CI does not run that script.

## Global Constraints

- `typescript`: backend `^6.0.3`, frontend `6.0.3` (keep the frontend's existing exact-pin style). No other dependency changes. `--legacy-peer-deps` stays for the frontend (CRA peer).
- Fix only what TS 6 reports. Keep `strict` settings exactly as they are (`backend` strict, `frontend` `strict: false` with its explicit flags). No `ignoreDeprecations`, no `// @ts-ignore` / `@ts-expect-error`, no `any` casts to silence errors.
- No runtime behaviour change. The `fallbackElement` removal must be proven a no-op at runtime (Task 2).
- Commits: user is sole author — no `Co-Authored-By` trailer. Branch `chore/typescript-6` from latest `main`. Builder opens the PR and stops; the user merges.

## Review Focus

1. `moduleResolution: "bundler"` resolves some package's types differently and silently changes an inferred type that still compiles → Task 2 requires the full frontend `type-check`, all three `type-check:tests:*` scripts, the CRA build and `test:ci` (coverage thresholds) to pass, and the PR lists every source change.
2. Removing `fallbackElement` changes what users see while the router initialises → Task 2 Step 1 proves react-router 7.18's runtime never reads the prop.
3. The CRA production build (fork-ts-checker) disagrees with plain `tsc` → Task 2 runs the real CRA build with the CI env.
4. ts-jest on TS 6 changes backend test behaviour → Task 1 runs the full backend suite, Task 3 the integration stack.
5. A later edit re-adds `@/` imports that no longer resolve → covered by `type-check` failing (no extra test).

---

### Task 1: Backend on TypeScript 6

**Files:**
- Modify: `backend/package.json` (`typescript` → `^6.0.3`), `backend/package-lock.json` (via `npm install`)

- [ ] **Step 1:** `cd backend && npm install --no-audit --install-links -D typescript@^6.0.3` (in `node:26-bookworm-slim` or on a host with Node 26). `git diff --stat backend/package-lock.json` shows only TypeScript's entries changed.
- [ ] **Step 2:** `npx tsc -p tsconfig.json --noEmit` → 0 errors; `npx tsc -p tsconfig.test.json --noEmit` → 0 errors (record the baseline first on 5.9.3 if it is non-zero); `npm run build` → success.
- [ ] **Step 3:** Full backend suite as CI runs it (Node 26, non-root, CI apt packages): `npm test -- --ci` → 0 failed (baseline 1223 passed on Linux non-root; ts-jest must not warn about an unsupported TypeScript version — record its output).
- [ ] **Step 4: Commit** — `git commit -m "chore(backend): TypeScript 6.0"`

### Task 2: Frontend on TypeScript 6

**Files:**
- Modify: `frontend/package.json` (`typescript` → `6.0.3`), `frontend/package-lock.json`, `frontend/tsconfig.json`, `frontend/src/App.tsx:156`, `frontend/src/tests/routing/problemListRestoration.test.tsx:63`, `frontend/src/tests/utils/mockIntersectionObserver.ts`, `frontend/tsconfig.tests.hooks.json`

- [ ] **Step 1: Prove `fallbackElement` is dead at runtime.** In `node_modules/react-router` (7.18.x) and `node_modules/react-router-dom`, `grep -rn fallbackElement` over `dist/**/*.js` and `dist/**/*.mjs` → no matches (record the command and output). If any runtime code reads it, STOP and report NEEDS_CONTEXT instead of removing it.
- [ ] **Step 2: Bump and reconfigure.** `npm install --legacy-peer-deps --no-audit --install-links -D typescript@6.0.3` (exact). In `frontend/tsconfig.json`: `"moduleResolution": "bundler"`; delete `baseUrl` and `paths`; add `"noUncheckedSideEffectImports": false` with no other option changes. (JSON has no comments — explain the flag in the PR body: CRA/webpack resolves CSS side-effect imports; TS 6 cannot type-resolve them.)
- [ ] **Step 3: Run type-check, expect exactly the probed errors.** `npm run type-check` → the 3 errors listed above and nothing else. If the set differs, list the differences in the report before fixing.
- [ ] **Step 4: Fix at the source.**
  - Remove the `fallbackElement` prop at `src/App.tsx:156` and `src/tests/routing/problemListRestoration.test.tsx:63`. In the test, if any assertion relied on the "Loading list data…" text, report NEEDS_CONTEXT (the probe shows the suite passes, so none should).
  - Add `readonly scrollMargin = '0px';` to `MockIntersectionObserver` (matching how its other read-only fields are declared).
  - Pre-existing fix: add `"src/setupTests.ts"` to the `include` of `frontend/tsconfig.tests.hooks.json` so the jest-dom matcher types load.
- [ ] **Step 5: Everything green.** `npm run type-check`, `npm run type-check:tests:services`, `npm run type-check:tests:hooks`, `npm run type-check:tests:all` → 0 errors each; `npm run lint:check` → exit 0 (record whether typescript-eslint 5 prints an unsupported-TypeScript warning — Step 5 of the spec replaces it); `npm run test:ci` → 1025 passed and coverage thresholds met; CRA build with `REACT_APP_API_URL=/api DISABLE_ESLINT_PLUGIN=true INLINE_RUNTIME_CHUNK=false npm run build` → success, and `build/index.html` has no inline `<script>` without `src`.
- [ ] **Step 6: Commit** — `git commit -m "chore(frontend): TypeScript 6.0 with bundler module resolution"`

### Task 3: Verification and PR

- [ ] **Step 1: Integration stack** — `COMPOSE_PROJECT_NAME=oj-ts6 docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests` → 0 failed (baseline 125 suites; tests ≥ 1490), then `down -v`.
- [ ] **Step 2: Frontend build output check** — build `main` and this branch with CRA (same env, Node 26) and compare `build/static/js/*.js` sizes and the file list; a TypeScript bump should not change emitted JS (CRA transpiles with Babel). Report any difference; a difference only in `App`'s chunk from the removed prop is expected.
- [ ] **Step 3: Browser smoke** on a local stack (`COMPOSE_PROJECT_NAME=oj-ts6-smoke HTTP_PORT=8088 --env-file .env.example`): load, log in as a throwaway local admin, problems list, a problem page, admin panel, scoreboard — no console errors; first paint shows no blank or "Loading…" flash regression. Tear down with `down -v`.
- [ ] **Step 4: Push and open the PR** — branch `chore/typescript-6`, base `main`, title `chore: TypeScript 6.0 (step 4/9)`. Body: versions before/after; each tsconfig change and why; each source fix with the TS error it answers; the `fallbackElement` runtime proof; the pre-existing hooks type-check fix called out separately; test/build results; what is not verified. No Claude attribution footer. Stop for user review.
