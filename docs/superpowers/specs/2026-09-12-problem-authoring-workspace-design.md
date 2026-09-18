# Problem Authoring Workspace Design

**Date:** 2026-09-12
**Status:** Approved in conversation; awaiting review of this written specification

## 1. Purpose

Add a human-first competitive-programming problem authoring workflow directly to the Grader OJ Admin Panel. An author can write a statement, build the existing pixel-matched PDF template, create or upload testcases, write a C++ reference solution, mechanically verify the artifacts, and publish the completed problem into the existing grader.

The first version does not integrate AI. The data and service boundaries should remain structured enough for a future AI adapter without making AI part of the current implementation.

## 2. Scope

The first version supports:

- New problems only.
- Admin-only authoring inside the existing OJ frontend and backend.
- Drafts that can be saved and resumed.
- task-pdf-writer-compatible Markdown statement source with inline HTML and LaTeX rendered by KaTeX.
- Versioned, fixed PDF templates rendered by Docker and wkhtmltopdf 0.12.6.
- Author profiles with profile images.
- Private C++20 reference solutions.
- Optional private C++20 testcase generators.
- Legacy generators that create multiple files under `./input/` in one run.
- Seed-aware generators as the recommended convention for new problems.
- Manual input/output upload when no generator exists.
- Output generation by running the reference solution against stored inputs.
- Mechanical verification and an explicit admin Publish action.
- Transactional publication into the existing `problems` and `testcases` tables.

## 3. Non-goals

The first version does not:

- Generate or modify problems with AI.
- Reconstruct existing PDF-only problems.
- Edit already-published problems through the Authoring Workspace.
- Prove that an algorithm, statement, generator, or expected output is logically correct.
- Support brute-force solutions or stress comparison against a second solution.
- Support languages other than C++20 for solutions or generators.
- Support custom checkers, floating-point tolerance, or token-based checking.
- Automatically publish or make a problem visible.
- Replace or harden the existing contestant submission judge.

Existing problems and the existing Problem Management upload flow continue to work unchanged.

## 4. Architecture

Use a modular-monolith architecture. The authoring UI and API live in the existing OJ frontend and backend, while compilation, arbitrary C++ execution, and PDF rendering run inside an internal `authoring-runner` Docker service.

```text
Admin Panel
    |
    v
OJ Backend / Authoring Module
    |-- PostgreSQL: drafts, profiles, assets, testcases, jobs
    |-- existing problems/testcases tables on Publish
    |
    v
Shared job volume
    |
    v
Authoring Runner
    |-- no network
    |-- no database credentials
    |-- bounded CPU, memory, process count, time, and output
    `-- disposable workspace per job
```

The runner is an internal implementation detail. Authors do not open or operate a separate application.

### 4.1 Job transport

The backend records each job in PostgreSQL and writes an immutable job snapshot to the shared volume using an atomic temporary-directory-to-ready-directory rename. The runner consumes one ready job at a time, writes logs and results to a job-specific result directory, and atomically marks the result complete. The backend imports the result and durable artifacts into PostgreSQL.

The runner must tolerate duplicate delivery. A completed job ID is never applied twice. On backend startup, reconciliation marks abandoned jobs failed or imports completed results that were not yet recorded.

## 5. Draft lifecycle

```text
Draft --Generate/Build--> Generated --Verify--> Ready --Publish--> Published
  ^                             |                  |
  `--------- Save --------------+------------------'
```

- Creating or saving author-controlled content increments the draft `revision` and sets the lifecycle status to `draft`.
- Generated artifacts record the draft revision from which they were produced.
- `ready` means the current revision passed all mechanical checks. It does not certify algorithmic correctness.
- If a draft changes while a job is running, the job result is retained for diagnostics but marked `stale` and cannot make the draft ready.
- Published drafts are read-only in the first version.
- The published problem is created with `is_visible = false`.

## 6. Admin user experience

Add a `Problem Authoring` section alongside the existing `Problem Management` section.

A draft workspace contains five tabs:

1. **Metadata** — problem ID, title, author profile, PDF header metadata, time limit, and memory limit.
2. **Statement** — task-pdf-writer Markdown/HTML/LaTeX editor, asset management,
   fast compiled preview, and actual PDF preview.
3. **Solution** — private `solution.cpp` editor and an explicit Compile action.
4. **Testcases** — optional `generator.cpp`, manual input/output upload, generator execution, output generation, and paired testcase inspection.
5. **Verify & Publish** — checklist, build history, logs, testcase summary, resource measurements, PDF preview, and Publish action.

The first version uses an explicit Save button and a visible dirty-state indicator. It does not autosave. Job actions are disabled while unsaved changes exist and while a conflicting job is active.

## 7. Author profiles and PDF logo

Author identity is separate from authentication. Add an `author_profiles` entity with:

- AKA name.
- Real name.
- Profile image.
- Default language.
- Country code.
- An optional link to an OJ user account.

An admin may therefore create a profile for an author who does not have an OJ account.

Profile images accept JPEG, PNG, or WebP. The UI provides a square crop and the backend normalizes the result to a 512 by 512 PNG. The PDF displays it at 70 by 70 CSS pixels. If no image exists, the system creates a deterministic fallback avatar from the first character of the AKA name.

Selecting an author profile copies its display data and normalized image into the draft as a snapshot. Later profile changes do not silently alter an existing draft or published PDF. An explicit `Refresh from profile` action updates the snapshot and increments the draft revision.

## 8. Statement and PDF rendering

The statement is stored as authored task-pdf-writer-compatible source: Markdown with inline HTML and LaTeX, not a complete HTML document. The historical `statement_html` database/API naming remains unchanged to avoid a destructive migration. A pinned Marked parser compiles the source before allowlist sanitization. KaTeX recognizes `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` math delimiters.

The fixed template supplies the document shell, CSS, Sarabun/Inconsolata/KaTeX fonts, header, profile image, author metadata, task code, language, and country code. Each draft records `template_version`; rebuilding an older draft uses the same template version.

Statement conventions include:

- Markdown headings, paragraphs, emphasis, links, blockquotes, lists, GFM tables,
  fenced code and images, plus compatible inline HTML.
- Free-form sample tables authored directly in HTML. Samples are intentionally not synchronized with hidden testcases.
- `<image src="{{ASSET_BASE}}/filename">`, `<img ...>`, or
  `![alt]({{ASSET_BASE}}/filename)` for draft assets.
- `<div class="forced-page-break"></div>` for explicit page breaks.
- Restricted inline styles needed for layout, such as image width.

The sanitizer rejects scripts, iframes, embedded objects, event-handler attributes, unsafe URLs, and external assets. Statement content cannot override the template stylesheet. The runner has no network access, so PDF builds cannot retrieve remote resources.

The editor provides a fast browser preview. The authoritative preview is a PDF built by the runner with wkhtmltopdf 0.12.6 and the bundled, versioned assets from the existing Red Gate demonstration.

## 9. C++ sources

`solution.cpp` is required before output generation and verification. `generator.cpp` is optional. Both are private admin-only data and must never appear in public problem APIs, contestant downloads, or the existing public export format.

Compilation uses C++20, a bounded compiler timeout, a bounded diagnostics buffer, a minimal environment, and the existing forbidden-include protections. Runtime execution uses the same limit semantics as the current grader where applicable.

## 10. Testcase workflows

### 10.1 Legacy multi-file generator

For compatibility, the runner creates an empty `./input/` directory and invokes the compiled generator once from the job workspace. A legacy generator may create any number of regular files under that directory.

The runner:

1. Rejects symlinks, devices, nested path traversal, and files outside `./input/`.
2. Natural-sorts filenames so numeric sequences behave as authors expect.
3. Assigns stable case numbers from the sorted order.
4. Checks case count, individual size, total size, runtime, memory, and process limits.
5. Replaces the previous generated input set only after the entire job succeeds.

### 10.2 Seed convention

The runner invokes generators as:

```bash
OJ_SEED=12345 ./generator 12345
```

Legacy generators may ignore both values. The UI warns when reproducibility has not been demonstrated. Reproducibility is recommended but is not a readiness requirement. A separate reproducibility check may run the generator twice in clean workspaces with the same seed and compare file names and hashes.

### 10.3 Generator-less flow

When no generator exists, the author may upload individual input/output files or a ZIP using the pairing conventions already accepted by Grader OJ. Inputs may exist temporarily without outputs while the draft is incomplete.

### 10.4 Output generation

The runner compiles the current reference solution, executes it once per stored input, and captures standard output. New outputs replace the previous output set only when every case succeeds. A failed run leaves the previous outputs intact.

The checker remains identical to the current judge: normalize CRLF to LF, trim leading and trailing whitespace from the complete output, then compare exact strings.

## 11. Mechanical verification

`Verify All` takes an immutable snapshot of the current revision and performs:

1. Metadata and Problem ID validation.
2. Statement sanitization and asset-reference validation.
3. PDF rendering.
4. Reference-solution compilation.
5. Generator compilation when a generator exists; verification does not implicitly regenerate inputs.
6. Input/output pair validation.
7. Execution of the reference solution on every stored input.
8. Exact comparison against every stored output using current judge semantics.
9. Time, memory, file-count, and file-size checks.
10. A final revision check before changing the draft to `ready`.

Verification reports compile diagnostics, the first runtime/comparison failure, per-case resource measurements, case count, total artifact size, PDF status, warnings, and the verified revision.

The author remains responsible for statement accuracy, constraint coverage, generator quality, algorithm correctness, and expected-output correctness.

## 12. Data model

### 12.1 `author_profiles`

- `id` UUID primary key generated by the application.
- `user_id` nullable unique foreign key to `users`.
- `aka_name`, `real_name`, `default_language`, `country_code`.
- `profile_image_png` nullable `BYTEA`.
- `created_at`, `updated_at`.

### 12.2 `problem_drafts`

- `id` UUID primary key generated by the application.
- `problem_id`, `title`, `author_profile_id`.
- Snapshot fields: AKA name, real name, language, country code, and profile PNG.
- `time_limit_ms`, `memory_limit_mb`.
- `statement_html`, `solution_cpp`, nullable `generator_cpp`.
- Nullable `latest_pdf` and its source revision.
- `template_version`.
- `revision` integer starting at 1.
- Lifecycle status: `draft`, `generated`, `ready`, or `published`.
- `created_by`, `created_at`, `updated_at`, nullable `published_at`.

The proposed `problem_id` is not reserved in `problems` until Publish. Duplicate IDs are rejected during Publish.

### 12.3 `problem_draft_assets`

- UUID primary key and draft foreign key.
- Unique filename within the draft.
- MIME type, normalized binary content, checksum, size, and timestamps.

### 12.4 `problem_draft_testcases`

- UUID primary key and draft foreign key.
- Case number unique within the draft.
- Original input filename.
- Input data and nullable output data.
- Source: `uploaded` or `generated`.
- Source revision and timestamps.

### 12.5 `authoring_jobs`

- UUID primary key, draft foreign key, job type, and captured draft revision.
- Status: `queued`, `compiling`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`, or `stale`.
- Structured result summary, bounded text log, error code/message, and timestamps.

Add a non-destructive migration mechanism with a `schema_migrations` table. Authoring schema upgrades must not use the existing destructive `init_db.ts` reset flow.

## 13. Initial safety limits

Limits live in centralized backend configuration and can be changed without altering the schema. Initial defaults are:

- Statement HTML: 2 MiB.
- Each C++ source: 2 MiB.
- Each normalized asset: 10 MiB; 100 MiB total per draft.
- Testcases: 1,000 cases maximum.
- Each input or output: 64 MiB; 512 MiB total per draft.
- Compiler: 30 seconds and 10 MiB diagnostics.
- Generator: 60 seconds.
- Complete authoring job: 15 minutes.
- Runner container: 1 GiB memory and 256 processes.

Exceeding a limit produces a stable error code plus a human-readable message naming the offending artifact. Limits are checked before durable replacement of existing artifacts.

## 14. API surface

All routes require authenticated admin access. The backend revalidates authorization, limits, revision preconditions, and lifecycle state; it never trusts the frontend.

```text
POST   /admin/author-profiles
GET    /admin/author-profiles
PATCH  /admin/author-profiles/:id

POST   /admin/authoring/drafts
GET    /admin/authoring/drafts
GET    /admin/authoring/drafts/:id
PATCH  /admin/authoring/drafts/:id
POST   /admin/authoring/drafts/:id/assets
DELETE /admin/authoring/drafts/:id/assets/:assetId

POST   /admin/authoring/drafts/:id/jobs/compile
POST   /admin/authoring/drafts/:id/jobs/generate
POST   /admin/authoring/drafts/:id/jobs/outputs
POST   /admin/authoring/drafts/:id/jobs/pdf
POST   /admin/authoring/drafts/:id/jobs/verify
GET    /admin/authoring/jobs/:jobId

POST   /admin/authoring/drafts/:id/publish
```

Mutation requests include the expected draft revision. A mismatch returns HTTP 409 with the latest revision so one admin cannot silently overwrite another admin's changes.

## 15. Publish transaction

Publish is permitted only for the exact revision recorded by the latest successful verification.

In one database transaction, the backend:

1. Locks and re-reads the draft.
2. Confirms admin authorization, `ready` status, revision, PDF revision, complete testcase pairs, and unused Problem ID.
3. Inserts the existing `problems` row with `is_visible = false`.
4. Inserts all existing `testcases` rows with stable case numbers.
5. Marks the draft `published` and records the publish time.
6. Commits all changes together.

Any failure rolls back the problem, testcases, and draft status. Private authoring sources remain attached to the published draft for admin-only inspection but are never copied into public problem records.

## 16. Failure handling

- Failed Save leaves the previous revision unchanged.
- Failed generation, output generation, or PDF build preserves the last successful artifacts.
- Runner timeout or unexpected exit produces a failed job that can be retried.
- Backend restart reconciles queued/running/result directories and does not silently report success.
- Results from an older revision are marked stale.
- Duplicate Problem IDs fail without overwriting existing problems.
- Logs are size-bounded, secret-free, and source paths are sanitized before display.
- Temporary job workspaces are deleted after durable results are imported or after a configured failed-job retention period.

## 17. Testing strategy and implementation slices

Implementation proceeds in small reviewable slices. Each slice is tested and reviewed before starting the next:

1. Non-destructive migration mechanism and authoring data models.
2. Draft CRUD API and revision-conflict tests.
3. Author Profile, image normalization, and asset tests.
4. Runner job protocol with minimal C++ fixtures.
5. Legacy multi-file generator and generator-less flows.
6. Reference-solution compilation and output generation.
7. Generic PDF template extraction, sanitizer, snapshot, and integration tests.
8. Mechanical verification and stale-revision tests.
9. Transactional Publish and duplicate-ID tests.
10. Admin frontend components and end-to-end authoring workflow.

Testing includes unit tests for validators and pure transformations, service tests with database mocks where appropriate, PostgreSQL integration tests for transactions and migrations, runner integration tests inside Docker, frontend component tests, and one end-to-end fixture that creates a draft, builds inputs/outputs/PDF, verifies it, and publishes it as hidden.

For every implementation slice, the developer reports the files changed, the reason for each change, the commands executed, and their exact results so the user can review progress in real time.

## 18. Future extensions

Explicitly deferred work includes:

- Importing source-complete legacy problems into the Authoring Workspace.
- Editing a published problem through a new draft revision.
- Token, floating-point, and custom C++ checkers.
- Brute-force or differential stress testing.
- Additional programming languages.
- Moving the existing contestant judge into the isolated runner architecture.
- AI adapters through files, REST, or MCP. Any future AI integration creates or edits drafts only and cannot bypass human verification or Publish approval.
