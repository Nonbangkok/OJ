# Versioned statements and PDF builds — Slice 7

## API

- `POST /admin/authoring/drafts/:id/jobs/pdf`, JSON `{ "expectedRevision": 3 }`.
  Admin only; returns 202 job metadata. No solution, generator or testcases required.
- `GET /admin/authoring/jobs/:id` returns job state, bounded diagnostics and PDF
  manifest (size, SHA-256, template version), never private input/source bytes.
- `GET /admin/authoring/drafts/:id/pdf` returns the last successful PDF inline for
  authenticated admins only, with `Cache-Control: private, no-store`, same-origin
  framing and `X-PDF-Revision` / `X-Draft-Revision`. A newer draft does not erase its
  prior successful PDF; the frontend must label differing revisions as out of date.

Missing draft/PDF returns 404. Build validation rejects unsupported template and
empty/unsafe/oversized statements or missing image references (400). Existing
revision/published/busy conflicts, global queue cap and disabled-runner errors apply.

## Statement contract

Store the authored source in the historical `statement_html` column. Its content is
the `task-pdf-writer` hybrid format: Markdown with inline HTML and LaTeX, not a full
HTML document. The pinned Marked 4.0.8 bundle compiles it to HTML before the
parser-based sanitizer rejects unsafe content instead of silently stripping it.
The worker checks the captured compiled HTML again.

- Markdown headings, paragraphs, emphasis, links, blockquotes, lists, GFM tables,
  fenced code and images; compatible inline HTML remains available.
- Literal math delimiters `$...$`, `$$...$$`, `\(...\)` and `\[...\]`.
- Sample tables are authored directly in HTML and remain independent of testcases.
- Images reference an existing draft asset with `<image src="{{ASSET_BASE}}/filename">`,
  `<img ...>`, or `![alt]({{ASSET_BASE}}/filename)`. Legacy `<image>` is normalized
  after Markdown parsing so a code example containing that text stays literal.
- Fixed classes: `forced-page-break`, `sample-table`, `sample-table-short`,
  `geometry-data`, `input-spec`. Explicit page break: `<div class="forced-page-break"></div>`.
- Limited numeric dimensions, links using only HTTP(S), and enumerated legacy
  table/page-break/alignment/whitespace styles only;
  no arbitrary CSS, positioning, font replacement or stylesheet overrides.
- Scripts, event handlers, iframe/object/embed, SVG/MathML source, forms, document
  declarations, unknown attributes, remote/data/file URLs and traversal are rejected.
- Limits: 2 MiB UTF-8 before and after serialization, 100000 nodes, nesting depth128.

See `backend/authoring/statementSanitizer.ts` and its adversarial tests for the exact
allowlists. KaTeX-generated markup is trusted library output, not user HTML. The
bundled KaTeX wrapper disables trusted commands and bounds macro expansion/size;
math errors fail the PDF job instead of installing a partially rendered statement.

## Template and snapshot

`red-gate-v1` bundles the approved Red Gate layout, Sarabun/Inconsolata/KaTeX fonts,
KaTeX browser bundle and license notices. CSS tuning, A4 dimensions and margins are
preserved; title, task code, author AKA/name, language/country and profile image are
generic captured data. The template contains no built-in Red Gate statement/logo.
The renderer uses Ubuntu24.04 and wkhtmltopdf0.12.6-2build2, matching the approved
demo environment. Changes affecting layout require a new template version.

Queue reservation locks the draft, compiles/sanitizes its source, and captures HTML, metadata, template
version, avatar and asset manifests. `0005_authoring_job_files` stores binary
snapshots separately from JSON, keyed by job UUID plus internal name (`avatar` or
`asset:filename`). It has no foreign key to live assets, so later edits/deletions
do not change queued input. Null legacy avatars receive the deterministic fallback.

Delivery validates hashes and writes one file at a time before atomically exposing
the complete request. The worker rechecks hashes, sanitizes again and renders only
the captured data. Result import validates identity, template, PDF size/hash and
source revision under the draft lock. PDF replacement, source-revision assignment,
job completion and snapshot cleanup are a single transaction. Failure, stale jobs,
duplicate results or corrupt artifacts preserve the previous PDF. Success sets
`generated` and clears readiness; it does not perform Verify All or Publish.

## Isolation and operations

- Worker has no network, credentials, DB client or Docker socket. Container limits
  remain 1 CPU, 1 GiB memory and 256 tasks, with read-only root and bounded work tmpfs.
- Qt runs as uid/gid65534. Only bundled template files and captured job image paths
  are allowed through local-file loading; root-private spool data remains unreadable.
- Template/font files are explicitly readable after image copy; snapshot bytes stay
  private and only the current rendering workspace contains the required image copies.
- PDF render wall limit60s, whole-job15min including queueing; renderer virtual
  address-space cap2 GiB (Qt reserves more than its resident RAM; container RAM stays1 GiB),
  CPU, process count and file size limits apply. PDF artifact maximum64 MiB.
- Logs capped at64 KiB; live renderer diagnostics capped at10 MiB. Workspaces and
  terminal snapshot rows/transport files are cleaned through normal reconciliation.
- Deploy backend and runner images together, applying migration0005 before new jobs.
  Existing local/production services are not automatically redeployed by tests.

PDF builds are infrastructure validation, not a claim of algorithm or statement
correctness. The author remains responsible for problem content. Admin editor/fast
browser preview is Slice10; Verify All is Slice8 and Publish is Slice9.

## Verification commands

Run the disposable Compose integration stack in README for full backend tests.
`tests/authoring/pdf-runtime.mjs` additionally runs against the actual worker image
under deployment restrictions, using the approved Red Gate fixture and malformed
math/unsafe HTML cases. Optional `PDF_QA_OUTPUT` writes a comparison PDF for Poppler
rendering and visual checks. Fixture provenance and licenses are committed; generated
QA files under `output/pdf/` and page images under `tmp/pdfs/` are ignored by Git.
`node tests/authoring/pdf-visual.mjs` uses Poppler to assert that all three generated
Red Gate pages are pixel-identical to the approved fixture at909×1286.
