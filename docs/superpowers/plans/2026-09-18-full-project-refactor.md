# Full-Project Refactor Plan — 2026-09-18

Derived from three parallel audits (backend / frontend / CSS). Baselines before
refactor: backend 51 suites / 470 tests (15 DB-requiring suites skipped locally);
frontend 76 suites / 404 tests, type-check + eslint clean; backend build clean.
The goal: systematic refactor across backend, frontend, and CSS — fix real bugs
and things that don't make sense along the way. Behavior must be preserved
except where a fix intentionally changes broken behavior (noted per package).

Work packages are grouped so files never overlap across parallel agents.

## Wave 1 (parallel — disjoint file sets)

### WP-BE1 — Judging pipeline unification + status constants (backend)
Files: `services/submissionService.ts`, `services/judgeService.ts`, `constants/index.ts`
- Extract one `runSubmissionPipeline` used by `processSubmission` and
  `processContestSubmission` (100% copy-paste pair today; parameterize table +
  prefix).
- Add missing `SUBMISSION_STATUS` keys (COMPILING, RUNNING, COMPILATION_ERROR,
  SYSTEM_ERROR) and replace the 16 literal status strings.
- Fix the O(n²) `findIndex` in `judgeService.ts:182` (use an indexed loop).
- Tests: `tests/services/submissionService.test.ts`, `judgeService.test.ts`,
  `compileGuard.test.ts`, `tests/submissionController.test.ts` (all unit).

### WP-FE1 — Submissions screens unification + hooks typing (frontend)
Files: `pages/submission/Submissions.tsx`, `pages/contest/ContestSubmissions.tsx`,
new `features/submission/SubmissionsView.tsx`, `hooks/useSubmissions.ts`,
`hooks/useSubmissionModal.ts`, `hooks/useContestGuard.ts`, `hooks/useCodeSubmission.ts`,
`hooks/useAdminPage.ts` (+ `admin/useAdminPage.ts` if that's the path),
`utils/formatters.ts`, `components/ProblemCard.tsx`, `pages/problem/Problems.tsx`,
`hooks/useProblems.ts`
- Extract shared `SubmissionsView` consumed by both submissions pages; delete
  the duplicated click-outside effect + suggestion dropdown JSX.
- Fix `Date.now()` race guard in `useSubmissions.ts:39` (incrementing counter
  ref, pattern already used in TestcaseFiles).
- Fix `useProblems.ts:11` wrong return type → `ProblemSummary[]`; delete local
  `Problem` type + casts in `Problems.tsx`; type `ProblemCard` props.
- Add param/return types to the JS-style hooks and `formatters.ts`.
- Tests: `pages/Submissions.test.tsx`, `pages/ContestSubmissions.test.tsx`,
  `hooks/useSubmissions.test.tsx`, `utils/formatters.test.ts`. No visual
  baselines on these pages.

### WP-CSS1 — Undefined CSS variables fix + status/badge dedupe (frontend CSS)
Files: `index.css`, `App.css`, `App.tsx`, `SubmissionModal.module.css`,
`ContestProblems.module.css` (delete), plus var-usage fixes across 12 module
files (Settings, Management, ModalLayout, ContestCard, Navbar, Home,
ContestNavbar, ProblemDetail, ContestDetail, Contests, ContestScoreboard,
CodeSubmissionForm)
- Define or alias the 21 undefined CSS variables (→ existing tokens:
  `--card-bg`→surface token, `--primary-color`→accent, `--text-color-primary`→
  text token, `--error-color`→error token, etc.) — this is a real rendering
  bug fix (cards with no background, dark-mode text issues).
- Replace the 7-color hex set duplicated in `SubmissionModal.module.css` with
  the shared `--status-*` variables (computed values identical).
- Delete orphaned `ContestProblems.module.css` (159 lines dead).
- Delete `App.css` and codify the intended `.container` padding in `index.css`
  (App.css silently overrides it today — decide current-render = intended).
- Add a Jest guard test (pattern of `cssModuleIsolation.test.ts`): every
  `var(--x)` used in any CSS must be defined.
- Constraint: these pages have no visual baselines; Authoring/AuthorProfiles
  modules are NOT touched in this package.

## Wave 2 (parallel — disjoint file sets)

### WP-BE2 — Legacy write transactions + zip-pairing dedupe (backend)
Files: `services/problemQueryService.ts`, `services/batchUploadService.ts`,
`services/contestQueryService.ts` (deleteContest only), new
`services/testcaseZipPairing.ts`, `utils/` helpers
- Wrap `updateProblem` (ID-change fan-out), `deleteProblem`,
  `replaceProblemTestcasesFromZip`, `deleteContest` in BEGIN/COMMIT via
  `pool.connect()` following `problemMigration.ts` pattern.
- Extract shared testcase-zip pairing (regex + junk filter) used by both
  `problemQueryService` and `batchUploadService`.
- Tests: `tests/problemController.test.ts` (mocked db), plus final disposable
  Compose integration run. Keep SQL strings byte-identical where possible.

### WP-FE2 — useProblemManagement split + polling leak fix (frontend)
Files: `hooks/admin/useProblemManagement.ts` (+ tests), new hooks
`useProblemCrud.ts`, `useProblemSelection.ts`, `useProblemExport.ts`,
`useBatchUpload.ts`
- Fix the `setInterval` polling leak at line 384 (unmount cleanup + ceiling on
  poll duration).
- Split the 472-line hook along its four responsibilities.
- Tests: `hooks/admin/useProblemManagement.test.ts`,
  `features/admin/ProblemManagement.test.tsx`.

### WP-CSS2 — Authoring dark-mode fixes + editor palette tokens (frontend CSS)
Files: `features/admin/authoring/Authoring.module.css`,
`components/CodeEditor.module.css`, `features/problem/CodeSubmissionForm.module.css`
(and any small shared tokens additions in `index.css`)
- Replace hardcoded `#fff` + gray palette in `Authoring.module.css` (lines
  423–471, 535–641) with theme tokens — fixes dark-mode rendering.
- Consolidate the 3× duplicated dark code-editor palette
  (`#282c34/#abb2bf/#21252b`) into shared tokens.
- Constraint: authoring shell + author profiles have Playwright visual
  baselines (desktop + mobile + focus + one dark variant). Dark-mode fixes
  WILL change pixels → regenerate affected baselines with
  `npm run test:visual:update` and re-run `npm run test:visual` to confirm;
  light-mode rendering must stay pixel-stable.

## Wave 3 (parallel — disjoint file sets)

### WP-BE3 — Contest service split + access guard + constants (backend)
Files: split of `services/contestQueryService.ts` into
`contestQueryService.ts` / `contestScoreboardQueryService.ts` /
`contestParticipantQueryService.ts`; `services/contestScheduler.ts`,
`services/problemMigration.ts`, `constants/index.ts`
- Extract `assertContestParticipantAccess` (replaces 4 copies of participant
  check + 5 copies of `SELECT * FROM contests WHERE id`).
- Add `CONTEST_STATUS.SCHEDULED` / FINISHED literal replacements.
- Add re-entrancy guard to the scheduler tick body (double-processing risk).
- Keep export names stable where tests mock modules.
- Tests: `tests/contestController.test.ts`, `tests/services/contestScheduler.test.ts`,
  `tests/services/problemMigration.test.ts`.

### WP-FE3 — Authoring service layer + type consolidation (frontend)
Files: new `services/admin/authoringService.ts`,
`features/admin/authoring/types.ts`, `TestcaseFiles.tsx` (+ test),
`AuthorProfiles.tsx` (+ test), `StatementTab.tsx`, `StatementEditor.tsx`,
`JobHistory.tsx`, `useAuthoringDraft.ts`, `ProblemAuthoring.tsx`
- Route all 6 direct-`api` authoring consumers through a typed
  `authoringService`.
- Consolidate `Profile` (5-field vs 9-field divergence), `Asset`,
  `TestcaseMetadata` types into `authoring/types.ts`.
- Replace AuthorProfiles' local `errorMessage` with `utils/error`.
- Fix `AuthorProfiles.tsx:280` class-reuse leak (`${styles.root}` on dialog
  fieldset).
- Split `TestcaseFiles.tsx` (497) into `TestcaseTable` / preview dialog /
  replace dialog / upload forms + `useTestcaseFiles` hook.
- Constraint: AuthorProfiles + admin-shell visual baselines — keep markup and
  classes identical; run `npm run test:visual` after.

### WP-CSS3 — Management buttons/badges to tokens + UI kit adoption (frontend CSS + light TSX)
Files: `features/admin/Management.module.css`, `ProblemManagement.tsx` badge
logic, `ContestCard.module.css` (joinedStatus), possibly `StatusBadge` usage
- Convert the 10+ `composes: btn` hex backgrounds to tokens (or adopt
  `components/ui/Button` where markup-safe).
- Unify the 3 parallel badge systems (Management badges, ContestCard
  joinedStatus, ProblemManagement contest-status badge).
- No visual baselines on these pages → free rein, but keep light-mode
  appearance close to current.

## Wave 4 — final consolidation (parallel, small)

### WP-BE4 — Controller slimming + shared helpers
Files: `controllers/problemController.ts`, `controllers/adminController.ts`,
`controllers/authoringDraftController.ts`, `controllers/submissionController.ts`,
new `services/batchUploadProgress.ts`, `services/adminDatabaseService.ts`,
`utils/runCommand.ts`, `schemas/requestSchemas.ts`
- Move SSE batch-upload progress hub out of problemController; move admin DB
  import/export orchestration into a service; collapse the five
  result-kind if-chains in authoringDraftController with a mapping helper;
  unify 404/409 responses onto AppError per STANDARDS; fix the PDF-route
  N+1; rename `outputAuthoringJobSchema` → `expectedRevisionSchema`; drop
  dead exports.

### WP-FE4 — Helper dedupe + dead-code sweep
Files: `features/admin/contests/useContestManagement.tsx`,
`hooks/useContestScoreboard.ts`, `useSubmissionModal.ts`,
`Submissions.tsx`/`ContestSubmissions.tsx` (via SubmissionsView),
`JobHistory.tsx`, `useAdminSettings.ts`, `useCodeSubmission.ts`,
`config/constants.ts`/`utils/constants.ts`, `services/api.ts`,
`components/ui/Drawer.tsx`, `hooks/useContestDetail.ts`
- Route all date formatting through `formatters` (4 inline copies); delete
  duplicated `getStatusClass`; wire or delete `UI_TIMEOUTS.SUCCESS_MESSAGE_*`
  and `SUBMISSION_CACHE_EXPIRY`; delete `requestData`; decide Drawer fate;
  use `POLLING_INTERVALS` in `useContestDetail` (no hardcoded 15000).

### WP-CSS4 — Token contract + breakpoints + docs
Files: `index.css`, `.context/STANDARDS.md`, docs
- Document the token contract in STANDARDS.md; define a breakpoint scale
  (768/480 standard, 900/901 admin) and align scattered breakpoints where
  safe; final sweep for remaining hardcoded colors.

## Execution rules for subagents

1. Behavior-preserving except noted fixes; run the package's tests before and
   after; keep `npm run build`/`type-check` green.
2. Never touch files owned by another package in the same wave.
3. CSS: `index.css` token edits in wave-1 CSS package must not conflict with
   wave-2/3 CSS packages (they add their own usages only).
4. Visual baselines: regenerate only when a package explicitly says the pixels
   will change (WP-CSS2 dark-mode), then confirm with `npm run test:visual`.
5. Final verification (main session): backend `npm test` + build, full
   disposable Compose integration suite, frontend `npm run validate` +
   `npm run test:visual`, then a single review pass and commit.

## Out of scope (recorded, not done)

- Special judge / alternate checker (feature work, separate cycle)
- Promoting `e2e-probes/` to a real e2e suite (separate cycle)
- AI integration in authoring (future work per AUTHORING_PROGRESS.md)
- Merging `worktree-authoring-ux` → master (user decision, after this refactor)
