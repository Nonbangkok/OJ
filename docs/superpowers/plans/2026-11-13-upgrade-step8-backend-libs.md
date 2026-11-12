# Upgrade Step 8 — Backend Library Majors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every backend library to its current release, changing code only where a breaking change forces it. Users, judges, contests, uploads and statement/PDF output must behave exactly as before.

**Architecture:** Three moves, each with its own test cycle.
1. **Drop-in bumps and dead-dependency removal.** No code changes.
2. **`node-cron` 3 → 4.** The `scheduled` option is gone and node-cron now ships its own types.
3. **`archiver` 7 → 8.** It is ESM-only and has a new class API. Node 26 `require()`s ESM natively in production; Jest needs `--experimental-vm-modules` to do the same.

**Tech Stack (after):**
- Changed majors:
  - `node-cron` 4.6.0
  - `archiver` 8.0.0 (with `@types/archiver` 8.0.0)
  - `connect-pg-simple` 10.0.0
  - `sharp` 0.35.5
  - `dotenv` 18.0.10
  - `@types/node` 26.6.6
- Minor and patch bumps:
  - `express` 5.3.0, `express-rate-limit` 8.7.4, `multer` 2.5.0
  - `pg` 8.23.1, `zod` 4.6.7, `unzipper` 0.12.5
  - `jest` 30.5.2, `ts-jest` 29.4.15, `supertest` 7.3.2, `tsx` 4.23.15
  - `@types/multer` 2.3.0, `@types/pg` 8.23.1, `@types/supertest` 7.2.1
- Removed: `express-sse`, `uuid`, `@types/uuid`, `@types/node-cron`.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 8, Constraints "Frozen by user decision")

**Probe already done (2026-11-13, `node:26-bookworm-slim` plus CI's apt packages, non-root, from the current `main`):**
- **Install and freeze check.**
  - Installing everything above prints no ERESOLVE. `npm outdated` then lists only the two packages held on purpose: `htmlparser2` 12 (frozen) and `typescript` 7 (spec constraint).
  - The lockfile entries for the frozen libraries, and for everything the authoring runner copies (`htmlparser2`, `katex`, `marked`, `domhandler`, `domutils`, `dom-serializer`, `domelementtype`, `entities`), are **byte-identical** before and after. The only nested copy is the existing `dom-serializer/node_modules/entities`.
- **Bisect: only two upgrades break anything.** Every other bump keeps `tsc -p tsconfig.json` at 0 errors.
  1. `node-cron` 4: `services/contestScheduler.ts:53` errors with TS2353, because `scheduled` is no longer an option.
  2. `archiver` 8 + `@types/archiver` 8, which are ESM (`"type": "module"`):
     - **New API:** the default `archiver(format, opts)` is gone. The exports are `Archiver`, `ZipArchive`, `TarArchive` and `JsonArchive`.
     - **Type errors:** TS2349 "not callable" at `controllers/problemController.ts:577` and in 3 tests: `tests/integration/authoringManualTestcases.test.ts:92`, `tests/integration/problemZipImport.test.ts:105`, `tests/services/authoringTestcaseUploadService.test.ts:38`.
     - **Production:** Node 26's `require('archiver')` returns `{ Archiver, JsonArchive, TarArchive, ZipArchive }`, so CommonJS production works. TS 6 `nodenext` raises no TS1479 for it.
     - **Jest:** every suite that loads `app.ts` fails with "Must use import to load ES Module: …/archiver/index.js". With `NODE_OPTIONS=--experimental-vm-modules`, `tests/app.test.ts` passes 15/15.
- **Unused dependencies:**
  - `express-sse` has no importer anywhere. It was added in `d6857a3` (2025-09), and SSE is hand-written in `services/realtimeHub.ts`.
  - `uuid` has no importer. IDs come from Postgres/`crypto`, and `z.uuid()` is zod's own validator.
  - `dotenv` **is** used: `scripts/backfill_xp.ts`, `scripts/clear_submissions.ts` and `scripts/seed_xp_tiers.ts` each `import 'dotenv/config'`. So it is bumped, not removed.
- **Pre-existing, not this step:** `npx tsc -p tsconfig.test.json --noEmit` already reports 145 errors on `main`, all `req.user` / `SessionData` augmentation errors. CI does not run it; CI's type check is `npm run build`, which uses `tsconfig.json` and stays at 0. Do not fix it here. Record that the count is unchanged.
- `tests/services/contestScheduler.test.ts:29` asserts `toHaveBeenCalledWith('* * * * *', expect.any(Function), expect.any(Object))`. It still holds without `scheduled`.

## Global Constraints

- **Nothing changes for users.** That covers judging and verdicts, contest transitions (running → finishing → finished, every minute, `Asia/Bangkok`), login sessions, uploads, avatars, ZIP import/export, and statement/PDF output (spec anti-goals).
- **Frozen libraries.** `htmlparser2` stays exactly `10.0.0`. The `node_modules/*` lockfile entries for `htmlparser2`, `katex`, `marked`, `domhandler`, `domutils`, `dom-serializer`, `domelementtype`, `entities` (and `dom-serializer/node_modules/entities`) must be byte-identical to `main`'s, checked with a script after every install.
- **Code changes only where a breaking change forces them:** `contestScheduler.ts` (node-cron 4), `problemController.ts` plus the 3 tests that build ZIPs (archiver 8), `package.json` scripts (the Jest flag), and `jest.config.ts` only if needed.
- **Held versions:** `typescript` stays `^6.0.3`, because typescript-eslint and ts-jest peer `<7`. `htmlparser2` is frozen.
- **Deviation from the spec:** the spec lists `express-sse` 0.5→1.0. This plan removes it instead, because nothing imports it (see the probe). The spec already says to remove `uuid`. The user reviews this plan before it runs.
- **`sharp` 0.35 must produce pixel-identical images.** Newer libvips may change encoded bytes. For every normalisation path (user avatar, author profile image, statement asset), the decoded raw pixels (`sharp(out).raw().toBuffer()`), the dimensions and the output format must match 0.34.5 on the same fixtures. Byte differences in the encoded file are acceptable and get reported. A pixel difference is a stop-and-report.
- **Tests:**
  - backend `npm test -- --ci` keeps today's count: probe baseline 1223 passed on Linux non-root; record the real baseline;
  - `npm run build` gives 0 errors;
  - the integration stack keeps its count (step 6 had 125 suites / 1497 tests).
  - No test is weakened. A test changes only where the archiver API change forces it, and keeps every assertion.
- **The Jest flag:** `--experimental-vm-modules` goes in through `NODE_OPTIONS` in the `test` npm script (`cross-env NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules jest`). CI (`npm test -- --ci`) and the integration compose (`npm test -- --runInBand …`) then both get it. If the flag makes Node print an `ExperimentalWarning` into the test output, silence only that warning with `--no-warnings=ExperimentalWarning` in the same `NODE_OPTIONS`.
- **Install rules:** `npm ci --no-audit --install-links` prints no ERESOLVE. Keep `package.json` key order and caret style; the exact pin `htmlparser2: 10.0.0` stays exact.
- **Commits:** the user is the sole author, with no `Co-Authored-By` trailer. Branch `chore/backend-libs` from the latest `main`. The builder opens the PR and stops; the user merges. Recommend squash-merge.

## Review Focus

1. **The contest scheduler silently stops firing, or fires in the wrong timezone.**
   - node-cron 4 starts tasks immediately and keeps `timezone`. A unit test with real timers can't run in a reasonable time.
   - Task 2 adds a test that the options passed are exactly `{ timezone: 'Asia/Bangkok' }`.
   - Task 4's smoke creates a contest that starts in the next 1–2 minutes and watches it become `running` with no manual action.
2. **`require(esm)` behaves differently in Jest and in production**, for example `new ZipArchive()` working in tests but not in the compiled `dist/`.
   - Task 3 runs the compiled server's ZIP export (`GET` the problem export endpoint) in the integration stack and in the smoke.
   - It also checks that a produced ZIP round-trips through the existing import.
3. **`sharp` 0.35 changes avatar, profile or statement-asset pixels**, which would change statement/PDF output. Task 1 runs the pixel-equality check above.
4. **`connect-pg-simple` 10 changes session persistence**, which would log everyone out or break the `user_sessions` table: a different table name, schema or prune behaviour. Task 1 reads its changelog, and Task 4 smoke logs in, restarts the backend container, and confirms the session survives.
5. **A frozen rendering library drifts transitively.** The byte-identical lockfile check runs after every install, in every task.

---

### Task 1: Drop-in bumps and dead-dependency removal

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`
- Create (temp only, not committed): the frozen-lock check script and the sharp pixel-check script, kept in the scratch dir.

- [ ] **Step 1: Baseline.** In a `git archive HEAD backend shared` temp copy, on `node:26-bookworm-slim` with CI's apt packages (`build-essential time python3 fontconfig fonts-dejavu-core fonts-tlwg-garuda`), as the non-root `node` user:
  - `npm ci --no-audit --install-links`
  - `npm run build`
  - `npm test -- --ci`

  Record the totals. Also record `npx tsc -p tsconfig.test.json --noEmit | grep -c "error TS"` (expected 145) and save `package-lock.json` as `lock-main.json`.
- [ ] **Step 2: Frozen-lock check script.**
  - The script compares `packages["node_modules/<n>"]` between `lock-main.json` and the current lock, with `JSON.stringify` equality, for the 8 names in the Global Constraints plus `dom-serializer/node_modules/entities`.
  - It prints IDENTICAL or CHANGED per entry and exits 1 on any change.
  - Run it after every install below.
- [ ] **Step 3: Install.**
  - Uninstall `express-sse`, `uuid` and `@types/uuid`.
  - Install these `dependencies`:
    - `express@^5.3.0`, `express-rate-limit@^8.7.4`, `multer@^2.5.0`
    - `pg@^8.23.1`, `zod@^4.6.7`, `unzipper@^0.12.5`
    - `connect-pg-simple@^10.0.0`, `sharp@^0.35.5`, `dotenv@^18.0.10`
  - Install these `-D`:
    - `@types/node@^26.6.6`, `@types/multer@^2.3.0`, `@types/pg@^8.23.1`, `@types/supertest@^7.2.1`
    - `jest@^30.5.2`, `ts-jest@^29.4.15`, `supertest@^7.3.2`, `tsx@^4.23.15`
  - Do **not** touch `node-cron`, `archiver` or their `@types` here.
  - Copy back only `package.json` and the lockfile. Restore npm's re-sorting, e.g. `@oj/statement-renderer`.
  - Frozen-lock check passes. `npm ci` prints no ERESOLVE.
- [ ] **Step 4: Read the breaking-change notes** of the 3 majors in this task: connect-pg-simple 10, sharp 0.35, dotenv 18. Use each package's CHANGELOG in `node_modules` or its GitHub release notes. List each breaking item and why it does or does not affect this repo. Check against `app.ts` for the session store options, the three `*ImageService.ts` / `statementAssetService.ts` for sharp calls, and the 3 scripts for `dotenv/config`.
  - If an item affects the code, stop and report. It is not a drop-in.
- [ ] **Step 5: sharp pixel check.**
  - Gather fixtures: the image fixtures already used by `tests/services/authorProfileImageService.test.ts`, `statementAssetService.test.ts`, `authoringImageSafety.test.ts` and the avatar tests. Add one generated 1200×800 PNG with alpha and one EXIF-rotated JPEG if none exist; generate them with sharp itself in the script.
  - Run each through the repo's three normalisation functions under 0.34.5 (the baseline copy) and under 0.35.5 (this copy).
  - Compare format, dimensions, `raw()` pixel buffers (must be equal) and output byte length (report).
- [ ] **Step 6: Verify.**
  - `npm run build` gives 0 errors.
  - `npm test -- --ci`: the same totals as the baseline. Suites that load `app.ts` are still expected to pass, because archiver is still 7.
  - The `tsconfig.test.json` error count is unchanged at 145.
  - `git grep -n "express-sse\|from 'uuid'\|require('uuid')" backend -- ':!backend/package-lock.json'` returns nothing.
- [ ] **Step 7: Commit.** `git commit -m "chore(backend): bump libraries; drop unused express-sse and uuid"`

### Task 2: `node-cron` 3 → 4

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`, `backend/services/contestScheduler.ts:43-55`, `backend/tests/services/contestScheduler.test.ts`

- [ ] **Step 1: Failing test first.** In `contestScheduler.test.ts`, add `it('registers the per-minute job in Asia/Bangkok with no extra options')`. It asserts `expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function), { timezone: 'Asia/Bangkok' })`. Run it on node-cron 3: it fails, because `scheduled: true` is still passed.
- [ ] **Step 2: Upgrade.** Run `npm uninstall @types/node-cron` and `npm install node-cron@^4.6.0`, then copy back. The frozen-lock check passes.
- [ ] **Step 3: Code.**
  - In `contestScheduler.ts`, drop `scheduled: true`. node-cron 4 starts a scheduled task immediately, which matches 3's `scheduled: true`. Keep `timezone: 'Asia/Bangkok'`.
  - `ScheduledTask` is still exported. Keep `this.checkInterval.stop()` in `stop()`; in v4 `stop()` returns `void | Promise<void>`, so the call needs no await to stop future ticks. Confirm that from the v4 source and note it in the report.
- [ ] **Step 4: Real-timer sanity check.** Outside Jest, from `backend/`, run a throwaway `node -e` script, not committed. It does `require('node-cron')`, schedules `'* * * * *'` with `{ timezone: 'Asia/Bangkok' }`, prints two fire times, then stops the task. Expect two fires about 60 s apart, at second `:00`. Record the output.
- [ ] **Step 5: Verify.** `npm run build` gives 0 errors, and `npm test -- --ci` gives baseline + 1.
- [ ] **Step 6: Commit.** `git commit -m "chore(backend): node-cron 4 for the contest scheduler"`

### Task 3: `archiver` 7 → 8

**Files:**
- Modify:
  - `backend/package.json` (dependency and `test` script) and `backend/package-lock.json`
  - `backend/controllers/problemController.ts:7,577`
  - `backend/tests/integration/authoringManualTestcases.test.ts:8,92`
  - `backend/tests/integration/problemZipImport.test.ts:5,105`
  - `backend/tests/services/authoringTestcaseUploadService.test.ts:4,38`
- Possibly modify: `backend/jest.config.ts`, only if the flag alone is not enough.

- [ ] **Step 1: Upgrade.**
  - Run `npm install archiver@^8.0.0` and `npm install -D @types/archiver@^8.0.0`, then copy back. The frozen-lock check passes.
  - Run `npx tsc --noEmit`: expect exactly the 4 TS2349 sites from the probe, plus TS7006 `chunk` implicit-any in two tests. Report any difference before changing anything.
- [ ] **Step 2: Code.** Change `import archiver from 'archiver'` to `import { ZipArchive } from 'archiver'` and `archiver('zip', opts)` to `new ZipArchive(opts)`, keeping the same options, e.g. `{ zlib: { level: 9 } }`.
  - In the tests, type the `data` listener's `chunk` as `Buffer`.
  - Check in v8's source that `ZipArchive` keeps the old events and methods this repo uses (`on('data'|'error'|'warning'|'end')`, `pipe`, `append`, `file`, `finalize`, `pointer`) and list them in the report.
- [ ] **Step 3: Jest.**
  - Set the `test` script to `cross-env NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules jest`.
  - Run `npm test -- --ci`. If an `ExperimentalWarning` appears in the output, add `--no-warnings=ExperimentalWarning` inside the same `NODE_OPTIONS`.
  - Expect the Task 2 total, all passing, with no warning noise.
- [ ] **Step 4: Compiled production path.**
  - Run `npm run build`.
  - Write a throwaway script, not committed. It `require`s `dist/controllers/problemController.js`'s dependency path, i.e. it runs `node -e "const { ZipArchive } = require('archiver'); …"` from `backend/` the way the compiled CommonJS does. It builds a ZIP with two entries into a buffer, and lists the entries back with `unzipper` (the repo's importer library).
  - Record the output.
- [ ] **Step 5: Verify.** `npm run build` gives 0 errors. `npm test -- --ci` gives the Task 2 total with 0 failed. The `tsconfig.test.json` count is still 145.
- [ ] **Step 6: Commit.** `git commit -m "chore(backend): archiver 8 (ZipArchive) with Jest require(esm)"`

### Task 4: Verification and PR

- [ ] **Step 1: CI-equivalent.** In a fresh `git archive HEAD` copy, run CI's backend job exactly: Node 26, apt packages, non-root, `npm ci`, `npm run build`, `npm test -- --ci`. From the repo root, run `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs` (needs the real checkout).
- [ ] **Step 2: Integration stack.** Run `COMPOSE_PROJECT_NAME=oj-blibs docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests`.
  - It must report 0 failed, with suite and test totals at least step 6's (125 suites / 1497 tests). This also builds the authoring runner image, which copies `zod` and the frozen libraries from `backend/node_modules`.
  - Then `down -v`.
- [ ] **Step 3: Browser smoke** (controller).
  - Start a separate stack (`oj-blibs-smoke`, `HTTP_PORT=8088`) and create a throwaway admin. Check:
    - login;
    - **restart the backend container: still logged in**;
    - submit C++ → Accepted;
    - **create a contest whose start time is 1–2 minutes ahead. It becomes `running` on its own** (scheduler), and later `finishing → finished` when the end passes;
    - admin problem **export ZIP downloads**, and its entries list correctly;
    - **re-import that ZIP**;
    - **upload an avatar** and an **author profile image**;
    - **upload a statement asset**;
    - **build a statement PDF** (Verify & Publish);
    - no console or server errors.
  - Tear down with `down -v`.
- [ ] **Step 4: Push and open the PR.**
  - Branch `chore/backend-libs`, title `chore(backend): library majors — node-cron 4, archiver 8, sharp 0.35, connect-pg-simple 10, dotenv 18 (step 8/9)`.
  - The body lists:
    - versions before and after;
    - the removed packages and the evidence;
    - each breaking change and its handling;
    - the Jest flag and why;
    - the sharp pixel results;
    - the frozen-lock proof;
    - test, integration and smoke results;
    - the pre-existing `tsconfig.test.json` 145 errors (unchanged, not run by CI);
    - what was not verified.
  - No Claude attribution footer. Recommend squash-merge. Stop for user review.
