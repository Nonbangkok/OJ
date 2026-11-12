# Upgrade Step 6 — CRA → Vite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Create React App (`react-scripts` 5) with Vite 8 for the dev server and production build, and with Jest 30 for tests. Users must see no difference, and the deployment contract stays the same: `REACT_APP_*` build args, output in `build/`, and a CSP with no inline scripts.

**Architecture:** Done in two moves so each has its own test cycle.
1. Jest 30 + Babel replaces `react-scripts test`. The config copies what CRA's `createJestConfig` did. CRA still builds at this point.
2. Vite replaces `react-scripts start/build`. `vite.config.mts` maps `process.env.REACT_APP_*` through `define`, so app source keeps reading `process.env.REACT_APP_API_URL` and Jest needs no `import.meta`.

`react-scripts` goes away, and with it `--legacy-peer-deps`, `DISABLE_ESLINT_PLUGIN` and `INLINE_RUNTIME_CHUNK`. The production build script type-checks and fails on inline scripts, so every build (local, CI, Docker) enforces the CSP rule.

**Tech Stack:** `vite` 8.3, `@vitejs/plugin-react` 6.3, `jest` / `jest-environment-jsdom` / `babel-jest` 30.5 (jsdom 26), `@babel/core` 8.1 with `preset-env` / `preset-react` / `preset-typescript` 8, `identity-obj-proxy` 3, `@types/node` 26.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 6). Reference only, do not cherry-pick: DraSoGo's `96266ce` (`frontend/vite.config.mts`, `frontend/index.html`, Jest/Babel config, Dockerfile, Playwright `webServer`).

**Probe already done (2026-11-12, `node:26-bookworm-slim`, from the code that is now `main`):**

*CRA baseline*
- Jest 27.5.1 / jsdom 16.7.0: 136 suites and 1025 tests pass.
- Coverage on `src/services/*.ts`: 90.34 statements, 90.9 branches, 86.95 functions, 90.71 lines.
- One run of the full suite under `--coverage` had 1 failure that did not repeat. A flaky test exists on `main`.
- CRA build output:
  - `build/index.html` loads `/static/js/main.*.js` (defer) and `/static/css/main.*.css`;
  - JS chunks 445, 453, 661;
  - `.map` files are emitted and served;
  - `<meta name="description" content="Web site created using create-react-app">`.

*Same configuration as this plan, run on the probe copy*
- Install: `npm ci` works without `--legacy-peer-deps`.
- Checks: `tsc` is 0, lint is 0, Jest has 136 suites with 1025 tests passed, and coverage is **identical** (90.34 / 90.9 / 86.95 / 90.71).
- Build: `vite build` takes about 3 s. It produces:
  - `build/index.html` with `<script type="module" crossorigin src="/assets/index-*.js">` and no inline script;
  - `assets/index-*.js` (1.64 MB, 464 kB gzip);
  - `web-vitals-*.js` and `statementPreview.worker-*.js`;
  - CSS 217 kB (CRA's was 229 kB; the minifier differs);
  - `public/` files copied to the root.
- Bundle contents: `/api` is baked in (`/api/users/${…}/avatar`). The `process.` references left are all guarded by `typeof process`.
- Runtime: served by `nginx:1.30-alpine` with `frontend/nginx.conf`'s CSP header, `/login` renders with no console errors.

*Problems the probe hit, and their fixes (carried into the tasks)*
1. **Babel 8 parses `.ts` generics as JSX** (`const openStream = <T>(…)` in `src/services/realtimeService.ts:45`) when `preset-react` applies to every file. Fix: apply `preset-react` only to `js|jsx|mjs|cjs|tsx`. The config must be a file: Jest serialises transform options as JSON, so RegExp `test`s inline become `{}`.
2. **jsdom 26 runs constraint validation before a submit-button click submits.** It cannot see files set through `fireEvent.change(…, { target: { files } })`. Removing `required` made all 15 `TestcaseFiles` tests pass, and `fireEvent.submit(form)` works, while `fireEvent.click` and `userEvent.upload` + click both fail. This breaks 8 tests:
   - `TestcaseFiles.test.tsx`: 7 tests, through the required file inputs in `TestcaseDialogs.tsx:125,152`;
   - `Login.test.tsx` "displays error on failed login": it clicks Login with both required fields empty, which a real browser also blocks.
3. **`@types/node` 18 → 26 (forced by Vite's peer `>=22.12`) removes `Array#at` / `String#at`.** @types/node ≤18 declared them through `RelativeIndexable`. This breaks `src/tests/features/admin/ProblemManagement.test.tsx:222` and `src/tests/pages/Problems.test.tsx:504`.
4. **Without `noUncheckedSideEffectImports: false`, `tsconfig.tests.hooks.json` fails with TS2882** on `highlight.js/styles/atom-one-dark.css` (`useCodeSubmission.ts:6`). Its `include` does not contain the `vite/client` reference file.
5. **A PostCSS warning appears during `vite build`:** "A PostCSS plugin did not pass the `from` option". There is no postcss config in the repo. Its source is not yet identified.

## Global Constraints

- **Users can tell nothing changed.** That covers pages, flows, the CSP (`script-src 'self'`, no `unsafe-inline`) and API URLs (spec anti-goals).
- **Deployment contract unchanged.**
  - Compose/CI build-arg names stay `REACT_APP_API_URL` and `REACT_APP_LARGE_UPLOAD_API_URL`. `tests/composeConfig.test.mjs` passes unchanged.
  - Output dir stays `frontend/build/`.
  - App source keeps reading `process.env.REACT_APP_API_URL` and `process.env.REACT_APP_LARGE_UPLOAD_API_URL`. Vite `define` supplies them.
- **Env meaning:**
  - `REACT_APP_API_URL` set, including to `""`: used as is.
  - `REACT_APP_API_URL` fully unset: defaults to `'/api'`. Under CRA it was `undefined`, but compose always passes `/api`, and the Docker `ENV` line always sets it, possibly to `""`.
  - `REACT_APP_LARGE_UPLOAD_API_URL` unset: stays `undefined`. Set: used as is.
  - Values are read with `loadEnv(mode, process.cwd(), 'REACT_APP_')`, so process env wins over `.env*` files, as in CRA.
- **No inline `<script>` in `build/index.html`.** No `@vitejs/plugin-legacy`.
  - `build.target`: `['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88']` (spec).
  - `build.sourcemap: true`, matching CRA, which emitted and served maps.
  - `build.outDir: 'build'`, `emptyOutDir: true`.
- **`index.html` is CRA's `public/index.html` with three changes only:**
  - the `%PUBLIC_URL%` prefixes become empty;
  - the HTML comments are dropped;
  - `<script type="module" src="/src/index.tsx"></script>` is added before `</body>`.

  Every meta and link stays verbatim, including the description text.
- **Dev server.**
  - Port `3000` (CRA's default).
  - Vite's default host (localhost only), not CRA's all-interfaces default.
  - Proxy `/api` → `http://localhost:8080` with `changeOrigin: true`.
  - No lint or type-check overlay in dev. Lint stays CLI/CI-only (`lint:check`, `validate`).
- **The production build fails on a TypeScript error**, as CRA's did. `build` = `tsc --noEmit && vite build && node scripts/check-no-inline-scripts.mjs`.
- **Tests: the same 1025 tests, the same coverage thresholds** (85% branches / 90% lines on `src/services/*.ts`, excluding `api.ts`). Every `tsconfig.tests.*.json` passes.
  - Test edits are limited to the 8 jsdom-26 adaptations (problem 2). They keep every assertion; none is removed or loosened.
  - Comments that name `react-scripts` are updated.
- **No `--legacy-peer-deps` anywhere** (Dockerfile, CI, docs). `npm ci` must pass without it and print no `ERESOLVE` warnings.
- **No other dependency majors.** Step 7 owns library majors such as `@testing-library/jest-dom` 7, React and the router. `@types/node` moves to `^26.6.6` only because Vite's peer requires `>=22.12`. It stays in `dependencies`, where it is today.
- **Commits.** The user is the sole author, with no `Co-Authored-By` trailer. Branch `build/vite` from the latest `main`. The builder opens the PR and stops; the user merges.

## Review Focus

1. **The production bundle reaches a code path that CRA's webpack handled and Vite does not.** Examples: the statement-preview Web Worker (`statementPreviewWorkerFactory.ts`, `new Worker(new URL(…, import.meta.url))`), the avatar `<img>` URLs, and lazy `web-vitals`. Task 3's browser smoke runs on the built Docker image behind `nginx-proxy/local.conf` with the CSP, and must open the authoring live preview, an avatar and a submission.
2. **The CSP blocks something at runtime** that the static `index.html` check does not cover, such as the worker or a `crossorigin` module script. Task 3 reads the console for CSP violations on every page it visits.
3. **A test passes for the wrong reason after the move.** Examples: it is no longer matched, `resetMocks` is dropped, CSS modules or images are mapped differently. Task 1 compares per-file test counts with CRA's JSON results (`old 1025 = new 1025`, same suites) and requires identical coverage numbers.
4. **The dev workflow breaks.** `npm start` must still proxy `/api` (including the SSE stream `/api/realtime/...`), and Playwright's `webServer` must reach `127.0.0.1:3100`. On macOS, Vite's `localhost` may bind `::1` only. Task 2 runs the dev server and curls through the proxy, and Task 3 runs the visual suite.
5. **CSS output differs visibly**, because a different minifier and ordering apply (217 kB vs 229 kB). Task 3 runs the visual regression suite before and after on macOS, plus the browser smoke. A real layout change is a bug, not a baseline update.

---

### Task 1: Jest 30 replaces `react-scripts test`

**Files:**
- Create: `frontend/jest.config.cjs`, `frontend/jest/babel.config.cjs`, `frontend/jest/cssTransform.cjs`, `frontend/jest/fileTransform.cjs`
- Modify: `frontend/package.json` (delete the `jest` key; `test`, `test:ci` scripts; devDependencies), `frontend/package-lock.json`, `frontend/src/features/admin/authoring/TestcaseFiles.test.tsx`, `frontend/src/tests/pages/Login.test.tsx`, and the 3 comments naming react-scripts in `src/tests/features/admin/ProblemManagement.test.tsx:59`, `src/tests/hooks/useContestScoreboard.test.ts:39`, `src/tests/hooks/useSubmissions.test.tsx:41`

**Interfaces:**
- Produces:
  - `npm test` runs `jest --watch`, the interactive watch mode CRA had.
  - `npm run test:ci` runs `jest --ci --coverage`.
  - `validate` is unchanged and still calls `test:ci`.

  Task 2 relies on these scripts.

- [ ] **Step 1: Baseline.** Work in a `git archive HEAD` temp copy (`frontend` + `shared`) on `node:26-bookworm-slim`.
  - Run `npm ci --legacy-peer-deps --no-audit --install-links`.
  - Run `CI=true npx react-scripts test --watchAll=false --coverage --json --outputFile=<scratch>/old-tests.json`.
  - Record the totals and the coverage "All files" row.
  - If one test fails, re-run. Record it as pre-existing flaky only if it passes on re-run.
- [ ] **Step 2: Dependencies.** In the temp copy, run `npm install --legacy-peer-deps --no-audit --install-links -D` with:
  - `jest@^30.5.2`
  - `jest-environment-jsdom@^30.5.2`
  - `babel-jest@^30.5.2`
  - `@babel/core@^8.1.2`
  - `@babel/preset-env@^8.0.7`
  - `@babel/preset-react@^8.0.1`
  - `@babel/preset-typescript@^8.0.7`
  - `identity-obj-proxy@^3.0.0`

  Copy back only `package.json` and `package-lock.json`. `react-scripts` stays in this task, because it still builds.
- [ ] **Step 3: Jest config.** Write `frontend/jest.config.cjs` reproducing CRA's effective config.
  - `roots: ['<rootDir>/src']`
  - `setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts']`
  - `testEnvironment: 'jsdom'`
  - `resetMocks: true`
  - `testMatch`: `'<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}'` and `'<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}'`
  - `moduleFileExtensions: ['js', 'ts', 'tsx', 'json', 'jsx', 'node']`
  - `transform`:
    - `'^.+\\.(js|jsx|mjs|cjs|ts|tsx)$'` → `['babel-jest', { configFile: path.join(__dirname, 'jest/babel.config.cjs') }]`
    - `'^.+\\.css$'` → `'<rootDir>/jest/cssTransform.cjs'`
    - `'^(?!.*\\.(js|jsx|mjs|cjs|ts|tsx|css|json)$)'` → `'<rootDir>/jest/fileTransform.cjs'`
  - `moduleNameMapper`: `'^.+\\.module\\.(css|sass|scss)$': 'identity-obj-proxy'`, plus today's three mappings from package.json, verbatim.
  - `transformIgnorePatterns`: today's single pattern from package.json, verbatim. CRA replaced its own patterns with this one.
  - `collectCoverageFrom` and `coverageThreshold`: today's values, verbatim.

  Support files:
  - `jest/babel.config.cjs`, with a header comment saying it is used only by Jest:
    - `presets: [['@babel/preset-env', { targets: { node: 'current' } }]]`
    - `overrides`:
      - `{ test: /\.(js|jsx|mjs|cjs|tsx)$/, presets: [['@babel/preset-react', { runtime: 'automatic' }]] }`
      - `{ test: /\.tsx?$/, presets: ['@babel/preset-typescript'] }`
  - `jest/cssTransform.cjs`: `process()` returns `{ code: 'module.exports = {};' }`. This is CRA's, adapted to Jest 30's object return.
  - `jest/fileTransform.cjs`: returns `` { code: `module.exports = ${JSON.stringify(path.basename(filename))};` } ``. There are no SVG imports in `src`, so CRA's SVG branch is not needed.

  Other edits:
  - Delete the `jest` key from `package.json`.
  - Scripts: `"test": "jest --watch"`, `"test:ci": "jest --ci --coverage"`.
  - Do **not** add `whatwg-fetch`, which CRA set up through `react-app-polyfill/jsdom`. `src` makes no `fetch(` calls. If a test fails on a missing `fetch`, add it to `setupFiles` and say so in the report.
- [ ] **Step 4: Run and expect exactly the probed jsdom-26 failures.** Run `npx jest --ci --coverage --json --outputFile=<scratch>/new-tests.json`. Expect exactly 8 failures: 7 in `TestcaseFiles.test.tsx` and Login "displays error on failed login". If anything else fails, list it in the report before changing anything.
- [ ] **Step 5: Adapt the 8 tests; keep every assertion.**
  - In `TestcaseFiles.test.tsx`, add this helper next to `selectFile`, with its comment:

    ```ts
    // jsdom validates required inputs before a submit-button click submits, but it cannot
    // see files set through fireEvent.change, so it would block the click. Mirror a browser
    // click instead: a disabled button does nothing, an enabled one submits its form.
    const clickSubmit = (button: HTMLElement) => {
      const { form } = button as HTMLButtonElement;
      if (!form) throw new Error('submit button is not inside a form');
      if (!button.matches(':disabled')) fireEvent.submit(form);
    };
    ```

    Replace `fireEvent.click(…)` with `clickSubmit(…)` only on the **Append testcase** and **Replace all from ZIP** buttons. There are 9 call sites, including the `button` variable in "failed append retains…". Leave the dialog **Confirm …** / **Cancel** / **Save replacement files** clicks unchanged.
  - In `Login.test.tsx` "displays error on failed login", fill username (`testuser`) and password (`wrong-password`) with `fireEvent.change` before the click, as the success test does.
  - Update the 3 "react-scripts sets resetMocks" comments to say `jest.config.cjs` sets `resetMocks`.
- [ ] **Step 6: Parity check.**
  - Run `npm run test:ci`: 136 suites and 1025 tests pass, and coverage meets the thresholds.
  - Compare the JSON per test file against `old-tests.json`: the same file set, and the same assertion count per file.
  - Coverage "All files" must equal the baseline (probe: 90.34 / 90.9 / 86.95 / 90.71). If any number differs, explain why in the report.
  - `npm run lint:check` exits 0 with 0 warnings.
  - `npm run type-check` and all 3 `type-check:tests:*` scripts give 0 errors.
- [ ] **Step 7: Commit.** `git commit -m "test(frontend): Jest 30 + Babel replaces react-scripts test"`

### Task 2: Vite replaces `react-scripts start/build`

**Files:**
- Create: `frontend/vite.config.mts`, `frontend/index.html`, `frontend/src/vite-env.d.ts`, `frontend/scripts/check-no-inline-scripts.mjs`
- Delete: `frontend/public/index.html`, `frontend/src/react-app-env.d.ts`
- Modify:
  - `frontend/package.json` and `frontend/package-lock.json`;
  - `frontend/tsconfig.json` and `frontend/tsconfig.tests.hooks.json`;
  - `frontend/playwright.config.ts`, `frontend/Dockerfile`, `.github/workflows/ci.yml`;
  - `frontend/src/index.tsx:20-22` (CRA-vitals comment) and `frontend/src/components/ErrorBoundary.tsx:15` ("CRA app");
  - docs: `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `.context/ARCHITECTURE.md`.

**Interfaces:**
- Consumes: Task 1's `test` / `test:ci` scripts.
- Produces:
  - `npm start` runs `vite`.
  - `npm run build` runs `tsc --noEmit && vite build && node scripts/check-no-inline-scripts.mjs`.
  - `scripts/check-no-inline-scripts.mjs [file]` defaults to `build/index.html`. Exit 0 means no inline script. Exit 1 prints each offending tag.

- [ ] **Step 1: Write the CSP guard first.** Create `frontend/scripts/check-no-inline-scripts.mjs`. It reads the HTML file and finds every `<script …>` opening tag (case-insensitive). It fails if a tag has no `src=` attribute, or if any element carries an inline `on<event>=` handler attribute.
  - Check that it exits 1 on CRA's current output, built with `INLINE_RUNTIME_CHUNK` unset. CRA then inlines its runtime chunk.
  - Check that it exits 0 on CRA's output built with `INLINE_RUNTIME_CHUNK=false`.

  Record both runs in the report.
- [ ] **Step 2: Dependencies.** In a temp copy:
  - Remove `react-scripts`.
  - `npm install --no-audit --install-links -D vite@^8.3.8 @vitejs/plugin-react@^6.3.0`
  - `npm install --no-audit --install-links @types/node@^26.6.6` (stays in `dependencies`).

  Then:
  - Delete the `proxy`, `browserslist` and `eject` entries from package.json. Nothing reads `browserslist` any more: Vite uses `build.target`, and the Jest Babel config sets explicit node targets.
  - Copy back package.json and the lockfile.
  - `rm -rf node_modules && npm ci --no-audit --install-links` must succeed with **no** `ERESOLVE` lines in its output.
- [ ] **Step 3: Vite config.** Write `frontend/vite.config.mts` with `defineConfig(({ mode }) => …)` and `plugins: [react()]`.
  - Env: read `loadEnv(mode, process.cwd(), 'REACT_APP_')`.
  - `define`:
    - `'process.env.REACT_APP_API_URL'`: `JSON.stringify(env.REACT_APP_API_URL ?? '/api')`.
    - `'process.env.REACT_APP_LARGE_UPLOAD_API_URL'`: the literal `'undefined'` when unset, otherwise `JSON.stringify(value)`.
    - Add a comment explaining why `define` is used and not `import.meta.env`: the source and Jest keep using `process.env`, and the compose build args keep their names.
  - `server`: `{ port: 3000, proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } } }`.
  - `build`: `{ outDir: 'build', emptyOutDir: true, sourcemap: true, target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88'] }`.

  `frontend/index.html` follows the Global Constraints rule; the probe's version is that file. Then:
  - Delete `public/index.html`. Otherwise Vite would copy it into `build/`.
  - Replace `src/react-app-env.d.ts` with `src/vite-env.d.ts` containing `/// <reference types="vite/client" />`.
- [ ] **Step 4: TypeScript config.**
  - In `tsconfig.json`:
    - delete `"noUncheckedSideEffectImports": false`;
    - set `"lib": ["DOM", "DOM.Iterable", "ES2020", "ES2022.Array", "ES2022.String"]`. These are exactly the `at()` methods that @types/node 18 used to supply. Do not raise `target`.
  - In `tsconfig.tests.hooks.json` `include`, add `"src/vite-env.d.ts"` after `"src/setupTests.ts"`.
  - Run `npm run type-check` and all 3 `type-check:tests:*` scripts: 0 errors each.
- [ ] **Step 5: Scripts and tooling.**
  - package.json:
    - `"start": "vite"`;
    - `"build": "tsc --noEmit && vite build && node scripts/check-no-inline-scripts.mjs"`.
  - `playwright.config.ts`: set `webServer.command` to `REACT_APP_API_URL=/api npm start -- --host 127.0.0.1 --port 3100 --strictPort`.
  - `frontend/Dockerfile`:
    - `RUN npm ci --no-audit --install-links`;
    - delete the CRA peer-deps comment, the `DISABLE_ESLINT_PLUGIN` block and the `INLINE_RUNTIME_CHUNK` block, with their comments;
    - keep both `ARG` and `ENV REACT_APP_*` lines;
    - add a one-line comment that `vite.config.mts` maps them, and that `npm run build` fails on inline scripts.
  - `.github/workflows/ci.yml` frontend job:
    - `npm ci --no-audit --install-links`;
    - the build step's `env` keeps only `REACT_APP_API_URL: /api`.
- [ ] **Step 6: Build and check.**
  - Run `REACT_APP_API_URL=/api npm run build`. It must exit 0, and the guard must pass.
  - `build/` contains `index.html`, `assets/`, and the `public/` files (`favicon.ico`, `logo192.png`, `logo512.png`, `manifest.json`, `robots.txt`).
  - `grep -o '/api/users/' build/assets/index-*.js` finds a match.
  - Every `process.` reference left in `build/assets/*.js` is guarded by `typeof process`. List them.
  - Find out which plugin prints the PostCSS "did not pass the `from` option" warning (problem 5) and record it. If it comes from Vite's own CSS pipeline or a dependency's CSS, accept it.
  - Run `REACT_APP_API_URL='' npm run build` and confirm that the bundle has avatar `src` beginning `/users/` (empty base). This matches the Docker build without the arg.
- [ ] **Step 7: Dev server.**
  - Start a stub upstream on 8080, for example a 10-line Node `http` server that echoes `req.url` and keeps an SSE response open on `/api/realtime/x`.
  - Run `REACT_APP_API_URL=/api npm start -- --strictPort`.
  - `curl http://localhost:3000/` returns the HTML with `/src/index.tsx`.
  - `curl http://localhost:3000/api/ping` reaches the stub at `/api/ping`. The path is not rewritten, because nginx strips `/api`.
  - `curl -N --max-time 3 http://localhost:3000/api/realtime/x` receives the stub's first SSE event before the timeout.
  - Stop both.
- [ ] **Step 8: Whole frontend suite.** Run `npm run validate`: type-check 0, lint 0, 1025 tests passed with thresholds met.
- [ ] **Step 9: Docs and comments.** Replace the CRA commands and wording with the Vite/Jest equivalents in each file:
  - `CLAUDE.md`, frontend section: Vite + Jest; `npm test` watch mode; `npm run test:ci` once; `npm start` on :3000 without lint or type errors, so run `validate`; the build type-checks and rejects inline scripts.
  - `CONTRIBUTING.md`, the equivalent section.
  - `README.md`, if it names CRA commands.
  - `.context/ARCHITECTURE.md:9,127`.
  - `src/index.tsx` CRA-vitals comment.
  - `ErrorBoundary.tsx:15`.

  Run `git grep -n "react-scripts\|INLINE_RUNTIME_CHUNK\|DISABLE_ESLINT_PLUGIN\|legacy-peer-deps\|Create React App"`. It must return nothing outside `docs/superpowers/` and the historical `.superpowers/sdd/2026-09-*` files.
- [ ] **Step 10: Commit.** `git commit -m "build(frontend): Vite 8 replaces react-scripts"`

### Task 3: Verification and PR

- [ ] **Step 1: CI-equivalent run.** Use a fresh `git archive HEAD` copy on `node:26-bookworm-slim`. Run `npm ci --no-audit --install-links`, then `npm run validate`, then `REACT_APP_API_URL=/api npm run build`. All must pass. Also run `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs` from the repo root.
- [ ] **Step 2: Integration stack.** Run `COMPOSE_PROJECT_NAME=oj-vite docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests`. It must report 0 failed; record the totals. Then `down -v`.
- [ ] **Step 3: Browser smoke behind the CSP.** Start a separate stack: `COMPOSE_PROJECT_NAME=oj-vite-smoke HTTP_PORT=8088 docker compose --env-file .env.example up --build -d`, then create a throwaway admin (`create_admin`, with delayed stdin).
  - Check that the response headers carry the CSP: `curl -sI http://localhost:8088/`.
  - In the built-in browser, visit each of these:
    - login;
    - problem list;
    - a problem page;
    - submit a C++ solution and see the verdict update;
    - submissions;
    - a contest scoreboard;
    - admin users, problems, contests and settings;
    - the authoring editor with its **live statement preview** (the Web Worker);
    - a user profile with an **avatar**.
  - Read the console after each page: no CSP violations, no `process is not defined`, no failed asset loads.
  - Compare first paint against `main`'s image on the same pages, by screenshots side by side.
  - Tear down with `down -v`.
- [ ] **Step 4: Visual regression (macOS host, not CI).** Use Node 25+ on the host, and fresh `npm ci` in temp worktrees of `main` and of this branch.
  - Run `npm run test:visual` on `main` first and record the result. If `main` already fails, record that as the baseline state.
  - Then run it on this branch.
  - Any pixel diff gets manual review. A diff that comes only from font rasterisation or CSS ordering may be accepted, with before/after images in the PR, and `test:visual:update` is then run on this branch. A layout change is a bug: fix it, do not update the baseline.
- [ ] **Step 5: Bundle summary.** Compare the `build/` file lists and sizes of `main` (CRA) and this branch (Vite): JS total, CSS, chunk count, and source maps present. Record the table for the PR. Differences are expected; only missing public files or a missing worker are defects.
- [ ] **Step 6: Push and open the PR.** Branch `build/vite`, base `main`, title `build: Vite 8 + Jest 30 replace Create React App (step 6/9)`. The body lists:
  - versions before and after;
  - every Global Constraints decision with its reason:
    - the env mapping and the `/api` default when unset;
    - sourcemaps kept;
    - `build.target`, and that old browsers which only worked through CRA's heavier transpilation are dropped;
    - dev server on localhost:3000 with no lint or type overlay;
    - the build type-checks and runs the CSP guard;
    - `@types/node` 26 and the `lib` additions;
  - the 8 test adaptations and why jsdom 26 needs them (with the "remove `required` → all pass" experiment);
  - the bundle table;
  - the visual and smoke results;
  - the flaky test on `main`, if seen;
  - what was not verified.

  No Claude attribution footer. Stop for user review.
