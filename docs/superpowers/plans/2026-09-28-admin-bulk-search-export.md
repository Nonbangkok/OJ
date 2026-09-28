# Admin Bulk Visibility, Stable Search, and Portable Problem Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Apply Show/Hide All to every matching eligible problem, preserve search-control lifecycle across async states, and round-trip all portable problem metadata through ZIP export/import.

**Architecture:** Share the admin list predicates across pagination, eligible count, and one server-side bulk UPDATE. Keep search controls in stable result views and reuse a small debounce hook for remote search; retain immediate local filtering. Serialize all exported problem configs through one backend function that uses canonical stored category and collection names.

**Tech Stack:** TypeScript, Express, PostgreSQL, React 19, Jest, Testing Library, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-28-admin-bulk-search-export-design.md`

## Global Constraints

- Bulk visibility filters on Search, Collection, Visibility, Author, and any future server-supported Problem Management filter using one shared builder.
- Bulk visibility and its confirmation count both exclude `contest_id IS NOT NULL`.
- Header Select All remains scoped to currently displayed/loaded rows.
- A bulk visibility action makes one server request and performs one server-side UPDATE; it never sends one PATCH/PUT per row.
- Search controls remain mounted and no code restores focus after render.
- Server-side autocomplete/search debounce is 300 ms; purely local filters remain immediate.
- Older search responses never replace newer results or suggestions.
- Export config fields are exactly `id`, `title`, `author`, `time_limit_ms`, `memory_limit_mb`, `categories`, `difficulty`, and `collection`.
- Export `categories` as canonical strings or `[]`, `difficulty` as an integer or `null`, and `collection` as a collection name or `null`.
- Preserve importer behavior, contest rules, URL semantics, accessibility labels, and unrelated UI.
- Keep all changes in `/tmp/OJ-worktrees/admin-bulk-search-export`; do not modify the original checkout's `.codegraph/`.

## Review Focus

- A hidden-only filter followed by Show All scopes to the hidden rows before changing them; refresh may then show no rows.
- Contest-attached matches do not affect the confirmation count or bulk update.
- Header Select All selects only loaded rows even when the server reports more matches.
- Empty and failed search results leave each affected search control mounted; a stale autocomplete response cannot replace newer suggestions.
- Export preserves empty/null metadata types and imports categories, difficulty, and collection name back unchanged.

---

### Task 1: Share admin filters and add server-side bulk visibility

**Files:**
- Modify: `backend/services/problemQueryService.ts`
- Modify: `backend/controllers/problemController.ts`
- Modify: `backend/schemas/requestSchemas.ts`
- Modify: `backend/types/api.ts`
- Test: `backend/tests/integration/adminProblemsPagination.test.ts`
- Test: `backend/tests/problemController.test.ts`

**Interfaces:**
- Produce a typed shared builder for Search, Collection, Visibility, and Author predicates, used by list reads, eligible count, and bulk update; append cursor separately and exclude cursor/limit from the all-matching scope.
- Produce `updateAdminProblemsVisibility(filters, isVisible): Promise<{ updatedCount: number }>` and a staff/admin `PATCH /admin/problems/visibility` request containing `{ isVisible, filters }`.
- Extend the admin page response with `bulkEligibleCount`, the count matching the exact bulk filters plus `contest_id IS NULL`.

- [x] **Step 1: Add integration tests for server-side count and update scope**

  Extend the existing integration fixture to create 100 rows with varied ID/title, collection, author, visibility, contest attachment, and unrelated control rows. Assert:
  - 20-row page plus no filters, bulk Hide changes all 100 eligible problems.
  - Search matching 30 across pages changes exactly those 30.
  - Collection, author, and combined filters change only their matches.
  - `visibility=hidden` plus Show changes all matching hidden eligible rows; the refreshed hidden-only query is empty.
  - Contest-attached rows do not count or change.
  - Loading the next page before bulk has no effect on scope.
  - A current page header Select All still yields only displayed IDs (frontend assertion is in Task 2).

- [x] **Step 2: Run the focused integration/controller tests and observe expected failures**

  Run: `npm test -- --runInBand tests/integration/adminProblemsPagination.test.ts tests/problemController.test.ts`
  Expected: failures identify the missing eligible count, bulk route, and all-filter mutation.

- [x] **Step 3: Extract one parameterized filter builder and expose exact eligible count**

  Preserve existing ILIKE escaping, collection sentinels, author trimming, visibility predicates, and cursor behavior. Build the matching eligible count from the shared filter clauses, before cursor/limit. Return zero when there are no matches.

- [x] **Step 4: Implement one protected bulk endpoint and one SQL UPDATE**

  Validate `isVisible` and the supported filter shape. Apply all filter predicates plus `contest_id IS NULL` in the parameterized UPDATE. The active visibility filter remains in the WHERE clause so it defines the pre-update scope. Return the affected-row count.

- [x] **Step 5: Run focused backend tests and verify pass**

  Run: `npm test -- --runInBand tests/integration/adminProblemsPagination.test.ts tests/problemController.test.ts`
  Expected: PASS, including staff/admin authorization and request validation.

---

### Task 2: Wire filter-wide visibility in Problem Management

**Files:**
- Modify: `frontend/src/services/admin/problemsAdminService.ts`
- Modify: `frontend/src/hooks/admin/useAdminProblemsPage.ts`
- Modify: `frontend/src/hooks/admin/useProblemCrud.ts`
- Modify: `frontend/src/hooks/admin/useProblemManagement.ts`
- Modify: `frontend/src/features/admin/problems/ProblemManagement.tsx`
- Modify: `frontend/src/types/api.ts`
- Test: `frontend/src/tests/services/adminService.test.ts`
- Test: `frontend/src/tests/hooks/admin/useAdminProblemsPage.test.tsx`
- Test: `frontend/src/tests/hooks/admin/useProblemManagement.test.ts`
- Test: `frontend/src/tests/features/admin/ProblemManagement.test.tsx`

**Interfaces:**
- Consume Task 1's `bulkEligibleCount` and `PATCH /admin/problems/visibility` response.
- Provide `adminService.setProblemsVisibility(filters, isVisible)`.
- Keep selected-row visibility mutation separate from filter-wide Show/Hide All.

- [x] **Step 1: Add frontend service/hook/component regression tests**

  Assert the filter payload reaches the bulk service once; confirmation copy uses `bulkEligibleCount`; selection clears after success; failures retain the current page data and show the Admin error; the action uses current filters after Show More; and header Select All selects only loaded rows.

- [x] **Step 2: Run affected frontend tests and observe expected failures**

  Run: `CI=true npm test -- --watchAll=false --runTestsByPath src/tests/services/adminService.test.ts src/tests/hooks/admin/useAdminProblemsPage.test.tsx src/tests/hooks/admin/useProblemManagement.test.ts src/tests/features/admin/ProblemManagement.test.tsx`
  Expected: failures show the absent bulk service, loaded-row scope, count copy, and selection reconciliation.

- [x] **Step 3: Add the bulk service method and thread eligible count through page state**

  Use one PATCH call with filters only (no cursor or limit); consume the count from the list response for confirmation.

- [x] **Step 4: Replace loaded-ID Show/Hide All with the filter-wide mutation**

  On success, clear selection and use a new `refreshFirstPage()` path so `hasMore`, cursor, badges, and eligible count are fresh. On failure, retain rows and render existing Admin error feedback inline without replacing the page. Keep header-checkbox selection code unchanged. Disable global actions only while loading or when `bulkEligibleCount` is zero; do not infer availability from loaded rows.

- [x] **Step 5: Run the affected frontend tests and verify pass**

  Run the Task 2 command above.
  Expected: PASS, including loaded-row header scope and server-wide action scope.

---

### Task 3: Stabilize search controls and remote autocomplete

**Files:**
- Create: `frontend/src/hooks/useDebouncedValue.ts`
- Modify: `frontend/src/features/admin/problems/ProblemManagement.tsx`
- Modify: `frontend/src/features/admin/analysis/ProblemsTab.tsx`
- Modify: `frontend/src/features/admin/analysis/UsersTab.tsx`
- Modify: `frontend/src/features/admin/analysis/SubmissionsTab.tsx`
- Modify: `frontend/src/features/submission/SubmissionsView.tsx`
- Modify: `frontend/src/hooks/useAutocomplete.ts`
- Test: `frontend/src/tests/hooks/useDebouncedValue.test.ts`
- Test: `frontend/src/tests/hooks/useAutocomplete.test.ts`
- Test: `frontend/src/tests/features/admin/ProblemManagement.test.tsx`
- Test: `frontend/src/tests/analysisProblemsTab.test.tsx`
- Test: `frontend/src/tests/analysisUsersTab.test.tsx`
- Test: `frontend/src/tests/analysisSubmissionsTab.test.tsx`
- Test: `frontend/src/tests/pages/Submissions.test.tsx`
- Test: `frontend/src/tests/pages/Problems.test.tsx`
- Test: `frontend/src/tests/features/admin/ProblemAuthoring.test.tsx`
- Create test: `frontend/src/tests/features/admin/ProblemMigrationModal.test.tsx`

**Interfaces:**
- Produce `useDebouncedValue<T>(value: T, delayMs: number): T` for the Problem Management and Analysis Problems/Users remote query values.
- Update `useAutocomplete` to debounce suggestion fetches at 300 ms and ignore responses for superseded query values; leave local filtering immediate.

- [x] **Step 1: Add lifecycle and ordering regression tests**

  Assert the same Problem Management input DOM node retains focus/caret while its result query loads, then through zero results and failed requests. Add equivalent result-state assertions for Analysis Problems/Users/Submissions and main Submissions filters. Add focus continuity assertions for public Problems and the locally filtered Authoring and migration-modal search inputs; verify modal selections survive filtering. Exercise rapid typing, Backspace, select-all replacement, and clear behavior on affected text inputs. Use deferred autocomplete responses to resolve an older query last and assert only the newest suggestions remain. Use fake timers to assert the 300 ms debounce and that a replaced query cancels its prior pending fetch.

- [x] **Step 2: Run focused frontend tests and observe expected failures**

  Run: `CI=true npm test -- --watchAll=false --runTestsByPath src/tests/hooks/useAutocomplete.test.ts src/tests/features/admin/ProblemManagement.test.tsx src/tests/analysisProblemsTab.test.tsx src/tests/analysisUsersTab.test.tsx src/tests/analysisSubmissionsTab.test.tsx src/tests/pages/Submissions.test.tsx src/tests/pages/Problems.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx src/tests/features/admin/ProblemMigrationModal.test.tsx`
  Expected: failures identify input unmounts during async result states and stale autocomplete ordering.

- [x] **Step 3: Add the shared debounce hook and protect autocomplete results**

  Keep the input value synchronous; debounce only requests. Increment a request token whenever the query changes or clears so stale success/failure handlers cannot mutate the current suggestion state.

- [x] **Step 4: Keep affected search views mounted during fetch/error/empty states**

  Remove page-return branches that replace the search toolbar in Problem Management, Analysis Problems/Users/Submissions, and main Submissions. Render loading, error, and empty feedback in each results area. Use the shared debounce hook for Problem Management and Analysis Problems/Users while retaining their current 300 ms timing. Keep request-id/cancellation protection. Leave `/problems` as-is because it already meets the lifecycle behavior; leave purely local User/Contest/Authoring/modal/Analysis Contests filters immediate and unchanged after audit confirms their search changes do not trigger fetches.

- [x] **Step 5: Run focused search tests and verify pass**

  Run the Task 3 command above.
  Expected: PASS with unchanged DOM identity and focus/caret through result updates, plus stale-response protection.

---

### Task 4: Serialize complete portable problem metadata and round-trip it

**Files:**
- Create: `backend/services/problemConfigSerializer.ts`
- Modify: `backend/services/problemQueryService.ts`
- Modify: `backend/controllers/problemController.ts`
- Modify: `backend/types/api.ts`
- Test: `backend/tests/problemController.test.ts`
- Test: `backend/tests/services/problemQueryService.test.ts`
- Test: `backend/tests/integration/problemZipImport.test.ts`
- Modify if needed: `README.md`

**Interfaces:**
- Produce `serializeProblemConfig(problem): ProblemExportConfig` and call it for every problem directory in the shared export route.
- Extend `ProblemExportConfig` and `getProblemExportBundle` data to include `categories: string[]`, `difficulty: number | null`, and `collection: string | null`.

- [x] **Step 1: Add serializer and export/round-trip failing tests**

  Cover rated metadata with multiple categories and a collection, no categories, unrated difficulty, no collection, and selected export containing differently configured problems. In the integration test, export a stored problem, extract its config JSON, import that ZIP through the existing importer, and assert categories, difficulty, and collection name survive unchanged. Assert exact JSON types and absence of database IDs/visibility.

- [x] **Step 2: Run focused backend export/import tests and observe expected failures**

  Run: `npm test -- --runInBand tests/problemController.test.ts tests/services/problemQueryService.test.ts tests/integration/problemZipImport.test.ts`
  Expected: failures show the missing config fields and export-to-import round trip.

- [x] **Step 3: Extend the export bundle and implement the canonical serializer**

  Query category strings and joined collection name; serialize absent categories to `[]`, absent difficulty to `null`, and absent collection to `null`. The route uses this serializer for every selected problem. Do not alter importer schema or metadata resolution.

- [x] **Step 4: Align documentation only if the existing schema differs**

  Compare the serialized schema to the README example and field descriptions. Keep README unchanged if already identical; otherwise make the smallest schema-only correction.

- [x] **Step 5: Run focused export/import tests and verify pass**

  Run the Task 4 command above.
  Expected: PASS, including the real ZIP export-to-import round trip when `INTEGRATION_DATABASE_URL` is configured.

---

### Task 5: Cross-feature verification

**Files:**
- No new product files; update only tests or code owned by Tasks 1–4 if verification exposes a regression.

- [x] **Step 1: Run all backend tests**

  Run from `backend`: `npm test -- --runInBand`
  Expected: PASS; integration suites requiring `INTEGRATION_DATABASE_URL` run when configured and report skipped otherwise.

- [x] **Step 2: Run all frontend tests and type checks**

  Run from `frontend`: `CI=true npm test -- --watchAll=false`; then `npm run type-check` and `npm run type-check:tests:all`.
  Expected: PASS.

- [x] **Step 3: Review final diff and report evidence**

  Confirm `.codegraph/` in the original checkout is untouched, no migrations were added, no unrelated UI changed, and all search fields found in the audit are either covered by lifecycle changes or recorded as stable local-only controls. Report changed files, exact commands/results, endpoint/query scope, SQL/API call counts, round-trip status, and remaining environment-dependent cases.

## Execution Notes

Tasks 1 and 4 are backend work; Tasks 2 and 3 are frontend work. Execute inline in this session in the listed order so each API shape and shared hook is fixed before its consumers. Keep the branch changes reviewable; do not push or merge.
