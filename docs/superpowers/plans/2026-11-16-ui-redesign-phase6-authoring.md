# UI Redesign Phase 6 — Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the staff/admin Authoring area to spec §7.9, with backend B7 (readiness in the draft list) and B8 (drafts per author profile, username search to link an account):
- one Authoring hub with sub-tabs Drafts · Author profiles · AI docs;
- a draft workspace without its own left rail: a header with save state and one contextual primary, and step tabs with status glyphs;
- reworked Metadata, Statement, Solution/Generator, Testcases, Verify & publish and History tabs, plus the full-screen statement editor;
- the mobile policy (lists and views everywhere, light edits on Metadata only).

**Architecture:**
- The hub and every tab reuse the phase 2–5 primitives: PageHeader (with `tabs`), FilterBar, DataTable, ActionMenu, Drawer, Dialog, ConfirmDialog tiers, FileDrop, StatusDot, InlineError/InlineNotice, Field.
- One pure readiness model (`readiness.ts`) turns list rows (B7) and loaded workspace data into the same five states. The list's Ready squares, the step-tab glyphs and the Verify & publish ReadinessList all read it.
- Workspace state stays in `useAuthoringDraft` (autosave, conflict, jobs, publish). This phase changes the layout around it, not its behaviour.
- The draft's own left rail is deleted. The AppShell interim rule that collapsed the global sidebar on workspace pages (`defaultCollapsed`) is removed.
- Backend additions are additive: list fields and one search endpoint, no migration.

**Tech Stack:** React 19 + Vite + CSS Modules + Jest/RTL + Playwright (frontend); Express 5 + TypeScript + raw SQL + Zod + Jest/supertest (backend).

**Spec:** `docs/superpowers/specs/2026-11-15-ui-redesign-design.md` §7.9, §9 B7/B8, §10 phase 6 (and the §10 phase 2 interim rule this phase retires).

**Mockup:** `docs/superpowers/specs/2026-11-15-ui-redesign/phase6-authoring.html` (owner-approved 2026-11-16).

## Global Constraints

- UI copy stays English. Button labels are verbs ("Rebuild PDF", "Run Verify", "Replace all from ZIP…").
- No new libraries (§5.1). The code editor stays `react-simple-code-editor` + `highlight.js` (already dependencies).
- **Save state** strings, in mono in the header meta: `Saved · rev N` / `Saving…` / `Unsaved`. The full-screen editor additionally shows the badge `Published · live unchanged` while it edits a published draft.
- **One contextual primary** in the workspace header:
  - `Verify` when the draft isn't verified at its revision;
  - `Publish` when `canPublish`;
  - none while a job runs (a pill `<job label> · <status>` takes its place);
  - none on the Verify & publish tab (its footer holds Verify + Publish).
- **Step glyph states:** done ✓ (`--verdict-accepted`) · to do ○ (faint) · stale ◐ (`--warn`/amber) · failed ✕ (`--verdict-wrong`).
  - Computed in the frontend from data already loaded.
  - History and AI docs are right-aligned links, not steps.
- **Status values** are a dot + text: Draft (neutral), Generated (amber), Ready (green), `Published · rev N` (green), `Verify failed` (red, when the latest verify at the current revision failed).
- **Mobile policy:** lists and views everywhere; edits on Metadata only. Code/statement editors and uploads show "Best edited on a larger screen" with read-only content.
- Existing behaviour is kept:
  - autosave (1200 ms) and ⌘/Ctrl+S;
  - the conflict banner with "Discard local changes and sync";
  - editors read-only while a job runs;
  - publish gates and republish rules (header problems never republished);
  - the profile-sync gate dialog.
- Raw parameterized SQL, Zod validation, `asyncHandler`/`AppError`. Authoring routes stay `staff|admin`.
- Design guards, contrast guards and CSS-module isolation guards stay green. Visual baselines are regenerated and every new PNG is read before it is kept.
- Commits carry no Co-Authored-By trailer. PR bodies end with the Claude Code line.

## Review Focus

1. **A job is running.**
   - The header shows the job pill and no primary, the editors are read-only, and step actions are disabled.
   - When the job finishes (polling), the primary comes back without a reload, and a failed job turns the matching glyph red.
   - Test: Task 6.
2. **The server state changed under unsaved edits** (another tab, a profile sync bumping the revision).
   - The conflict banner and its discard action survive the layout change.
   - The save state reads `Unsaved` and never claims `Saved`.
   - Test: Task 6.
3. **A published draft.**
   - Metadata/Solution/Testcases are read-only and the header has no Publish.
   - The row menu and the header ⋯ offer "Start new revision". The full-screen editor still edits the statement and shows `Published · live unchanged`.
   - Tests: Tasks 6 and 10.
4. **Readiness with missing pieces.** A draft with no jobs, no PDF (`latestPdfRevision` null), no generator, zero testcases, or outputs missing on some cases maps to to-do/stale squares, never an error. The generator is optional and never blocks. Test: Task 3.
5. **Linking an account that is already linked to another profile.** The candidate shows "already linked to <AKA>" and can't be picked. A race that still hits the server's 409 `author_profile_user_conflict` shows as the field's error. Test: Task 5.

---

## Part A — Backend (PR 6a)

### Task 1: B7 — readiness in the draft list

**Files:**
- Modify:
  - `backend/services/authoringDraftQueryService.ts` (`listProblemDrafts` SQL)
  - `backend/controllers/authoringDraftController.ts` (`toDraftSummaryResponse`)
  - `backend/types/authoring.ts` (`ProblemDraftListRow`)
- Test: `backend/tests/integration/authoringDraftReadiness.test.ts` (real SQL, throwaway schema, following `tests/integration/adminProblemFacts.test.ts`)

**Interfaces:**
- Produces: each `GET /admin/authoring/drafts` row gains
  ```ts
  readiness: {
    hasStatement: boolean;          // statement_html <> ''
    hasSolution: boolean;           // solution_cpp <> ''
    hasGenerator: boolean;          // generator_cpp IS NOT NULL AND generator_cpp <> ''
    testcases: { total: number; withOutput: number };
    latestPdfRevision: number | null;
    // latest job per job_type (newest created_at), any revision
    latestJobs: Partial<Record<'compile_solution' | 'compile_generator' | 'run_generator' | 'generate_outputs' | 'build_pdf' | 'verify_all' | 'sync_pdf',
      { status: string; revision: number }>>;
    activeJob: boolean;             // any job in queued/compiling/running
  }
  ```
  plus `publishedAt: string | null`. The existing fields are unchanged.

- [ ] **Step 1: Failing tests**
  - `a bare draft has no statement, solution, generator, testcases, pdf or jobs`
  - `testcase counts split total and with-output`
  - `latestJobs keeps only the newest job per type`
  - `activeJob is true while a job is queued or running`
  - `the list stays one query (no per-row lookups)`: assert `db.query` is called once for a list of 3 drafts.
  - `mine filter still applies with readiness`
- [ ] **Step 2: Run** `npm test -- tests/integration/authoringDraftReadiness.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - Counts come from LEFT JOINed aggregates over `problem_draft_testcases`.
  - Latest jobs use `DISTINCT ON (draft_id, job_type) … ORDER BY draft_id, job_type, created_at DESC`, folded with `jsonb_object_agg`.
  - The list must not read BYTEA columns.
- [ ] **Step 4: Run** the new file plus `tests/authoringDraftController.test.ts` → PASS; then the backend gate.
- [ ] **Step 5: Commit** `feat(api): readiness fields in the authoring draft list (B7)`

### Task 2: B8 — drafts per author profile, account search for linking

**Files:**
- Modify:
  - `backend/services/authorProfileQueryService.ts` (`listAuthorProfiles`)
  - `backend/controllers/authorProfileController.ts`
  - `backend/schemas/requestSchemas.ts`
- Test: `backend/tests/integration/authorProfileFacts.test.ts`

**Interfaces:**
- Produces:
  - `GET /admin/author-profiles` rows gain `draftCount: number` (all drafts whose `author_profile_id` is the profile, published included) and `linkedUsername: string | null`.
  - `GET /admin/author-profiles/user-candidates?q=<1–50 chars>` (staff|admin) → up to 10 `{ id: number; username: string; role: 'user'|'staff'|'admin'; linkedProfile: { id: string; akaName: string } | null }`. Prefix match first, then contains; case-insensitive; ILIKE wildcards in `q` are escaped.
  - Registered before `/admin/author-profiles/:id` routes.

- [ ] **Step 1: Failing tests**
  - `draftCount counts every draft using the profile`
  - `linkedUsername names the linked account`
  - `user-candidates matches prefix first and marks accounts already linked`
  - `user-candidates escapes % and _`
  - `user-candidates rejects an empty q (400) and students (403)`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with a `LEFT JOIN` count (no correlated subquery) and the existing `requireAuth, requireStaffOrAdmin` guards.
- [ ] **Step 4: Run** the new file plus `tests/authorProfileController.test.ts` → PASS; backend gate.
- [ ] **Step 5: Commit** `feat(api): author profile draft counts and account search (B8)`; push and open PR 6a against `ui-redesign/phase5d-analysis`.

---

## Part B — Hub, drafts list, author profiles (PR 6b)

### Task 3: Readiness model and job vocabulary

**Files:**
- Create: `frontend/src/features/admin/authoring/readiness.ts`
- Modify:
  - `frontend/src/features/admin/authoring/status.ts` (job labels and statuses)
  - `frontend/src/features/admin/authoring/types.ts` (`DraftSummary` with `readiness`, `publishedAt`; `Profile` gains `draftCount`, `linkedUsername`)
- Test: `frontend/src/tests/features/admin/authoringReadiness.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReadinessState = 'done' | 'todo' | 'stale' | 'failed';
  export interface ReadinessInput {
    revision: number; verifiedRevision: number | null; status: Draft['status'];
    hasStatement: boolean; hasSolution: boolean; hasGenerator: boolean;
    testcases: { total: number; withOutput: number };
    latestPdfRevision: number | null;
    latestJobs: Partial<Record<string, { status: string; revision: number }>>;
  }
  export function readinessOf(input: ReadinessInput): Record<'statement' | 'solution' | 'generator' | 'testcases' | 'pdf' | 'verified', ReadinessState>;
  export function readinessFromSummary(row: DraftSummary): ReadinessInput;
  export function readinessFromWorkspace(draft: Draft, jobs: Job[]): ReadinessInput;
  export function listStatus(row: DraftSummary): { tone: 'neutral' | 'warn' | 'ok' | 'bad'; label: string }; // "Published · rev N", "Verify failed", …
  ```
- Rules (each a test):
  - **statement:** empty → todo, else done.
  - **solution:**
    - empty → todo;
    - latest `compile_solution` failed/timed_out → failed;
    - latest `compile_solution` (or `verify_all`) succeeded at the current revision → done;
    - otherwise → stale.
  - **generator:** same rules as solution on `compile_generator`, but with no generator the state is todo, and generator never feeds "can publish".
  - **testcases:**
    - total 0 → todo;
    - `withOutput < total` → stale;
    - latest `generate_outputs` failed at the current revision → failed;
    - else done.
  - **pdf:**
    - null → todo;
    - latest `build_pdf` failed at the current revision → failed;
    - `latestPdfRevision === revision` → done;
    - else stale.
  - **verified:**
    - `verifiedRevision === revision` → done;
    - latest `verify_all` failed/timed_out at the current revision → failed;
    - `verifiedRevision` set but older → stale;
    - else todo.
  - **published** drafts are reported as their stored readiness, so the squares stay green after publish.
- `status.ts`:
  - `run_generator` maps to "Generate inputs" (keep the `generate_inputs` alias).
  - Add the job statuses "Timed out", "Cancelled" and "Stale".

- [ ] **Step 1: Failing tests** — one per rule above, plus `a draft with nothing yet is all todo and never throws`, `generator absent → todo and does not affect verified`, `run_generator is labelled Generate inputs`, `timed_out is labelled Timed out`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest src/tests/features/admin/authoringReadiness.test.ts`).
- [ ] **Step 5: Commit** `feat(web): authoring readiness model and job labels`

### Task 4: Authoring hub and drafts list

**Files:**
- Create: `frontend/src/features/admin/authoring/AuthoringHub.tsx`, `DraftList.tsx`, `ReadinessSquares.tsx` (+ CSS)
- Modify:
  - `ProblemAuthoring.tsx` (routes the hub; the list code moves out)
  - `frontend/src/App.tsx` (hub routes keep `/admin/authoring`, `/profiles`, `/ai-docs`)
- Test: `frontend/src/tests/features/admin/DraftList.test.tsx`; update `ProblemAuthoring.test.tsx` for moved list behaviour.

**Interfaces:**
- Consumes: Task 3 (`readinessOf`, `readinessFromSummary`, `listStatus`).
- Produces:
  - `<ReadinessSquares states={…} />`: five 9 px squares (Statement · Solution · Testcases · PDF · Verified), `aria-label` "Statement done, Solution done, Testcases done, PDF out of date, Verified not yet".
  - The hub `PageHeader` has the title "Authoring", meta `N drafts · M published`, primary `New draft`, and `tabs` = links Drafts · Author profiles · AI docs.

- [ ] **Step 1: Failing tests**
  - The header has the sub-tab links and the `New draft` primary, which opens the existing "New draft" dialog.
  - Columns: Problem ID (mono), Title, Author, Ready (squares with the aria-label above), Status (dot + label, e.g. `Published · rev 9`), Updated. A row click opens `/admin/authoring/:id`.
  - Row ⋯: Open · Start new revision (published only) · Delete (destructive confirm naming the title). "Start new revision" calls the existing endpoint and opens the draft.
  - FilterBar: search (ID/title), segment `All drafts / Mine`, chips Author and Status, the count "N drafts". Filters live in the URL (`useUrlFilters`).
  - A legend line under the table: "Ready = Statement · Solution · Testcases · PDF · Verified" with done / out of date / failed / not yet.
  - Phone: DataTable two-line rows (title + squares; status · updated · id).
  - `/admin/authoring/profiles` and `/admin/authoring/ai-docs` render under the same hub header with that sub-tab selected (`aria-current="page"`); AI docs keeps its "Copy for AI agent" button.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): Authoring hub and drafts list with readiness`

### Task 5: Author profiles table and edit Drawer

**Files:**
- Modify: `AuthorProfiles.tsx`, `ProfileFieldsForm.tsx`, `AuthorProfiles.test.tsx`
- Create: `frontend/src/features/admin/authoring/UserLinkPicker.tsx`
- Move: the "Profile sync runs" panel from `JobHistory.tsx` into `AuthorProfiles.tsx` ("Recent profile syncs")

**Interfaces:**
- Consumes: Task 2 (`draftCount`, `linkedUsername`, `user-candidates`).
- Produces: `<UserLinkPicker value={userId|null} onChange={(id|null) => void} currentProfileId? />`, a combobox. It debounces 250 ms; each option shows the username, role, and "already linked to <AKA>" (disabled) when linked to another profile.

- [ ] **Step 1: Failing tests**
  - Table columns: Author (avatar + AKA), Real name, Language, Country (mono), Linked user (username or —), Drafts (count, mono, right). Row ⋯: Edit · Delete.
  - Delete of a profile with drafts is a destructive confirm naming the count. The server's 409 message is shown.
  - Edit and New open a right Drawer titled `Edit <AKA>` / `New author profile` with the existing fields and image crop. The meta line reads "Used by N drafts".
  - Linked user: typing `mint` lists candidates. A candidate linked elsewhere is disabled with "already linked to Mint K". Picking one sets it, and Clear unlinks.
  - A 409 `author_profile_user_conflict` shows under the Linked user field.
  - Saving a profile with linked drafts still opens the existing "Update linked problems?" gate.
  - "Recent profile syncs" lists the runs with status dot, progress `x/y synced`, and started. Inspect opens the existing run detail.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): author profiles table, edit drawer and account search`; push and open PR 6b against PR 6a.

---

## Part C — Draft workspace (PR 6c)

### Task 6: Workspace header, step tabs, no left rail

**Files:**
- Create: `frontend/src/features/admin/authoring/WorkspaceHeader.tsx`, `StepTabs.tsx`, `LargeScreenNotice.tsx` (+ CSS)
- Modify:
  - `DraftWorkspace.tsx` (delete `aside.leftNav` and the hover slider; keep the Outlet and the conflict banner)
  - `frontend/src/components/shell/AppShell.tsx` (delete `defaultCollapsed` and its interim rule)
- Test: `frontend/src/tests/features/admin/DraftWorkspace.test.tsx` (new); update the AppShell test that pinned the interim rule.

**Interfaces:**
- Consumes: `useAuthoringDraft` (`draft`, `jobs`, `dirty`, `saveState`, `activeJob`, `actionsDisabled`, `canPublish`, `conflict`, `runJob`, `publish`), Task 3 (`readinessFromWorkspace`, `readinessOf`).
- Produces:
  - `<WorkspaceHeader … />`:
    - breadcrumb `Manage › Authoring`; title + status dot;
    - meta `<problemId> · <save state>`;
    - actions: the contextual primary (Global Constraints), the job pill, and ⋯ (Start new revision when published · Delete draft).
  - `<StepTabs active />`: links Metadata · Statement · Solution · Generator · Testcases · Verify & publish, each with a glyph. Right-aligned links History (`/jobs`) and AI docs (`/ai-docs`).
    - Glyph sources: Statement = worse of statement and pdf; Solution; Generator; Testcases; Verify & publish = verified; Metadata = done unless the form has a field error.
  - `<LargeScreenNotice />`: "Best edited on a larger screen" plus one line of context, shown below 768 px.

- [ ] **Step 1: Failing tests**
  - No element with the old rail's "← All drafts". The breadcrumb links back to `/admin/authoring`.
  - Save state reads `Saved · rev 14`, then `Unsaved` after an edit, then `Saving…` during save.
  - Primary: `Verify` when unverified; `Publish` when `canPublish`, opening the existing publish confirm; none while a job is queued/running, with the pill `Compile solution · running` instead.
  - When polling reports the job finished, the primary returns. If the job failed, the Solution glyph shows failed.
  - The conflict banner and "Discard local changes and sync" still work.
  - A published draft has no primary, and its ⋯ has "Start new revision".
  - Glyphs: Statement stale when the PDF is older than the revision; Testcases failed when outputs are missing… (one case per state).
  - AppShell: the global sidebar no longer starts collapsed on `/admin/authoring/:id`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): authoring workspace header and step tabs`

### Task 7: Metadata and Statement tabs

**Files:**
- Modify: `MetadataFields.tsx`, `StatementTab.tsx`, `DraftWorkspace.tsx` (`DraftMetadata`, `DraftStatement`)
- Test: `frontend/src/tests/features/admin/DraftMetadataStatement.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`LargeScreenNotice`), `FileDrop`, `Field`, the XP mirror `config/progression.ts` (`solveXp`).

- [ ] **Step 1: Failing tests**
  - **Metadata:**
    - Two columns: Problem ID (mono, hint "Locked after the first publish.", disabled once published), Title, Author, Difficulty with hint "800–3500 · a first solve gives +N XP", Time limit with an `ms` unit, Memory limit with an `MB` unit.
    - Field errors render under the field (e.g. "At least 1 MB.").
    - Categories are toggle chips (`aria-pressed`).
  - **Statement:**
    - A card with the rendered statement (read-only, the existing renderer) and `Edit statement` → `/admin/authoring/:id/editor`.
    - The PDF row reads "PDF rev N"; when older than the draft, "older than the draft (rev M)" in amber. The row has `Rebuild` (runs build_pdf; disabled while a job runs) and `Open`. With no PDF yet: "No PDF yet" + `Build PDF`.
    - Images: a FileDrop (JPEG, PNG or WebP · 10 MB each) and a table with File · "Use in the statement" (`{{ASSET_BASE}}/name`, copy button) · Size · ⋯ Delete.
  - Phone: Metadata stays editable; Statement shows the rendered statement and `LargeScreenNotice` instead of uploads.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): authoring metadata and statement tabs`

### Task 8: Solution, Generator and Testcases tabs

**Files:**
- Modify: `CodeEditor.tsx` (line-number gutter, theme-aware highlight classes shared with the submission editor), `DraftWorkspace.tsx` (`DraftSolution`, `DraftGenerator`, `DraftTestcases`), `TestcaseFiles.tsx`, `TestcaseTable.tsx`, `TestcaseDialogs.tsx`
- Test: `frontend/src/tests/features/admin/DraftCodeTestcases.test.tsx`; update `CodeEditor.test.tsx`, `TestcaseFiles.test.tsx`

**Interfaces:**
- Consumes: Task 3 (job labels), Task 6 (`LargeScreenNotice`, read-only while `actionsDisabled`).

- [ ] **Step 1: Failing tests**
  - **Solution:**
    - A `solution.cpp` editor with a line-number gutter; read-only with "Read-only while the job runs" during a job.
    - A side panel "Last compile" showing a status dot, Revision, Time, and Warnings from the latest `compile_solution`.
    - When that compile is at an older revision: "Compiled at rev N — the code changed since…". `Compile` (secondary) runs `compile_solution`.
  - **Generator:** the same shape on `compile_generator` plus the seed + `Generate inputs`. Without a generator, a "No generator — testcases can be uploaded instead" notice and a "Start from the template" action (existing `generatorTemplate.ts`).
  - **Testcases:**
    - The summary line "N testcases · X MB", with "· K missing output" in red when K>0.
    - A Generate card: Seed, `Generate inputs` and `Generate outputs`, with the existing replace confirms.
    - Table # · Input (filename, mono) · Input size · Output size ("missing" in red) · Source (`generated · rev N` / `uploaded`) · ⋯ Inspect / Replace / Delete.
    - A FileDrop "Add a testcase" (input + optional output) and `Replace all from ZIP…` with the destructive confirm naming the old count.
  - Phone: code read-only + `LargeScreenNotice`; Testcases view-only (no FileDrop, no ⋯ edits).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): authoring solution, generator and testcases tabs`

### Task 9: Verify & publish and History

**Files:**
- Create: `frontend/src/features/admin/authoring/ReadinessList.tsx`
- Modify: `DraftWorkspace.tsx` (`DraftVerify`, `DraftJobs`), `JobHistory.tsx`
- Test: `frontend/src/tests/features/admin/DraftVerifyHistory.test.tsx`; update `JobHistory.test.tsx`

**Interfaces:**
- Consumes: Task 3, Task 6 (the header has no primary on this tab).

- [ ] **Step 1: Failing tests**
  - **ReadinessList rows,** each with a glyph, title, detail and a fix link:
    - Metadata;
    - Statement;
    - `Solution compiles at rev N`, fix "Compile now";
    - Testcases, detail "24 cases, all with outputs · 3.1 MB", fix "Open testcases";
    - `PDF current`, detail "The PDF is from rev 12.", fix "Rebuild PDF";
    - `Verified at rev N`, detail "Last verified at rev 12.", fix "Run Verify".
    - Fix links run the job or go to the tab.
  - **Footer:**
    - `Verify` (secondary) and `Publish` (primary).
    - A disabled Publish shows its reason beside it, from the first failing row ("Rebuild the PDF and verify rev 14 before publishing."). An enabled Publish opens the existing confirm.
  - **A failed verify** shows an InlineNotice with the failing case and the existing `verifyFailureExplanation` title/detail.
  - **History:**
    - Columns Job · Result (dot + label, "Failed · case 7 wrong answer") · Revision · When. Labels use Task 3 ("Generate inputs", "Timed out").
    - A row click opens a right Drawer `<Job> · rev N` with the failure notice, checks, per-case table and Log (the existing Inspect content).
    - Profile sync runs are no longer here (moved in Task 5).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): verify and publish readiness list and job history drawer`; push and open PR 6c against PR 6b.

---

## Part D — Full-screen editor and verification (PR 6d)

### Task 10: Full-screen statement editor (FocusShell)

**Files:**
- Modify: `StatementEditor.tsx`, `StatementEditor.test.tsx`, `LivePreview.tsx`, `CodeEditor.tsx` (a `language: 'cpp' | 'html'` prop)

**Interfaces:**
- Consumes: Task 8 `CodeEditor` (gains `language`, default `'cpp'`).

- [ ] **Step 1: Failing tests**
  - **Top bar:**
    - `← Workspace`, the title, and the save state (`Saving…` / `Saved · rev N` / `Unsaved`).
    - The badge `Published · live unchanged` when the draft is published.
    - Segment `Preview / PDF`; zoom `− Fit +` with Fit as the default; the hint "⌘S save".
  - The source uses the shared `CodeEditor` from Task 8 (line-number gutter, HTML highlighting via highlight.js `xml`, theme-aware). Preview defaults to fit-to-width.
  - Switching to PDF when the PDF is stale shows "PDF is from rev N" + `Build PDF now` (existing auto-build kept).
  - Below 768 px: tabs `Source / Preview` instead of the split.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(web): full-screen statement editor polish`

### Task 11: Visual baselines, guards, verification, PRs

**Files:**
- Create: `frontend/tests/visual/authoring-pages.spec.ts` (+ snapshots); extend `fixtures.ts` with `mockAuthoringApi`.
- Modify:
  - `admin-shell.spec.ts` / `author-profiles.spec.ts` (update or fold into the new spec)
  - `frontend/src/tests/design/designGuards.test.ts` (PageHeader list adds `AuthoringHub.tsx`; the workspace uses `WorkspaceHeader`, which renders PageHeader)

- [ ] **Step 1: Visual spec.**
  - Shots, desktop + phone: `authoring-drafts`, `author-profiles`, `author-profile-drawer`, `draft-metadata`, `draft-statement`, `draft-solution-running`, `draft-testcases`, `draft-verify`, `draft-history-drawer`, `statement-editor`. Add dark for `draft-verify` and `authoring-drafts`.
  - Keyboard focus is checked on the first draft row action and on the first step tab.
  - Every shot asserts `scrollWidth <= innerWidth`.
  - Run `npm run test:visual:update`, then **read every PNG** against `phase6-authoring.html`.
- [ ] **Step 2:** Gates, all green: the full backend suite; the frontend gate; `npm run build`; `npm run test:visual`.
- [ ] **Step 3:** Real-stack smoke on the rebuilt local stack.
  - The owner has an admin session.
  - If no admin credentials are available without reading secret files, smoke the API with backend tests only and ledger the gap.
- [ ] **Step 4: Commit** `test(web): phase 6 visual baselines and guards`; push and open PR 6d against PR 6c. Then the final whole-branch review per executing-plans.

---

## Rulings made while planning

- **No migration:** B7/B8 are read-side only (list SQL and a search endpoint). Cost if wrong: none.
- **Generator is optional:**
  - it has a step glyph, but no Ready square and no publish gate;
  - this matches the server gate (generator passed *or skipped*).
  - Cost if wrong: an author may not notice a broken generator until Verify.
- **The existing `/search/users` isn't reused for linking:**
  - it has no role or "already linked" facts, and its limits serve submission search;
  - a dedicated staff route keeps both stable.
  - Cost if wrong: one extra small endpoint.
- **Profile sync runs move from History to Author profiles** (spec: "profile sync runs move to Author profiles"). Cost if wrong: an author looking in History won't find them there.
- **The code editor stays `react-simple-code-editor`** with a line-number gutter, rather than a new editor library (§5.1 forbids new libraries). Cost if wrong: no folding or multi-cursor.
