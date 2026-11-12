# Upgrade Step 7 — Frontend Library Majors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every frontend runtime and test library to its current release, changing code only where a breaking change forces it. Users must see no difference.

**Architecture:** Done in two moves.
1. **Drop-in bumps.** These need no code change, except the 5-line `reportWebVitals.ts` rename.
2. **The `react-resizable-panels` 2→4 rewrite** of the one component that uses it (`StatementEditor.tsx`). It goes in its own task and commit, because v4 changed the component names, the size units and layout persistence.

`ajv`, `ajv-formats` and `ajv-keywords` are removed rather than bumped. Nothing imports them now that CRA is gone.

**Tech Stack (after):**
- `react` / `react-dom` 19.3.1
- `react-router-dom` 7.18.5
- `axios` 1.21.1
- `highlight.js` 11.12.0
- `react-resizable-panels` 4.21.0
- `react-datepicker` 9.1.0
- `date-fns` 4.4.0
- `web-vitals` 6.2.3
- `@testing-library/jest-dom` 7.0.1, `@testing-library/dom` 10.4.2, `@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.10
- `@playwright/test` 1.65.0
- `prettier` 3.10.1

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 7)

**Probe already done (2026-11-12, `node:26-bookworm-slim`, from the current `main`):**
- **Installing all of the above** without `--legacy-peer-deps` raises no ERESOLVE. `npm outdated` then lists only the packages held on purpose:
  - `eslint` / `@eslint/js` 10: spec constraint — the plugins peer `^9`;
  - `typescript` 7: spec constraint — typescript-eslint peers `<6.1`;
  - `@babel/*` 8: Step 6 ruling — Jest 30's own plugins peer `@babel/core ^7`.
- **Errors, all from two libraries:**
  - `react-resizable-panels` 4: `StatementEditor.tsx:4` imports `PanelGroup`, `PanelResizeHandle` and `ImperativePanelGroupHandle`, which no longer exist. This causes 12 test failures in 2 suites, all "Element type is invalid … got: undefined" while rendering `StatementEditor`.
  - `web-vitals` 6: `reportWebVitals.ts:3` uses `getCLS`, `getFID`, `getFCP`, `getLCP` and `getTTFB`, which no longer exist.
- **Everything else passes unchanged.** That covers `react-datepicker` 9, `date-fns` 4, `jest-dom` 7 and React 19.3: lint is 0, every other suite passes, and coverage is identical (90.34 / 90.9 / 86.95 / 90.71).
- **react-datepicker 9:**
  - It depends on `date-fns ^4.1` and `@floating-ui/react`. Its peer `date-fns-tz` is optional, and jest-dom 7's peer `vitest` is optional.
  - Every class name the dark-theme overrides in `src/index.css:472-510` target still exists in its CSS: `__header`, `__current-month`, `__day-name`, `-time__header`, `__day--selected`, `__day--keyboard-selected`.
- **`ajv`, `ajv-formats`, `ajv-keywords`:**
  - No file under `frontend/` imports them (`git grep`).
  - `npm ls` shows no package depending on them except ESLint's own `ajv@6`, which is separate.
  - They came in with commit `2b5f9f7` (2026-06), the usual CRA workaround for `ajv/dist/compile/codegen`.
- **`date-fns`:** `src` does not import it directly. It is react-datepicker's own dependency. It stays a direct dependency at `^4.4.0`, because the spec lists it and that pins the copy react-datepicker resolves to.
- **`react-resizable-panels` v4 API (from its `.d.ts`):**
  - `PanelGroup` → `Group` (`orientation` replaces `direction`; `groupRef` replaces `ref`).
  - `PanelResizeHandle` → `Separator` (`role="separator"`; a built-in double-click behaviour is switched off with `disableDoubleClick`).
  - The handle comes from `useGroupRef()`, and `setLayout` takes a `Layout` object keyed by **panel id** (`{ [id]: percent }`).
  - Panel `defaultSize` / `minSize`: **a number now means pixels**, and a unitless string means percent (`"50"`). Passing today's `50` / `25` unchanged would silently turn into 50 px / 25 px.
  - `autoSaveId` is gone. Persistence moves to `useDefaultLayout({ id, storage })` → `{ defaultLayout, onLayoutChanged }`. The storage key format differs, so a layout a user saved under v2 is ignored once and the split falls back to 50/50.

## Global Constraints

- **Users can tell nothing changed.** The statement editor keeps:
  - its 50/50 default split and the 25% minimum per pane;
  - drag to resize;
  - double-click on the divider to reset to 50/50;
  - the per-draft remembered layout;
  - vertical stacking when `useCompactEditorLayout()` is true;
  - the divider's accessible name "Resize source and preview panes" and its CSS hooks (`styles.editorWorkspace`, `sourcePane`, `previewPane`, `editorResizeHandle`, plus `:hover` / `:focus-visible`).

  The contest date picker looks the same in light and dark themes.
- **Code changes only where a breaking change forces them:** `StatementEditor.tsx`, and `reportWebVitals.ts` (renamed functions). `index.tsx` still calls `reportWebVitals()` with no callback, so nothing runs, exactly as today.
- **Tests:** the same 1025 tests and the same coverage thresholds.
  - Test files may only be touched if the v4 DOM forces it (for example a query for a v2-only attribute). Every assertion stays.
  - If jsdom lacks an API v4 needs (for example `ResizeObserver`), add a minimal no-op shim in `src/setupTests.ts` with a comment, not in individual tests.
- **Held versions:** `eslint` / `@eslint/js` stay on 9, `typescript` on 6.0.3, `@babel/*` on 7.29. `@types/react` and `@types/react-dom` are already on the latest (19.3.0, exact pins kept). The spec's "`@types/node` to match Node 26" was done in Step 6 (`^26.6.6`).
- **Deviation from the spec:** the spec lists `ajv-formats` 2→3. This plan removes `ajv`, `ajv-formats` and `ajv-keywords` instead, because nothing uses them (see the probe). The user reviews this plan before it runs.
- **Install rules:** `npm ci` passes with no `--legacy-peer-deps` and prints no ERESOLVE. Keep the existing `package.json` key order and pin style: the exact pins stay exact, the carets stay carets.
- **Commits:** the user is the sole author, with no `Co-Authored-By` trailer. Branch `chore/frontend-libs` from the latest `main`. The builder opens the PR and stops; the user merges.

## Review Focus

1. **v4 numeric sizes are pixels.** A `defaultSize={50}` that survives the migration renders a 50 px pane. Task 2's test checks the rendered `flex-basis` / size attribute of both panels on first render.
2. **The double-click reset or the persisted layout silently stops working.** v4 keys `setLayout` by panel id, and a missing `id` makes it a no-op. Task 2 tests the double-click reset, and checks that `useDefaultLayout` writes to and reads from `localStorage`.
3. **Compact (vertical) mode breaks.** `orientation` must follow `useCompactEditorLayout()`. The task 3 smoke test resizes the browser below the compact breakpoint.
4. **The date picker's dark theme loses its overrides** if v9 changed the DOM structure (for example portal or popper wrappers). Task 3 opens the contest modal date picker in both themes and compares screenshots with `main`.
5. **jest-dom 7 changes a matcher's semantics without failing** (e.g. `toHaveStyle`, `toBeVisible`). Task 1 compares the per-file assertion counts and the coverage row with `main`'s, and the suite must stay at 1025.

---

### Task 1: Drop-in bumps, `web-vitals` rename, unused `ajv` removal

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/reportWebVitals.ts`

- [ ] **Step 1: Baseline.** In a `git archive HEAD frontend shared` temp copy on `node:26-bookworm-slim`, run `npm ci --no-audit --install-links`, then `npx jest --ci --coverage --json --outputFile=<scratch>/old-tests.json`. Record the totals and the coverage row.
- [ ] **Step 2: Dependencies.** In the temp copy:
  - `npm uninstall --no-audit --install-links ajv ajv-formats ajv-keywords`.
  - Install these `dependencies` with `--no-audit --install-links`, keeping each spec's caret:
    - `react@^19.3.1`, `react-dom@^19.3.1`
    - `react-router-dom@^7.18.5`
    - `axios@^1.21.1`
    - `highlight.js@^11.12.0`
    - `react-datepicker@^9.1.0`
    - `date-fns@^4.4.0`
    - `web-vitals@^6.2.3`
    - `@testing-library/jest-dom@^7.0.1`, `@testing-library/dom@^10.4.2`, `@testing-library/react@^16.3.3`
  - Install these devDependencies with `-D`: `@playwright/test@^1.65.0`, `@testing-library/user-event@^14.6.10`, `prettier@^3.10.1`.
  - Do **not** touch `react-resizable-panels` here.
  - Copy back only `package.json` and `package-lock.json`. Restore any key order npm changed, and check `git diff frontend/package.json`.
  - `npm ci --no-audit --install-links` must print no `ERESOLVE`.
- [ ] **Step 3: `reportWebVitals.ts`.**
  - Keep the signature `(onPerfEntry?: (metric: unknown) => void) => void` and the dynamic `import('web-vitals')`.
  - Call `onCLS`, `onINP`, `onFCP`, `onLCP` and `onTTFB`. `onINP` is web-vitals' replacement for the removed FID metric.
  - Add a one-line comment saying FID was removed upstream in v5 and INP replaces it.
- [ ] **Step 4: Verify.**
  - `npm run type-check` and the 3 `type-check:tests:*` scripts give 0 errors, and `npm run lint:check` gives 0.
  - `npx jest --ci --coverage --json --outputFile=<scratch>/new-tests.json`: 1025 passed. Compare per file against `old-tests.json` (same files, same assertion counts), and the coverage row must be identical.
  - `REACT_APP_API_URL=/api npm run build` passes, including the CSP guard.
  - `git grep -n "ajv" frontend -- ':!frontend/package-lock.json'` returns nothing.
- [ ] **Step 5: Commit.** `git commit -m "chore(frontend): bump runtime/test libraries; drop unused ajv packages"`

### Task 2: `react-resizable-panels` 2 → 4 in `StatementEditor`

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/features/admin/authoring/StatementEditor.tsx`
- Modify (only if v4 forces it): `frontend/src/features/admin/authoring/StatementEditor.test.tsx`, `frontend/src/setupTests.ts`
- Possibly modify: `frontend/src/features/admin/authoring/Authoring.module.css`, only if v4's DOM breaks an existing rule.

**Interfaces:**
- Consumes: Task 1's lockfile.
- Produces: no new exports. `StatementEditor`'s props are unchanged.

- [ ] **Step 1: Write the failing tests** in `StatementEditor.test.tsx`. They are new tests pinning today's behaviour, so the migration has a target. Run them on v2 first, where they must pass, then upgrade.
  - `statement editor splits source and preview 50/50 by default`: both panels report 50% on first render. Read it from the size v4 exposes on the panel element (`data-panel-size` or `flex-basis`/`flex-grow` style — record which one in the report) **and** the v2 equivalent, so the test passes on both. If no attribute is common to both, assert on the `aria-valuenow` of the `separator` role (50).
  - `double-clicking the pane divider resets the split to 50/50`: drive the layout away from 50/50 with the keyboard on the separator (`ArrowRight` / `ArrowDown`, which both versions support). Then `fireEvent.doubleClick(separator)` and assert the value is back to 50.
  - `divider keeps its accessible name`: `getByRole('separator', { name: 'Resize source and preview panes' })`.
- [ ] **Step 2: Upgrade.** In a temp copy, run `npm install --no-audit --install-links react-resizable-panels@^4.21.0`. Copy back `package.json` and the lockfile.
- [ ] **Step 3: Migrate `StatementEditor.tsx`** to `import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from 'react-resizable-panels'`:
  - `const panels = useGroupRef();`
  - Persistence:
    - `const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: \`oj-authoring-statement-layout:${id}\`, storage: localStorage });`
    - `localStorage` may throw (private mode): guard it the way the file's existing `writeRecovery` does (a try/catch adapter object passed as `storage`), so the editor never crashes on storage.
  - `<Group groupRef={panels} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} orientation={compactLayout ? 'vertical' : 'horizontal'} className={styles.editorWorkspace} role="region" aria-label="Statement editor">`
  - The panels:
    - `<Panel id="source" defaultSize="50" minSize="25" className={styles.sourcePane}>`
    - `<Panel id="preview" defaultSize="50" minSize="25" className={styles.previewPane}>`
    - The sizes are **strings**, meaning percent.
  - `<Separator className={styles.editorResizeHandle} aria-label="Resize source and preview panes" disableDoubleClick onDoubleClick={() => panels.current?.setLayout({ source: 50, preview: 50 })} />`
    - `disableDoubleClick` turns off v4's own double-click handling, so the one reset behaviour stays ours.
    - If v4's built-in double-click already resets to the default layout, report it and keep the explicit handler anyway.
- [ ] **Step 4: Run** `npx jest src/features/admin/authoring` and the full `npm run test:ci`.
  - Expect the 3 new tests and all previously passing tests to pass: 1025 + 3 = 1028.
  - If jsdom lacks an API v4 uses, add the shim per the Global Constraints, and say which API in the report.
  - `npm run type-check`, `lint:check` and the build all pass.
- [ ] **Step 5: Commit.** `git commit -m "chore(frontend): react-resizable-panels 4 in the statement editor"`

### Task 3: Verification and PR

- [ ] **Step 1: CI-equivalent run.** In a fresh `git archive HEAD` copy on `node:26-bookworm-slim`:
  - `npm ci --no-audit --install-links` (no ERESOLVE);
  - `npm run validate`;
  - `REACT_APP_API_URL=/api npm run build`;
  - from the repo root, `node --test tests/*.test.mjs`, which needs the real checkout for `git ls-files`.
- [ ] **Step 2: Browser smoke** (controller, built-in browser).
  - Start a separate stack: `COMPOSE_PROJECT_NAME=oj-libs-smoke HTTP_PORT=8088 docker compose --env-file .env.example up --build -d`, then create a throwaway admin.
  - Check these pages, with no console errors:
    - login, problem list, problem page, submit → verdict;
    - admin contests → **New Contest modal: open both date pickers, pick a date and time, in light and dark theme**, and compare with `main`'s image screenshots;
    - authoring → a draft → full-screen statement editor:
      - default split 50/50;
      - drag the divider;
      - reload: the split is remembered;
      - double-click: back to 50/50;
      - narrow the viewport below the compact breakpoint: panes stack vertically;
      - live preview still renders.

  Tear down with `down -v`.
- [ ] **Step 3: Visual regression** (macOS host, `npm run test:visual`). Main currently fails the same 3 of 4 tests (stale fixtures, recorded in PR #11). The branch must show the same failures with the same pixel counts, and nothing new.
- [ ] **Step 4: Push and open the PR.**
  - Branch `chore/frontend-libs`, base `main`, title `chore(frontend): library majors — resizable-panels 4, datepicker 9, date-fns 4, web-vitals 6, jest-dom 7 (step 7/9)`.
  - The body lists:
    - versions before and after;
    - what was held and why;
    - the `ajv` removal, with its evidence;
    - the StatementEditor migration (string-percent sizes, id-keyed layout, a saved layout resetting once);
    - the web-vitals FID→INP note;
    - test and coverage results;
    - the smoke and visual results;
    - what was not verified.
  - No Claude attribution footer. Recommend squash-merge.
  - Stop for user review.
