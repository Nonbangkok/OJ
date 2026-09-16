# Admin Problem Authoring UI — Slice 10

Slice 10 integrates the complete human-first authoring workflow directly into
the existing Admin Panel. Only authenticated `admin` users can open
`/admin/authoring`; staff and ordinary users cannot load authoring APIs from this
page. AI-assisted authoring remains a future extension.

## Workspace

The draft list creates drafts, opens saved drafts and manages reusable author
profiles. A draft has five tabs:

1. **Metadata** — problem ID, title, author snapshot, language/country and limits.
2. **Statement** — task-pdf-writer-compatible Markdown/HTML/LaTeX source,
   statement assets, fast preview and PDF.
3. **Solution** — private C++20 reference solution and explicit compilation.
4. **Testcases** — optional C++20 generator, seed, manual/ZIP files and outputs.
5. **Verify & Publish** — readiness, reports, diagnostics, PDF and Publish.

Editing never autosaves. The toolbar shows saved/dirty/read-only state and Save
sends only changed fields with `expectedRevision`. Unsaved changes, a revision
conflict, an active job or a published draft disable destructive/job actions.
Unsaved text is retained after a conflict; Reload is the explicit discard path.
Leaving with unsaved changes prompts for confirmation.

Author profile selection copies display data into the draft snapshot. Editing a
profile does not silently alter drafts; **Refresh from profile** is explicit and
advances the revision. JPEG/PNG/WebP input is decoded client-side for a square,
adjustable crop and is uploaded as a 512×512 PNG. The backend remains the
authoritative decoder/normalizer. Removing an image uses the deterministic
first-character fallback avatar.

## Preview, files and jobs

`POST /admin/authoring/drafts/:id/preview` compiles the current unsaved source with
the pinned task-pdf-writer Marked bundle, sanitizes it, and server-renders the four
supported KaTeX delimiter forms. It embeds only the
saved draft header/avatar/assets and returns a self-contained, script-free HTML
document with a restrictive CSP. The iframe is also sandboxed. This is a fast
preview only; the runner-built wkhtmltopdf document remains authoritative.

Testcase lists contain metadata only. Inspect fetches one pair and renders at
most 32 KiB per side (the current detail endpoint still transfers the complete,
bounded file). Empty output and missing output remain distinct. Append, replace,
delete and ZIP whole-set replacement use expected revisions. Input-only replace
clears its old output. ZIP replace, generator replacement, output replacement and
Publish require explicit confirmation.

The workspace fetches one initial draft/history snapshot. It polls every three
seconds only while a durable job is active, so an idle editor cannot exhaust the
global API rate limit. Reloading during a job resumes polling from server state.
The 100-row history list excludes logs, source snapshots and full result reports;
Inspect fetches one job's bounded diagnostics/report. Verify reports show checks,
case/byte totals, per-case wall times and the explicit memory/reproducibility
limitations.

Publish is available only for the exact saved, verified revision with a current
PDF. Its confirmation states that the legacy problem is created hidden and the
draft becomes read-only. Visibility is managed later through Problem Management.

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
- Frontend: **62 suites / 311 tests passed**; production type-check, all-test
  type-check, ESLint and optimized build passed.
- Compose policy tests: **5 passed**.
- A separate localhost browser fixture completed the same author workflow and
  confirmed the responsive five-tab layout, Thai/KaTeX preview, live job/file
  updates, Verify report, current PDF and hidden read-only publication.
- Tests used disposable Compose projects only. Existing local and production
  services/databases were not migrated, redeployed or modified.
