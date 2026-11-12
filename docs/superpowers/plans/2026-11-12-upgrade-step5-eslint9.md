# Upgrade Step 5 — ESLint 9 Flat Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the frontend linter to ESLint 9 with a flat config and typescript-eslint 8, keeping today's effective rule set, with no source behaviour change.

**Architecture:** Replace `frontend/.eslintrc.json` with `frontend/eslint.config.mjs` built from each plugin's flat preset plus today's overrides. Keep `eslint-plugin-react-hooks` at today's two rules; the v7 React Compiler rules are off and listed as a follow-up. Map each removed or renamed typescript-eslint rule to its v8 successor with the same setting. CRA's built-in ESLint 8 webpack plugin is disabled in the `start`/`build` scripts (CI and Docker already do this), because it cannot read a flat config.

**Tech Stack:** ESLint 9.39, `@eslint/js` 9, `typescript-eslint` 8.72 (meta package, replaces `@typescript-eslint/parser` + `eslint-plugin` 5.62), `eslint-plugin-react-hooks` 7.1, `eslint-plugin-react` 7.37, `eslint-plugin-jsx-a11y` 6.10, `eslint-config-prettier` 10.1, `globals`.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 5)

**Probe already done (2026-11-12):** on `node:26-bookworm-slim`, from the code that is now `main`, a direct flat-config translation of `.eslintrc.json` (all presets at `recommended`) gives 76 errors and 3 warnings:
- 74 errors from react-hooks v7's new React Compiler rules: `set-state-in-effect` 38, `refs` 31, `immutability` 2, `preserve-manual-memoization` 2, `use-memo` 1.
- 2 × `@typescript-eslint/no-empty-object-type` in `src/types/service.ts:85,94`. These are empty interfaces extending a supertype. Today `no-empty-interface` is off, and `no-empty-object-type` is its v8 successor.
- 3 × "Unused eslint-disable directive (react-hooks/exhaustive-deps)" warnings, at `src/features/admin/authoring/useTestcaseFiles.ts:143`, `src/hooks/admin/useAdminProblemsPage.ts:176` and `src/hooks/useNavSlider.ts:127`. ESLint 9 reports unused directives by default.
- With `.eslintrc.json` gone, the CRA build without `DISABLE_ESLINT_PLUGIN` fails. CRA's bundled ESLint 8 + `react-app` config no longer loads `jsx-a11y`, so the existing `eslint-disable … jsx-a11y/*` comments (`Dialog.tsx:93`, `Drawer.tsx:77`, …) reference unknown rules. CI (`ci.yml:70`) and the frontend Dockerfile (`:28`) already set `DISABLE_ESLINT_PLUGIN=true`; local `npm start` / `npm run build` do not.

## Global Constraints

- The effective rule set stays the same. Every rule that is on today stays on at the same severity, or is replaced by its documented v8 successor with an equivalent setting. Any rule the new presets add is either kept (if it has 0 findings) or listed in the PR.
- react-hooks: exactly `rules-of-hooks: "error"` and `exhaustive-deps: "warn"` (today's v4 `recommended`). All v7 React Compiler rules are off and named in the PR as a follow-up. They are not fixed here (spec: refactors are out of scope).
- Source edits are limited to removing the 3 unused `eslint-disable` directives that ESLint reports. Keep every other `eslint-disable` comment.
- `eslint-plugin-import` stays installed and unconfigured (spec). Bump it and `eslint-import-resolver-typescript` to their current versions.
- `--legacy-peer-deps` stays (CRA, spec Step 6). Prettier is unchanged.
- Commits: the user is the sole author, with no `Co-Authored-By` trailer. Branch `chore/eslint-9` from latest `main`. The builder opens the PR and stops; the user merges.

## Review Focus

1. **A rule silently drops out in the migration**, for example a v5 preset rule with no v8 equivalent, or a preset that no longer includes something. Task 1 Step 1 and Step 6 compare the effective rule maps old vs new and account for every difference.
2. **Local `npm start` / `npm run build` stop working** because of CRA's internal ESLint. Task 1 Step 7 runs both without an outer `DISABLE_ESLINT_PLUGIN`.
3. **Lint passes because files are no longer matched.** For example, flat config `files` globs miss `.tsx` or test files. Step 6 asserts the linted file count equals the old run's.
4. **`lint`/`lint:check` scripts break under ESLint 9 CLI changes**, such as `--ext`. Step 5 runs both scripts.
5. **The React Compiler rules are forgotten.** The PR body lists them with their counts as a follow-up.

---

### Task 1: ESLint 9 flat config

**Files:**
- Create: `frontend/eslint.config.mjs`
- Delete: `frontend/.eslintrc.json`
- Modify: `frontend/package.json` (devDependencies; `lint`, `lint:check`, `start`, `build` scripts), `frontend/package-lock.json`, the 3 files with unused directives listed above

- [ ] **Step 1: Baseline on today's config.** Work in a temp copy, inside `node:26-bookworm-slim`, after `npm ci --legacy-peer-deps --no-audit --install-links`. Record:
  - `npx eslint --print-config src/App.tsx` → the `rules` map, saved as `old-rules-tsx.json`;
  - the same for a test file, `src/tests/routing/problemListRestoration.test.tsx` → `old-rules-test.json`;
  - `npx eslint src --ext .ts,.tsx -f json` → number of files linted, total errors and total warnings.
- [ ] **Step 2: Dependencies.**
  - Remove `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`.
  - Install, at these versions:
    - `eslint@^9.39.5`
    - `@eslint/js@^9.39.5`
    - `typescript-eslint@^8.72.2`
    - `eslint-plugin-react-hooks@^7.1.1`
    - `eslint-config-prettier@^10.1.8`
    - `globals@^17.14.0`
    - `eslint-plugin-react@^7.37.5`
    - `eslint-plugin-jsx-a11y@^6.10.2`
    - `eslint-plugin-import@latest`
    - `eslint-import-resolver-typescript@latest`
  - Use `npm install --legacy-peer-deps --no-audit --install-links -D …` in the temp copy. Copy back only `package.json` and `package-lock.json`.
  - Check that `npm ci --legacy-peer-deps` succeeds on the result.
- [ ] **Step 3: Write `frontend/eslint.config.mjs`** (ESM, `tseslint.config(...)`), in this order:
  1. `ignores`: `build/**`, `coverage/**`, `node_modules/**`.
  2. `js.configs.recommended`.
  3. `...tseslint.configs.recommended`.
  4. `react.configs.flat.recommended`.
  5. `jsxA11y.flatConfigs.recommended`.
  6. A react-hooks block that registers the plugin and enables only `rules-of-hooks: 'error'` and `exhaustive-deps: 'warn'`.
  7. `eslint-config-prettier` (last of the presets).
  8. A `files: ['src/**/*.{ts,tsx}']` block with:
     - `languageOptions.globals`: `globals.browser`, `globals.jest` and `globals.es2021` (from `env`);
     - `settings.react.version: 'detect'`;
     - today's `rules` overrides, carried over unchanged, with these v8 renames:
       - `@typescript-eslint/no-var-requires: off` becomes `@typescript-eslint/no-require-imports: 'off'`;
       - `@typescript-eslint/no-empty-interface: off` becomes `@typescript-eslint/no-empty-object-type: ['error', { allowInterfaces: 'always' }]`. This allows empty interfaces as today, and still bans the `{}` type literal, which v5's `ban-types` banned.

  Delete `.eslintrc.json`.
- [ ] **Step 4: Scripts.**
  - `lint`: `eslint src --fix`.
  - `lint:check`: `eslint src`. File matching now lives in the config.
  - `start`: `DISABLE_ESLINT_PLUGIN=true react-scripts start`.
  - `build`: `DISABLE_ESLINT_PLUGIN=true react-scripts build`.
  - Leave `validate` and the rest unchanged.
- [ ] **Step 5: Lint.** Run `npm run lint:check`. Expect exactly the 3 unused-directive warnings and 0 errors. If anything else appears, list it in the report before changing anything. Then delete only those 3 `// eslint-disable-next-line react-hooks/exhaustive-deps` lines, and re-run `npm run lint:check`: exit 0, 0 errors, and 0 warnings beyond the baseline's. Also run `npm run lint` on a clean tree: `git status` shows no changes.
- [ ] **Step 6: Rule parity.**
  - Produce `new-rules-tsx.json` and `new-rules-test.json` with `npx eslint --print-config` for the same two files.
  - Write a table of every rule whose severity or options differ, plus every rule present in only one of the two. For each row:
    - a v8/v9 successor that keeps today's behaviour; or
    - a preset addition with 0 findings (kept on); or
    - a deliberate change, with its reason (the react-hooks Compiler rules being off is the expected one).
  - The `-f json` run must lint the same number of files as the baseline.
- [ ] **Step 7: Nothing else regressed.**
  - `npm run validate` → type-check 0 errors, lint:check exit 0, test:ci 1025 passed with coverage thresholds.
  - `npm run build`, without exporting `DISABLE_ESLINT_PLUGIN` yourself → success, and `build/index.html` has no inline `<script>` without `src`.
  - `BROWSER=none PORT=3100 timeout 120 npm start` → output contains "Compiled successfully" or "compiled" with no ESLint errors.
- [ ] **Step 8: Commit.** `git commit -m "chore(frontend): ESLint 9 flat config with typescript-eslint 8"`

### Task 2: Verification and PR

- [ ] **Step 1: CI-equivalent run.** In a fresh `git archive HEAD` copy on `node:26-bookworm-slim`, run what CI's frontend job runs:
  - `npm ci --legacy-peer-deps --no-audit --install-links`
  - `npm run validate`
  - `REACT_APP_API_URL=/api DISABLE_ESLINT_PLUGIN=true INLINE_RUNTIME_CHUNK=false npm run build`

  All must pass.
- [ ] **Step 2: Build output unchanged.** A lint-only change must not change the bundle. Compare the CRA build of `main` and of this branch: every non-map file under `build/` must be byte-identical.
- [ ] **Step 3: Push and open the PR.**
  - Branch `chore/eslint-9`, base `main`, title `chore: ESLint 9 flat config + typescript-eslint 8 (step 5/9)`.
  - The body lists:
    - versions before/after;
    - the rule-parity table;
    - the React Compiler rules turned off, with their counts (`set-state-in-effect` 38, `refs` 31, `immutability` 2, `preserve-manual-memoization` 2, `use-memo` 1), as a proposed follow-up;
    - the 3 removed directives;
    - why `start`/`build` now set `DISABLE_ESLINT_PLUGIN` (temporary until Vite, step 6);
    - verification results;
    - what is not verified.
  - No Claude attribution footer.
  - Stop for user review.
