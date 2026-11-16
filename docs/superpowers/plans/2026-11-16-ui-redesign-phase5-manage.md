# UI Redesign Phase 5 — Manage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the staff/admin Manage area to spec §7.8, with backend B5 (users list facts and bulk role) and B6 (problem list and editor facts):
- Users, Problems, Contests, Analysis and Settings;
- full-page problem and contest editors, including the contest problem reorder UI that phase 4 left to this phase;
- `/admin` redirect.

**Architecture:**
- Every Manage page uses the shared phase 2 primitives: PageHeader, FilterBar, DataTable, BulkBar, ActionMenu, Drawer, Dialog, ConfirmDialog tiers and SettingsRow.
- Edit surfaces follow the spec rule:
  - 1–3 fields → Dialog;
  - under ~8 fields → right Drawer;
  - multi-part objects → a full page with URL tabs (`/admin/problems/:id/:tab`, `/admin/contests/:id/:tab`, `/admin/analysis/:tab`).
- The old modals (ProblemModal, ContestModal, EditUserModal and friends) are deleted as their pages replace them.
- Backend additions are additive: one migration, new fields and one bulk endpoint.

**Tech Stack:** React 19 + Vite + CSS Modules + Jest/RTL + Playwright (frontend); Express 5 + TypeScript + raw SQL + Zod + Jest/supertest (backend).

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` §7.8 (incl. "Mockup decisions (phase 5 gate)"), §9 B4/B5/B6, §10 phase 5.

**Mockups:** `docs/superpowers/specs/2026-11-15-ui-redesign/phase5-manage.html` (owner-approved 2026-11-16) and `key-pages.html` §4 (Problems list).

## Global Constraints

- UI copy stays English. Button labels are verbs ("Delete user", "Replace and rejudge"), never "Confirm".
- No new libraries: Base UI, cmdk and NumberFlow are the only additions allowed (§5.1). Drag-to-reorder uses native HTML5 drag events plus keyboard "Move up/Move down" items, not a dnd library.
- Status values (visibility, contest status, lock) are a dot + text, never a clickable toggle (§7.8).
- At most one black primary action per PageHeader. Destructive row-menu items come last, red, after a separator.
- Confirm tiers:
  - reversible → `tier="plain"`;
  - destructive → `tier="destructive"` with the object and its counts named;
  - cascading/irreversible → `tier="typed"` with the object's name.
- Schema changes are new migrations only (next is `0027`). Raw parameterized SQL. Zod validation. `isUniqueViolation` → 409. `db.withTransaction` for multi-statement writes.
- Route guards stay as they are today: Users and Settings are admin-only (`requireAdmin`); Problems, Contests, Analysis and Authoring are staff|admin.
- The protected admin account (`PROTECTED_ADMIN_USERNAME` in `backend/services/adminQueryService.ts`) can't be edited, deleted or have its role changed in bulk either.
- Contest times are entered and shown as Asia/Bangkok (UTC+7), and the create Drawer says so.
- Design guards, contrast guards and CSS-module isolation guards stay green. Visual baselines are regenerated and every new PNG is read before it is kept.
- Commits carry no Co-Authored-By trailer. PR bodies end with the Claude Code line.

## Review Focus

1. **Bulk actions over a filtered list.** Lock/unlock/role/export act on exactly the selected ids, not on "all matching". Selection clears when the filter changes. A bulk role change never includes the protected admin or the acting user. Tests: Task 1 (server refuses), Task 4 (selection resets on filter change).
2. **Type-locked problems.** Once a problem has submissions, its type and submission filename can't change. The editor shows "Type locked · N submissions" and disables those fields, and the server still refuses (existing lock). Tests: Task 2 (fields), Task 7 (disabled + notice).
3. **Replacing testcases on a problem with submissions.** The confirm names the old and new counts, and rejudge is offered and on by default. Declining rejudge leaves old verdicts untouched, and accepting queues the problem rejudge. Test: Task 8.
4. **Contest problem order edits.** Reordering after the contest finished is impossible: the Problems tab is read-only and the server already answers 409. A drag that ends where it started sends nothing. Keyboard reordering works without a mouse. Test: Task 10.
5. **Switching the site to Private while a contest is running.** The confirm warns that the running contest's guests lose access. A failed save reverts the control and shows an inline error instead of "Saved". Test: Task 5.

---

## Part A — Backend (PR 5a)

### Task 1: B5 — users list facts, locked filter, bulk role

**Files:**
- Create: `backend/migrations/0027UserLastLogin.ts`
- Modify:
  - `backend/migrations/index.ts` (+ the four migration-registry tests)
  - `backend/controllers/authController.ts` (successful login stamps `last_login_at`)
  - `backend/services/adminQueryService.ts`
  - `backend/controllers/adminController.ts`
  - `backend/schemas/requestSchemas.ts`
  - `backend/types/service.ts`
- Test: `backend/tests/integration/adminUsersList.test.ts` (real SQL, throwaway schema, following `tests/integration/contestStandings.test.ts`)

**Interfaces:**
- Produces:
  - `users.last_login_at TIMESTAMPTZ NULL` (migration `0027_user_last_login`).
  - `GET /admin/users` rows gain:
    - `last_active_at: string | null` = `GREATEST(last_login_at, latest submissions.submitted_at, latest contest_submissions.submitted_at)`;
    - `solved_count: number` = count of `user_problem_rewards`;
    - `xp: number` = sum of `xp_awarded`;
    - `submission_count: number` = practice + contest submissions.
  - The query gains `locked: 'locked' | 'unlocked'` (optional).
  - `PUT /admin/users/role` (admin), body `{ ids: number[] (1–500, unique), role: 'user'|'staff'|'admin' }`, returns `{ updated: number[], skipped: Array<{ id: number; reason: 'protected' | 'self' | 'not_found' }> }`.

- [ ] **Step 1: Failing tests**
  - `list rows carry last_active_at from the latest login or submission`
  - `solved_count, xp and submission_count per user`
  - `locked filter narrows to submissions_locked users`
  - `bulk role updates the listed users and skips the protected admin and the actor`
  - `bulk role is admin-only (403 for staff)`
  - `login stamps last_login_at` (supertest against authController with a seeded bcrypt hash)
- [ ] **Step 2: Run** `npm test -- tests/integration/adminUsersList.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The counts come from LEFT JOINed per-user aggregates (not correlated subqueries per row). Bulk role runs in `db.withTransaction`.
- [ ] **Step 4: Run** the new file plus `tests/adminController.test.ts`, `tests/migrations`, `tests/scripts/migrate.test.ts` → PASS; then the backend gate.
- [ ] **Step 5: Commit** `feat(api): users list facts, locked filter and bulk role (B5)`

### Task 2: B6 — problem list and editor facts

**Files:**
- Modify:
  - `backend/services/problemQueryService.ts` (`getAdminProblemsPage`, admin detail)
  - `backend/controllers/problemController.ts`
  - `backend/types/models.ts`, `backend/types/service.ts`
- Test: `backend/tests/integration/adminProblemFacts.test.ts`

**Interfaces:**
- Produces:
  - `GET /admin/problems` rows gain `problem_type`, `time_limit_ms`, `memory_limit_mb`, `testcase_count: number`, `submission_count: number` (practice + contest) and `type_locked: boolean` (= submission_count > 0).
  - `GET /admin/problems/:id` gains `submission_count`, `type_locked`, `testcase_count` and `testcase_bytes: number` (sum of input + output lengths).

- [ ] **Step 1: Failing tests**
  - `list rows carry type, limits, testcase and submission counts`
  - `type_locked follows any submission, practice or contest`
  - `detail carries testcase_count and testcase_bytes`
- [ ] **Step 2–4:** FAIL → implement (aggregate joins, as in Task 1) → PASS, plus `tests/problemController*.test.ts` and the backend gate.
- [ ] **Step 5: Commit** `feat(api): problem list and editor facts (B6)`; push and open PR 5a against `ui-redesign/phase4c-scoreboard`.

---

## Part B — Manage shell, Users, Settings (PR 5b)

### Task 3: Manage routing and `/admin` redirect

**Files:**
- Modify:
  - `frontend/src/App.tsx`
  - `frontend/src/pages/admin/Admin.tsx` (becomes the redirect)
  - `frontend/src/layouts/admin/AdminLayout.tsx` (remembers the last Manage page)
- Create: `frontend/src/features/admin/lastManagePage.ts`
- Test: `frontend/src/tests/pages/AdminRedirect.test.tsx`

**Interfaces:**
- Produces:
  - `rememberManagePage(path: string): void` and `lastManagePage(role: UserRole): string`, backed by localStorage key `oj:last-manage-page`.
  - The redirect goes to the remembered path if it starts with `/admin/` and the role may open it; otherwise to `/admin/problems`.
  - New routes:
    - `/admin/problems/:problemId/:tab?` → `ProblemEditPage` (Task 7)
    - `/admin/contests/:contestId/:tab?` → `ContestEditPage` (Task 10)
    - `/admin/analysis/:tab?` → AnalysisPage (Task 11)
  - Until their tasks land, those routes render a placeholder `EmptyState` with a link back to the list.

- [ ] **Step 1: Failing tests**
  - `/admin sends staff to /admin/problems`
  - `/admin returns an admin to the last Manage page they opened`
  - `a remembered admin-only page is ignored for staff`
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): /admin opens the last Manage page`

### Task 4: Users page

**Files:**
- Rewrite: `frontend/src/features/admin/users/UserManagement.tsx` (+ module CSS)
- Create:
  - `frontend/src/features/admin/users/UserEditDrawer.tsx`
  - `frontend/src/features/admin/users/BatchCreateDrawer.tsx`
  - `frontend/src/features/admin/users/AddUserDialog.tsx`
- Delete (once unused): `AddUserModal.tsx`, `EditUserModal.tsx`, `BatchUserCreation.tsx`, `ResetPasswordModal.*`
- Modify: `frontend/src/services/admin/usersAdminService.ts` (`setRole(ids, role)`, `list` passes `locked`), `frontend/src/types`
- Test: `frontend/src/tests/features/admin/UserManagement.test.tsx` (rewrite) and `BatchCreateDrawer.test.tsx`

**Interfaces:**
- Consumes: Task 1's fields and `PUT /admin/users/role`.

- [ ] **Step 1: Failing tests**
  - Header: `PageHeader "Users" with meta "412 accounts · 3 staff · 1 admin"`, primary `Create users`, and `⋯` holding `Add user`.
  - Filters: search, SegmentedControl `All / Students / Staff / Admins`, and a `Locked` chip, all in the URL. `Changing a filter clears the selection`.
  - Columns: Username, Role, Status (dot: Active / Locked), Solved (mono, right), Joined, Last active (relative), `⋯`.
  - BulkBar `2 selected · Lock · Unlock · Change role · Export CSV`:
    - Lock and Unlock call the bulk lock;
    - Change role opens a Dialog, then `setRole`, and reports skipped users inline;
    - Export CSV downloads the selected rows' username, role, status, solved and joined.
  - Edit Drawer: username, role segmented, `Lock submissions` SettingsRow, `Reset password` (Dialog with a new password); Save calls update.
  - Delete from `⋯` is `ConfirmDialog tier="typed"` with confirmText = the username, and its body names `N submissions and M solves`; the button reads `Delete user`.
  - Batch create Drawer: prefix, count, role. The result view lists the username/password table, has `Copy` and `Download CSV`, warns "Save these passwords now. They won't be shown again", and `Done` closes it and refreshes.
  - The protected admin row's `⋯` has no Edit, Delete or role items.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): Users with filters, bulk actions and drawers`

### Task 5: Settings page

**Files:**
- Rewrite: `frontend/src/features/admin/settings/Settings.tsx` (+ CSS)
- Test: `frontend/src/tests/features/admin/Settings.test.tsx` (rewrite)

**Interfaces:** consumes `settingsAdminService` (existing get/set for site access, registration, password change, export, import with progress) and `contestService.getAll()` (for the running-contest warning).

- [ ] **Step 1: Failing tests**
  - Layout: two groups, `Access` and `Data`, made of SettingsRows:
    - Site visibility (SegmentedControl Public / Private), Registration (switch), Password changes (switch);
    - Export database (button);
    - a `Danger zone` group with `Replace database…`.
  - Saving shows a `Saved` status (role=status) and hides it after 3 s. A failed save reverts the control and shows InlineError.
  - Switching to Private opens a plain confirm. When a contest is running, its body warns "Mid-term practice is running — guests following it lose access."
  - `Replace database…` opens a Dialog with a FileDrop and the existing type-to-confirm (`REPLACE`), and progress reuses the existing import-progress polling.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): Settings as access and data rows`; push and open PR 5b against PR 5a.

---

## Part C — Problems and Contests (PR 5c)

### Task 6: Problems list (key-pages §4) and create dialog

**Files:**
- Rewrite: `frontend/src/features/admin/problems/ProblemManagement.tsx` (+ CSS)
- Create: `frontend/src/features/admin/problems/CreateProblemDialog.tsx`
- Modify: `frontend/src/services/admin/problemsAdminService.ts`, `frontend/src/types`
- Test: `frontend/src/tests/features/admin/ProblemManagement.test.tsx` (rewrite)

**Interfaces:**
- Consumes: Task 2's fields. The existing keyset paging, loader and bulk visibility/delete endpoints stay.

- [ ] **Step 1: Failing tests**
  - Header actions: `Import ZIP` (the existing batch upload), `⋯` → `Manage collections` (the existing CollectionsDialog), and primary `New problem`.
  - Filter chips (collection, visibility, author, search) with a count `12 of 146`.
  - Columns:
    - id (mono), title;
    - type tag only for header problems (`HEADER`);
    - difficulty, tests (mono), `1000 ms · 256 MB`;
    - collection (blank if none);
    - visibility dot (`Visible` / `Hidden` / `In contest`);
    - `⋯` with Edit, Testcases, Rejudge, Show/Hide, Copy link and a red Delete.
  - Row click → `/admin/problems/:id`. Testcases → `/admin/problems/:id/testcases`.
  - Rejudge is a plain confirm that calls `POST /admin/rejudge/problem/:id` (admin). Staff don't see it.
  - Bulk: Show, Hide, Delete (destructive confirm naming the count). `Show all 146 matching` carries its count.
  - Create dialog: id, title → `POST /admin/problems` with defaults → navigate to `/admin/problems/<id>`. A duplicate id shows "Problem id already exists." (409).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): Problems list with facts, row menu and create dialog`

### Task 7: Problem edit page — General, Statement, Danger zone

**Files:**
- Create:
  - `frontend/src/features/admin/problems/ProblemEditPage.tsx`
  - `ProblemGeneralTab.tsx`, `ProblemStatementTab.tsx`, `ProblemDangerTab.tsx` (+ CSS)
- Delete (once unused): `ProblemModal.tsx`, `ProblemMigrationModal.tsx` (if only used by the modal)
- Test: `frontend/src/tests/features/admin/ProblemEditPage.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /admin/problems/:id` (Task 2 fields);
  - `PUT /admin/problems/:id` and the `/upload` PDF endpoint;
  - `PUT /admin/problems/:id/visibility`;
  - `DELETE /admin/problems/:id`;
  - collections.
- Produces: `ProblemEditPage` with tabs `general | statement | testcases | grader | danger`; `grader` only for header problems. The tab lives in the URL.

- [ ] **Step 1: Failing tests**
  - Header:
    - breadcrumb `Manage › Problems › <id>`, the title, a type tag (`STANDARD` / `HEADER`);
    - meta `id · Visible|Hidden|In contest · in collection X`;
    - actions `View as student` (link to `/problems/:id`) and primary `Save`.
  - When `type_locked`, the notice reads "Type locked · 214 submissions. The problem type and submission filename can't change once anyone has submitted.", and those fields are disabled.
  - General fields:
    - Title, Author, Time limit (ms), Memory limit (MB);
    - Difficulty, with the hint "800–3500 · sets the XP for a first solve (+N XP)" (N from `constants/progression` mirror);
    - Collection select, Categories chips.
  - Visibility is a dot + `Hide`/`Show` button (plain confirm), not a toggle.
  - Save sends only changed fields. A 400 shows field errors inline. Leaving with unsaved changes asks (plain confirm).
  - Statement tab: current PDF (open link), FileDrop to replace (PDF only, the existing upload limit).
  - Danger zone: `Delete problem` (typed confirm with the id, body "214 submissions and 38 solves go with it").
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): full-page problem editor`

### Task 8: Problem edit page — Testcases and Grader files

**Files:**
- Create: `frontend/src/features/admin/problems/ProblemTestcasesTab.tsx`, `ProblemGraderTab.tsx` (reuse `ProblemFilesSection` internals)
- Delete (once unused): `TestcasesDialog.*`
- Test: `frontend/src/tests/features/admin/ProblemTestcasesTab.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /admin/problems/:id/testcases`;
  - the chunked `testcases-upload/{init,chunk,complete}` flow (existing client);
  - `POST /admin/rejudge/problem/:id`.

- [ ] **Step 1: Failing tests**
  - Summary line `10 testcases · 2.4 MB`.
  - Table: #, input name + line count, output name, size (mono, right), and a view action (Dialog with the first 4 KB).
  - FileDrop "Replace all testcases — drop a ZIP of N.in / N.out pairs".
  - With `submission_count > 0`, dropping opens a confirm titled `Replace 10 testcases with 12?` naming "214 earlier submissions". A `Rejudge after replacing` switch is on by default:
    - the primary is `Replace and rejudge`, which uploads then rejudges;
    - with the switch off the label is `Replace testcases`, and no rejudge runs.
  - With no submissions there is no rejudge row.
  - Grader files tab (header problems): the existing grader/starter file sections in the tab layout.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): testcases and grader files tabs`

### Task 9: Contests list and create Drawer

**Files:**
- Rewrite: `frontend/src/features/admin/contests/ContestManagement.tsx` (+ CSS)
- Create: `frontend/src/features/admin/contests/CreateContestDrawer.tsx`
- Delete (once unused): `ContestModal.tsx`
- Test: `frontend/src/tests/features/admin/ContestManagement.test.tsx` (rewrite)

- [ ] **Step 1: Failing tests**
  - Header: meta "Times are Asia/Bangkok (UTC+7)" and primary `New contest`. Status SegmentedControl `All / Scheduled / Running / Finished`.
  - Columns:
    - title (→ `/admin/contests/:id`);
    - status dot (`Running · 1:12:08 left`, `Scheduled`, `Finished`);
    - starts (mono), duration (mono, right), participants, problems;
    - visibility dot;
    - `⋯` with Edit, Open contest page, Show/Hide, and a red Delete (typed confirm with the title; disabled while running, as today).
  - Create Drawer:
    - title, description, start date + start time (24 h; 15-minute steps offered, free entry allowed);
    - duration presets `1 h / 2 h / 3 h / 5 h / Custom`, with the line "Ends Thu 27 Nov, 21:00";
    - a visibility switch and the note "Times are Asia/Bangkok (UTC+7)".
  - Create posts the start and end as Bangkok times converted to ISO (a test pins `2026-11-27 19:00` + 2 h → `2026-11-27T12:00:00.000Z` / `14:00Z`), then navigates to the new contest's Problems tab.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): Contests list and create drawer`

### Task 10: Contest edit page — Settings, Problems (reorder), Participants

**Files:**
- Create:
  - `frontend/src/features/admin/contests/ContestEditPage.tsx`
  - `ContestSettingsTab.tsx`, `ContestProblemsTab.tsx`, `ContestParticipantsTab.tsx` (+ CSS)
- Modify: `frontend/src/services/admin/contestsAdminService.ts` (`reorderProblems(id, ids)`)
- Test: `frontend/src/tests/features/admin/ContestProblemsTab.test.tsx` and `ContestEditPage.test.tsx`

**Interfaces:**
- Consumes:
  - `PUT /admin/contests/:id/problem-order` (phase 4 B4);
  - `GET /admin/contests/:id/admin-problems` (already ordered);
  - `POST /admin/contests/:id/problems` (move_to_contest);
  - `DELETE /admin/contests/:id/problems/:problemId`;
  - `GET /admin/contests/available-problems`;
  - `PUT /admin/contests/:id`;
  - the contest scoreboard (Participants).

- [ ] **Step 1: Failing tests**
  - Header: breadcrumb `Manage › Contests`, the title + status tag, meta window · registered, action `Open contest page`. Tabs `Settings | Problems N | Participants N` live in the URL.
  - Settings tab: the same fields as the create Drawer, with Save.
  - Problems tab, ordered list:
    - each row has a drag handle, a letter A…, title, id (mono) and remove ✕;
    - `Add a problem by id or title…` is a searchable picker over available problems.
  - Reordering:
    - a drop calls `reorderProblems` with the new full id order and the letters update;
    - a drop in place sends nothing;
    - each row's `⋯` has `Move up` / `Move down` for keyboard users.
  - Remove is a plain confirm ("returns it to the practice set").
  - When finished, the list is read-only and says "Problems can't be added or removed after the contest ends."
  - Participants tab (read-only): user, joined at, score, ordered by rank.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): full-page contest editor with problem reorder`; push and open PR 5c against PR 5b.

---

## Part D — Analysis and verification (PR 5d)

### Task 11: Analysis routes, KPI strip, verdict-coloured chart

**Files:**
- Modify:
  - `frontend/src/features/admin/analysis/AnalysisPage.tsx`
  - `OverviewTab.tsx` (+ CSS)
  - `analysisCharts.ts`
  - `frontend/src/App.tsx` (route from Task 3)
- Test: `frontend/src/tests/features/admin/AnalysisPage.test.tsx`

- [ ] **Step 1: Failing tests**
  - Tabs are links to `/admin/analysis/{overview,users,problems,contests,submissions}`. User/contest ids and compare live in the query string, as today.
  - The range SegmentedControl `7d / 30d / 90d / All` sits in the header and is kept in `?range=`.
  - KPI strip: five cells, each with a neutral delta "▲ 12% vs prev. 30d" (no green/red), and no delta for `All`.
  - The verdict pie is gone. Submissions-per-day bars stack by verdict using the verdict tokens (`--verdict-accepted`, …).
  - `Export CSV` downloads the visible table.
  - At 390 px, `document.documentElement.scrollWidth <= innerWidth` (asserted in the Task 12 visual spec).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): Analysis routes, KPI deltas and verdict-coloured chart`

### Task 12: Visual baselines, guards, verification, PRs

**Files:**
- Create: `frontend/tests/visual/manage-pages.spec.ts` (+ snapshots); extend `mockAdminApi` in `fixtures.ts`.
- Modify: `frontend/src/tests/design/designGuards.test.ts` (PageHeader list adds the new pages; old modals deleted)

- [ ] **Step 1:** Visual spec.
  - Shots, desktop + phone: `users`, `users-bulk`, `user-edit-drawer`, `batch-result`, `problems`, `problem-general`, `problem-testcases-confirm`, `contests`, `contest-problems`, `contest-create`, `analysis`, `settings`. Add dark for `settings` and `problems`.
  - Keyboard focus on the Users first row action and the contest reorder Move up item.
  - Run `npm run test:visual:update`, then **read every PNG** against `phase5-manage.html`.
- [ ] **Step 2:** Gates, all green:
  - full backend suite;
  - frontend gate;
  - `npm run build`;
  - `npm run test:visual`.
- [ ] **Step 3:** Real-stack smoke on a rebuilt local stack.
  - Staff/admin pages need an admin session. If no admin credentials are available without reading secret files, smoke the API with backend tests only and ledger the gap.
- [ ] **Step 4: Commit** `test(web): phase 5 visual baselines and guards`; push and open PR 5d against PR 5c. Then the final whole-branch review per executing-plans.

---

## Rulings made while planning

- **Last active** = the latest of last login (new `users.last_login_at`) and last submission. There was no activity column, and a per-request write would be costly. Cost if wrong: a user who only browses shows their login time.
- **Bulk rejudge across problems (B6):** stays the existing frontend loop over `POST /admin/rejudge/problem/:id`, as §9 allows. Cost if wrong: a slow loop for very large selections.
- **"Last replaced by" on testcases** (mockup) isn't shown. Testcases carry no replacement time or author, and adding one is out of scope. Cost if wrong: the summary line is shorter than the mockup.
- **Drag-to-reorder** uses native drag events plus `Move up/Move down` menu items, with no library (§5.1 allows none). Cost if wrong: touch dragging is less smooth than a library's.
- **Users and Settings stay admin-only,** as today, even though §7.8 says "staff/admin" for Manage. Changing who may edit accounts is a policy change the spec doesn't ask for. Cost if wrong: staff still can't manage users.
