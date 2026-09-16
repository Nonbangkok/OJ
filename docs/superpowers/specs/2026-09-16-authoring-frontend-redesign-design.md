# Problem Authoring Frontend Redesign

**Date:** 2026-09-16
**Status:** Approved in conversation; awaiting review of this written specification

## 1. Purpose

Redesign the existing human-first Problem Authoring frontend so an administrator can
understand what is complete, what is blocked, and what to do next without reasoning
about raw revisions, job types, or backend lifecycle rules. The redesign retains the
existing draft, runner, verification, publication, and published-statement-revision
semantics while replacing the current tab-heavy interface with a guided workspace.

The primary experience is desktop-first. Mobile supports draft discovery, status,
job monitoring, preview, and lightweight edits; it is not required to provide an
equally efficient environment for large statement, C++, or testcase editing.

This specification supersedes the frontend workflow and explicit-save decisions in
section 6 of `2026-09-12-problem-authoring-workspace-design.md`. It does not supersede
that document's backend lifecycle, security, runner, verification, or publication
requirements, as amended by the later published-statement-revision design.

All user-facing Authoring copy remains in English. Established competitive-programming
terms such as Solution, Testcases, Compile, Verify, and Publish remain untranslated.

## 2. Goals

- Make the next valid action obvious at every stage.
- Explain why an action is unavailable and link to the step that resolves it.
- Preserve work automatically without weakening optimistic revision safety.
- Keep high-risk actions explicit and close to their confirmation.
- Scale draft discovery and testcase management beyond small demo datasets.
- Present job progress and useful diagnostics without exposing raw implementation
  names by default.
- Provide capable source editors for statements, solutions, and generators.
- Restore reliable desktop and mobile layout behavior through scoped design-system
  primitives and visual regression coverage.

## 3. Non-goals

- Changing authoring-runner execution, isolation, resource, or artifact semantics.
- Changing Verify All, exact-output comparison, or Publish transaction rules.
- Adding AI-assisted authoring, alternate checkers, stress testing, or languages
  other than the currently supported C++20 authoring flow.
- Making complex C++ and testcase authoring equally productive on a phone.
- Replacing the main OJ or non-authoring Admin Panel design beyond shared fixes that
  are required for a responsive Admin shell.
- Automatically publishing a problem or changing its public visibility.

## 4. Product structure

Problem Authoring remains inside the existing Admin Panel and has two levels.

### 4.1 Draft dashboard

`/admin/authoring` is a resumable work dashboard rather than a plain table.

It provides:

- Search by problem ID or title.
- Filters for Draft, Ready, Published, Running, and Needs attention.
- Stable sorting, initially by most recently updated.
- Paginated results.
- Each row or card shows problem ID, title, author, lifecycle status, last update,
  current step completion, active/failed job, and the most relevant next action.
- A primary **Create problem** action.
- A separate `/admin/authoring/authors` **Author profiles** management route.
  Profile management is not expanded inline between dashboard actions and draft
  results.

Creating a problem opens a short dialog that initially asks only for Problem ID,
Title, and Author Profile. Language, country, time limit, memory limit, and template
use profile or system defaults and remain editable in the workspace.

On narrow screens the dashboard becomes a card list. Mobile supports search,
filtering, opening a draft summary, viewing previews, and monitoring jobs without
attempting to fit the desktop table or navigation into a horizontal viewport.

### 4.2 Guided draft workspace

A draft opens in a dedicated Authoring layout with these addressable routes:

1. `/overview` — Overview & Metadata
2. `/statement` — Statement
3. `/solution` — Solution
4. `/testcases` — Testcases
5. `/review` — Review & Publish

The layout contains:

- A workspace header with problem ID/title, lifecycle status, save state, current
  revision, active-job indicator, and the primary action for the current step.
- A desktop sidebar with the five steps. Each step displays Complete, Needs
  attention, Running, or Not started.
- A compact mobile step selector and status summary.
- A main step panel.
- An Activity drawer for current and recent jobs.

The steps remain freely navigable; this is guided navigation, not a blocking wizard.
Opening a draft without a step route redirects to the first incomplete step, or to
Review when all authoring requirements are complete. Refresh, browser Back/Forward,
and copied URLs preserve the selected step.

## 5. Editing and save model

### 5.1 Autosave

Metadata and source fields autosave after 800–1,000 ms of inactivity. The workspace
header always displays one of:

- **Saving...**
- **Saved** with the saved revision
- **Offline — changes kept locally**
- **Conflict — review required**

A **Save now** action flushes pending changes immediately. Autosave requests are
serialized; a later local edit cannot be acknowledged by an older response. Every
request continues to send `expectedRevision`, and a successful response advances the
base revision used by the next save.

Before Compile, Generate, Build PDF, Verify, asset mutation, or Publish, the frontend
flushes pending autosave and uses the resulting saved revision. If saving fails, the
requested action does not start and the UI identifies the save failure as the blocker.

### 5.2 Local recovery and conflicts

Unsaved source recovery remains local to the browser tab. Recovery data records its
base revision and never silently overwrites newer server data.

Statement, solution, generator, and metadata recovery uses a bounded IndexedDB
record per draft and browser tab because the combined source limits can exceed safe
`sessionStorage` capacity. File selections and uploaded bytes are never persisted
locally. Successful save, explicit server reload, or explicit discard removes the
corresponding recovery record.

On conflict, the workspace preserves local changes and opens a conflict panel with:

- Reload server version.
- Keep the local copy open for comparison.
- Copy or download local source before discarding it.

The initial redesign does not implement automatic text merging. It must never label
discarding local work as the only recovery path.

### 5.3 Action locking

The frontend stops using one undifferentiated `actionsDisabled` state as user-facing
logic. Every action has a structured availability result:

```ts
type ActionAvailability =
  | { allowed: true }
  | { allowed: false; reason: string; resolutionStep?: WorkspaceStep };
```

The backend remains authoritative. Frontend availability improves guidance and does
not replace server validation. A running job locks only inputs that its immutable
snapshot depends on; unrelated navigation and inspection remain available.

## 6. Step designs

### 6.1 Overview & Metadata

Fields are grouped into Identity, Author, and Runtime Limits. Desktop uses a compact
two-column layout; mobile uses one column. The author block displays the snapshot
avatar and author identity. Snapshot and refresh behavior is explained through
contextual help rather than permanent paragraphs between controls.

Refreshing from an author profile remains explicit because it advances the revision
and invalidates readiness. Published Problem ID locking and published-revision rules
remain unchanged.

### 6.2 Statement

Replace the plain textarea with CodeMirror 6 configured for the supported hybrid
Markdown, HTML, and LaTeX source. Required capabilities are:

- Line numbers, search, selection, undo/redo, and common keyboard shortcuts.
- Markdown/HTML highlighting with safe handling of LaTeX delimiters.
- Existing tab-local recovery and conflict behavior.
- The current responsive source/fast-preview split on desktop.
- Preview-first mobile presentation with an explicit source-edit mode.
- Persisted split ratio and preview zoom.

The asset area becomes a gallery with thumbnail, filename, size, **Copy path**,
**Insert at cursor**, and Delete actions. Upload is available beside the gallery.
The UI distinguishes Fast Preview from the authoritative PDF and displays PDF status
as Missing, Building, Current, Stale, or Failed.

### 6.3 Solution

Use CodeMirror 6 with C++ syntax highlighting and line numbers. The primary action is
**Compile solution**. Its latest diagnostics appear directly below or beside the
editor and include a friendly success/failure summary before bounded raw logs.

The screen identifies the revision that was compiled. Algorithm correctness remains
the author's responsibility and is stated as contextual help, not as the dominant
screen content.

### 6.4 Testcases

The default view begins with summary cards:

- Case count.
- Total input/output bytes.
- Cases with missing output.
- Source/generation revision.
- Latest generation/output job status.

The testcase table uses server-side pagination and filtering. It does not render up
to 1,000 cases at once. Selecting a case opens a row drawer or side panel for preview,
replace, and delete. Preview APIs should return only bounded preview text rather than
transferring a complete maximum-size testcase when the user requests a preview.

Generator controls live in a collapsible **Generation tools** section. Manual append
and ZIP replacement live in **Import tools**. Bulk/destructive operations use modal
confirmation at the action site. Missing output and a valid empty output remain
visually and semantically distinct.

### 6.5 Review & Publish

Replace the current generic readiness text with an actionable checklist. At minimum:

- Required metadata is valid and saved.
- Statement exists and is valid.
- Current PDF exists.
- Reference solution exists.
- At least one testcase exists.
- Every testcase has an output, including valid empty-output handling.
- Current revision has passed Verify All.
- No conflicting active job or unsaved change remains.

Every failed item includes its reason and links to the resolving step. The primary
action is **Verify problem** until verified, then **Publish problem** when the exact
revision is publishable. The Publish dialog states whether it creates a hidden legacy
problem or updates an already-published problem in place. Existing visibility and
transaction semantics remain unchanged.

## 7. Jobs and feedback

The Activity drawer replaces the always-visible job-history table below every step.
It contains:

- The active job with a phase/status presentation.
- Recent jobs, newest first, with friendly labels such as Build PDF, Compile
  solution, Generate inputs, Generate outputs, and Verify problem.
- Direct access to the latest relevant diagnostics from each step.
- Structured details and raw logs behind an Advanced disclosure.

Starting a job opens or highlights its activity item. Completion produces an inline
result in the originating step and a persistent history entry. Failures describe the
failed phase and offer a relevant retry; they do not require the user to search a
100-row table and inspect internal job names.

## 8. Confirmation and error handling

Use a shared accessible dialog for Generate replacement, output replacement, ZIP
replacement, testcase deletion, asset deletion, conflict discard, and Publish.

- Focus moves into the dialog and returns to the triggering control.
- Escape cancels when safe.
- The safe action receives initial focus.
- Destructive copy names the affected object and consequence.
- Confirmations never render at the bottom of a long page.

Field validation appears beside the field. Request and job errors appear in their
own step and in Activity. Global banners are reserved for workspace-wide conditions
such as offline state or revision conflict. Disabled controls expose their reason in
visible supporting text and accessible descriptions.

## 9. Frontend architecture

The redesign introduces focused components rather than extending the existing
workspace and testcase monoliths:

- `AuthoringDashboard`
- `CreateProblemDialog`
- `AuthorProfilesPage`
- `AuthoringWorkspaceLayout`
- `WorkflowSidebar`
- `WorkspaceHeader`
- `AutosaveController`
- `ActivityDrawer`
- `MetadataStep`
- `StatementStep`
- `SolutionStep`
- `TestcasesStep`
- `TestcaseTable`
- `TestcaseDrawer`
- `ReviewStep`
- `ConfirmationDialog`

A workspace controller owns saved revision, editable values, save queue, conflict,
active-job summaries, and step completion. Step components receive narrow models and
do not reimplement revision or locking rules.

CodeMirror is the single editor foundation for statement, solution, and generator
sources. The implementation should load language support appropriate to each step
and avoid bundling unrelated editor features.

## 10. CSS and responsive foundation

Before screen migration:

- Remove unscoped element selectors such as global `button { width: 100% }` from
  CSS modules.
- Add scoped Button, Input, Select, StatusBadge, Dialog, Drawer, and table primitives.
- Define primary, secondary, neutral, and destructive action hierarchy.
- Make the Admin navigation responsive. Desktop keeps the full navigation; narrow
  screens use a menu rather than absolutely positioning all links in one row.
- Ensure tables either become cards or use deliberate contained scrolling without
  forcing the whole document to overflow horizontally.
- Preserve dark and light themes with WCAG-conscious focus and contrast states.

Desktop targets widths of 1024 px and above. Narrow behavior must remain usable at
390 px. Complex editors may show a desktop recommendation on narrow screens but may
not produce overlapping navigation or inaccessible actions.

## 11. Backend read models

Mutation, runner, Verify, and Publish endpoints remain authoritative and retain their
current behavior. Compatible read additions may include:

### 11.1 Draft dashboard

Add `GET /admin/authoring/dashboard` with bounded query parameters for search,
status, sort, and pagination. Results include updated time, active/latest failed job
summary, and compact completion counts without source or artifact bytes. The existing
`GET /admin/authoring/drafts` array response remains compatible during migration.

### 11.2 Workspace summary

A read model for a draft returns structured step completion and readiness blockers.
It derives facts from the same persisted draft, artifact, testcase, and job state used
by backend validation. It does not make Publish decisions independently of the
existing transaction.

### 11.3 Testcase summary and pagination

Testcase metadata listing supports page/cursor and status filters. A summary returns
case count, total bytes, and missing-output count. A bounded preview endpoint returns
only the UI preview limit and explicit truncation flags.

### 11.4 Job summaries

Job list rows remain bounded and include enough structured phase/status information
for friendly labels and step-local feedback. Full bounded diagnostics remain on the
existing job-detail boundary.

All new read endpoints remain admin-only and `private, no-store`.

## 12. Migration strategy

Implement in vertical checkpoints that leave the existing authoring backend usable:

1. CSS isolation, shared primitives, responsive Admin shell, and visual baselines.
2. Read models for dashboard, workspace readiness, testcase summary/pagination, and
   bounded preview.
3. Draft dashboard and short create flow.
4. Dedicated workspace layout, routed steps, workspace controller, and autosave.
5. Statement and Solution editors with local diagnostics.
6. Paginated Testcases experience and action-site dialogs.
7. Review/Publish checklist and Activity drawer.
8. Responsive, accessibility, regression, and end-to-end hardening.

Existing authoring routes may redirect to their new step equivalents during the
migration. Existing API behavior remains supported until all current frontend tests
and browser workflow tests have moved to the new surfaces.

## 13. Testing and acceptance

### 13.1 Automated tests

- Unit tests for serialized autosave, stale-response rejection, flush-before-action,
  offline recovery, and revision conflicts.
- Backend tests for search/filter pagination, readiness facts, testcase pagination,
  and bounded previews.
- Component tests for every step, availability reason, dialog focus, and Activity
  updates.
- Integration tests for create, autosave, compile, generate/import, outputs, PDF,
  Verify, Publish, and published-statement correction.
- Visual regression at 1280×720 and 390×844 for dashboard, workspace, editors,
  testcases, dialogs, Activity, dark theme, and light theme.
- Keyboard and automated accessibility checks for navigation, editors, dialogs,
  drawers, status announcements, and focus restoration.

### 13.2 Acceptance criteria

- No Authoring or Admin navigation element overlaps or causes document-wide
  horizontal overflow at 390 px.
- Author profile rows preserve readable identity content and bounded actions.
- A user can identify the first incomplete step and its blocker without opening raw
  logs.
- Refresh and browser history preserve the selected workspace step.
- Pending autosave is durably saved before a job begins, or the job is not queued.
- Conflicts preserve local source and provide a recovery path before discard.
- Testcase navigation remains responsive at 1,000 cases and renders only the current
  page.
- Generate, replace, delete, and Publish confirmations are visible immediately at
  their triggering context and are keyboard accessible.
- Compile, PDF, generation, output, and verification results appear in their
  originating step without requiring job-history searching.
- Existing runner isolation, artifact integrity, revision safety, Publish rollback,
  and published-statement behavior continue to pass unchanged.

## 14. Approved decisions

- Use the guided-workspace redesign rather than a cosmetic cleanup or separate app.
- Keep Authoring within the existing Admin Panel.
- Optimize full authoring for desktop; provide mobile status and lightweight flows.
- Use English throughout the Authoring UI.
- Permit compatible backend read-model/API additions.
- Use autosave with explicit save status and flush-before-action behavior.
- Keep backend runner, Verify, and Publish semantics unchanged.
