# Admin Problem Authoring UI — Slice 10

Slice 10 integrates the complete human-first authoring workflow directly into
the existing Admin Panel. Only authenticated `admin` users can open
`/admin/authoring`; staff and ordinary users cannot load authoring APIs from this
page. AI-assisted authoring remains a future extension.

## Workspace

The draft list creates drafts, opens saved drafts and manages reusable author
profiles. A draft has five tabs:

1. **Metadata** — problem ID, title, author snapshot, language/country and limits.
2. **Statement** — entry to the full-screen source editor, statement assets,
   fast preview and authoritative PDF.
3. **Solution** — private C++20 reference solution and explicit compilation.
4. **Testcases** — optional C++20 generator, seed, manual/ZIP files and outputs.
5. **Verify & Publish** — readiness, reports, diagnostics, PDF and Publish.

Editing never autosaves to the server. The toolbar shows saved/dirty/read-only state and Save
sends only changed fields with `expectedRevision`. Unsaved changes, a revision
conflict, an active job or a published draft disable destructive/job actions.
There is no general Reload button. A clean draft refreshes automatically on
window focus/visibility changes. Dirty text is never overwritten; if the server
revision advances, the UI reports a conflict and exposes the conflict-only
**Discard local changes and sync** action. Leaving with unsaved changes prompts
for confirmation. The full-screen statement editor also keeps a tab-local
session recovery copy, so browser Back/Forward cannot silently destroy dirty
source. A recovered copy retains its original base revision and therefore cannot
hide a conflict with newer server work. Successful Save or explicit discard
clears the recovery copy.

Author profile selection copies display data into the draft snapshot. Editing a
profile does not silently alter drafts; **Refresh from profile** is explicit and
advances the revision. JPEG/PNG/WebP input is decoded client-side for a square,
adjustable crop and is uploaded as a 512×512 PNG. The backend remains the
authoritative decoder/normalizer. Removing an image uses the deterministic
first-character fallback avatar.

## Preview, files and jobs

`/admin/authoring/:draftId/editor` is a dedicated full-viewport statement editor.
It bypasses the Admin navigation and normal content container. The desktop view
places source and preview side-by-side; narrow screens stack them. A compact top
bar provides Workspace, title/state, Save and Build PDF. Statement assets and
syntax help remain available in a collapsible footer. The normal Statement tab
opens this route and retains the authoritative PDF preview. The pane divider is
drag- and keyboard-resizable, persists its layout per draft, and double-click
resets it to 50/50. The fast preview has local 50–200% zoom controls; it is HTML
for quick feedback rather than a claim to be the final PDF.

`POST /admin/authoring/drafts/:id/preview` compiles the current unsaved source with
the pinned task-pdf-writer Marked bundle, sanitizes it, and server-renders the four
supported KaTeX delimiter forms. It embeds only the
saved draft header/avatar/assets and returns a self-contained, script-free HTML
document with a restrictive CSP. The opaque-origin iframe is also sandboxed.
Source changes trigger this preview after a 400 ms pause; stale responses cannot
replace a newer result, and an error keeps the last good preview and source.
This is a fast preview only; the runner-built wkhtmltopdf document remains
authoritative.

While a task is published, normal workspace fields are read-only. Its dedicated
statement editor may save a statement-only correction, which starts a new draft
revision and shows that the live grader problem is unchanged. After that save, the
normal draft fields are editable again except for the permanently locked Problem
ID. Build/Verify and a subsequent Publish are required before the existing legacy
problem's PDF and testcases are replaced.

Testcase lists contain metadata only. Inspect fetches one pair and renders at
most 32 KiB per side (the current detail endpoint still transfers the complete,
bounded file). Empty output and missing output remain distinct. Append, replace,
delete and ZIP whole-set replacement use expected revisions. Input-only replace
clears its old output. ZIP replace, generator replacement, output replacement and
Publish require explicit confirmation.

The workspace fetches one initial draft/history snapshot. It polls every three
seconds only while a durable job is active, so an idle editor cannot exhaust the
global API rate limit. Reloading during a job resumes polling from server state.
If an action races a job started elsewhere, the UI refreshes job state without
misclassifying the unchanged statement as a revision conflict.
The 100-row history list excludes logs, source snapshots and full result reports;
Inspect fetches one job's bounded diagnostics/report. Verify reports show checks,
case/byte totals, per-case wall times and the explicit memory/reproducibility
limitations.

Publish is available only for the exact saved, verified revision with a current
PDF. Its confirmation states whether it creates a hidden legacy problem or updates
the task's existing one in place. Visibility is managed later through Problem
Management.

## Added read APIs

- `GET /admin/authoring/drafts/:id/jobs` — latest 100 bounded metadata rows.
- `POST /admin/authoring/drafts/:id/preview` — unsaved sanitized fast preview.
- `GET /admin/authoring/drafts/:id/assets/:assetId` — private normalized image.

All require admin authentication and use private/no-store responses. Existing
single-job detail, PDF, mutation and Publish APIs remain authoritative.

## Verification

- Canonical disposable backend stack: **65 suites / 580 tests passed**. This
  includes real PostgreSQL, C++20 runner, wkhtmltopdf and an HTTP workflow that
  creates, edits, generates, builds outputs/PDF, verifies and publishes hidden,
  plus task-pdf-writer Markdown/HTML/LaTeX compatibility regressions.
- Frontend: **63 suites / 326 tests passed**; production type-check, all-test
  type-check, ESLint and optimized build passed.
- Compose policy tests: **5 passed**.
- A separate localhost browser fixture completed the same author workflow and
  confirmed the responsive five-tab layout, full-screen split editor,
  Thai/KaTeX preview, live job/file updates, Verify report, current PDF and
  hidden read-only publication. At 1280×720 the editor workspace occupied 610px;
  the saved Red Gate preview rendered one H1, two images, two tables and 19 KaTeX
  nodes with zero scripts.
- Tests used disposable Compose projects only. Existing local and production
  services/databases were not migrated, redeployed or modified.
