/**
 * The AI Docs page content — a single structured source for both views:
 * the rendered human page (AiDocs.tsx) and the plain-markdown copy that the
 * "Copy for AI agent" button puts on the clipboard (buildAiDocsMarkdown).
 *
 * Every endpoint, field name, limit and error code here is derived from the
 * backend implementation (Zod schemas in backend/schemas/requestSchemas.ts,
 * controllers/authoring*.ts, authorProfileController.ts and their services).
 * Update this file when the API changes — there is no second copy to sync.
 *
 * Inline text supports two markdown constructs: `code` spans and **bold**.
 * Keep table cells free of literal pipe characters.
 */

export type DocBlock =
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered?: boolean; items: string[] }
  | { kind: 'code'; language?: string; code: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export const AI_DOC_TITLE = 'Problem Authoring API reference';

export const aiDocsSections: DocSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    blocks: [
      {
        kind: 'paragraph',
        text: 'The Problem Authoring system is the staff-facing pipeline that turns a draft into a published, judged problem. A draft holds everything in one place: statement HTML, reference C++ solution, optional testcase generator, testcase files, limits and author metadata. Testcases are produced or uploaded, expected outputs are generated from the reference solution, the whole package is verified end to end, and publishing copies the verified artifacts into the live grader as a **hidden** problem.',
      },
      {
        kind: 'paragraph',
        text: 'Every screen in the Authoring tab is a thin client over a JSON API — the same API documented here. The entire workflow can be driven by a script or an AI agent: create a draft, write the statement and code, produce testcases, verify, publish.',
      },
      {
        kind: 'paragraph',
        text: '**Role requirement.** Every authoring endpoint requires an authenticated **staff** or **admin** session. A plain `user` session receives `403 Staff or Admin access required`.',
      },
      {
        kind: 'paragraph',
        text: '**Base URL convention.** Paths below are backend paths. Through the site reverse proxy every request is prefixed with `/api`, which the proxy strips: `POST /api/login` reaches the backend route `/login`, and `/api/admin/authoring/drafts` reaches `/admin/authoring/drafts`. Outside the examples, paths are written without the prefix.',
      },
      {
        kind: 'paragraph',
        text: 'The workflow in one line: **login → create draft → write statement + solution (+ generator) → produce testcases → generate outputs → verify → publish.** Each stage is a normal HTTP call; jobs are asynchronous and polled.',
      },
    ],
  },
  {
    id: 'authentication',
    title: 'Authentication',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Authentication is a classic session cookie. `POST /login` with a JSON body `{ "username": "...", "password": "..." }` (through the proxy: `POST /api/login`). On success the response sets a single httpOnly session cookie (`connect.sid`, SameSite=Lax) **valid for 24 hours** and returns the signed-in user:',
      },
      {
        kind: 'code',
        language: 'json',
        code: '{\n  "message": "Login successful",\n  "user": { "id": 1, "username": "newadmin", "role": "admin", "hasAvatar": false, "tier": "...", "level": 3 }\n}',
      },
      {
        kind: 'paragraph',
        text: 'Log in **once**, save the cookie, and reuse it for every request. The session is revalidated against the database on each request, so a deleted account or a changed role takes effect immediately (401 / 403).',
      },
      {
        kind: 'code',
        language: 'bash',
        code: 'BASE="http://localhost/api"   # the site front door; add /api yourself\n\n# Log in once and keep the cookie jar (valid 24 hours)\ncurl -s -c cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}\' \\\n  "$BASE/login"\n\n# Every later call reuses the cookie\ncurl -s -b cookies.txt "$BASE/admin/authoring/drafts"',
      },
      {
        kind: 'paragraph',
        text: '**Lockout warning.** Login is protected by two throttles. Per account: **10 failed password attempts for one username within 15 minutes locks that account for 15 minutes** (HTTP 429), regardless of source IP. Per IP: 10 login/register requests per 15 minutes. Agents must log in once, keep the cookie, and never retry a failed login in a loop — a locked account blocks the real human owner too.',
      },
      {
        kind: 'paragraph',
        text: 'Other limits worth knowing: a general API limiter of 1000 requests per 15 minutes per IP; per-endpoint upload caps documented below. `POST /logout` invalidates the session when you are done.',
      },
    ],
  },
  {
    id: 'drafts',
    title: 'Draft lifecycle',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A draft moves through four statuses: `draft` (writing), `generated` (testcase outputs exist), `ready` (verified at the current revision — publishing unlocked), `published` (read-only; the problem is live). Any edit, testcase change or asset change resets the draft to `draft` and clears its verified revision.',
      },
      { kind: 'heading', level: 3, text: 'Create a draft — POST /admin/authoring/drafts' },
      {
        kind: 'paragraph',
        text: 'JSON body (author fields are required unless an `authorProfileId` is given, in which case the profile is snapshotted into the draft):',
      },
      {
        kind: 'table',
        head: ['Field', 'Type', 'Required', 'Constraints'],
        rows: [
          ['problemId', 'string', 'yes', '1–50 chars; the eventual public problem ID'],
          ['title', 'string', 'yes', '1–255 chars'],
          ['authorProfileId', 'UUID or null', 'no', 'links an author profile (snapshot copied in); default null'],
          ['authorAkaName', 'string', 'yes*', '1–100 chars; *required when authorProfileId is null'],
          ['authorRealName', 'string', 'yes*', '1–255 chars; *required when authorProfileId is null'],
          ['language', 'string', 'yes*', '1–50 chars, e.g. "Thai" or "English"; *see above'],
          ['countryCode', 'string', 'yes*', 'exactly 3 uppercase letters (ISO 3166-1 alpha-3)'],
          ['categories', 'string[]', 'no', 'values from the fixed category list; default []'],
          ['difficulty', 'int or null', 'no', '800–3500 in steps of 100, or null (Unrated); default null'],
          ['timeLimitMs', 'int', 'yes', 'at least 100; output/verify jobs also require at most 900000'],
          ['memoryLimitMb', 'int', 'yes', 'at least 1; output/verify jobs also require at most 736'],
          ['statementHtml', 'string', 'no', 'HTML statement, at most 2 MiB UTF-8; default ""'],
          ['solutionCpp', 'string', 'no', 'reference C++ solution, at most 2 MiB; default ""'],
          ['generatorCpp', 'string or null', 'no', 'testcase generator, at most 2 MiB; default null'],
          ['templateVersion', 'string', 'no', 'PDF template; default "red-gate-v1" (the only supported value)'],
        ],
      },
      {
        kind: 'paragraph',
        text: 'Returns **201** with the draft detail (see below). `404` if `authorProfileId` does not exist; `400` if manual author fields are missing. The fixed category list: Dynamic Programming, Greedy, Graph, Tree, Data Structures, String, Math, Geometry, Divide and Conquer, Binary Search, Constructive, Bitmasks, Sorting, 2D-Grid, Implementation, Other. JSON bodies on draft routes are capped at 7 MiB.',
      },
      {
        kind: 'code',
        language: 'bash',
        code: 'curl -s -b cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"problemId":"aplusb","title":"A + B","authorAkaName":"Agent","authorRealName":"Agent Author","language":"English","countryCode":"THA","timeLimitMs":1000,"memoryLimitMb":256}\' \\\n  "$BASE/admin/authoring/drafts"',
      },
      { kind: 'heading', level: 3, text: 'Draft detail — the response shape' },
      {
        kind: 'paragraph',
        text: 'Create, update, get, new-revision and refresh-author-profile all return this shape (get adds `testcaseStats`):',
      },
      {
        kind: 'code',
        language: 'json',
        code: '{\n  "id": "d4b0...", "problemId": "aplusb", "title": "A + B",\n  "authorProfileId": null, "authorAkaName": "Agent", "authorRealName": "Agent Author",\n  "language": "English", "countryCode": "THA", "hasAuthorProfileImage": false,\n  "categories": [], "difficulty": null,\n  "timeLimitMs": 1000, "memoryLimitMb": 256,\n  "statementHtml": "", "solutionCpp": "", "generatorCpp": null,\n  "hasLatestPdf": false, "latestPdfRevision": null, "templateVersion": "red-gate-v1",\n  "revision": 1, "verifiedRevision": null, "status": "draft",\n  "createdBy": 1, "createdAt": "...", "updatedAt": "...", "publishedAt": null,\n  "testcaseStats": { "total": 0, "withOutput": 0 }\n}',
      },
      { kind: 'heading', level: 3, text: 'List and get — GET /admin/authoring/drafts[/:id]' },
      {
        kind: 'paragraph',
        text: '`GET /admin/authoring/drafts` returns an array of summaries (`id`, `problemId`, `title`, `authorProfileId`, `authorAkaName`, `status`, `revision`, `verifiedRevision`, `createdBy`, `createdAt`, `updatedAt`). `GET /admin/authoring/drafts/:id` returns the full detail above. Unknown id → `404 { "message": "Problem draft not found" }`.',
      },
      { kind: 'heading', level: 3, text: 'Update a draft — PATCH /admin/authoring/drafts/:id' },
      {
        kind: 'paragraph',
        text: 'Body: `expectedRevision` (positive integer, **required on every write**) plus **at least one** of the create-time fields (all optional here, same constraints). Setting `authorProfileId` re-snapshots the author fields from that profile. Success returns **200** with the updated draft and `revision` bumped by one — use the new value for the next write.',
      },
      {
        kind: 'paragraph',
        text: '**Optimistic revision rule.** If the draft changed since you read it, you get `409` with `{ "code": "revision_conflict", "message": "Problem draft revision conflict", "currentRevision": 7, "draft": { ... } }`. The correct agent behavior: read `currentRevision` (or the attached `draft`), re-apply your change on top of the fresh state, and retry.',
      },
      {
        kind: 'paragraph',
        text: '**Published drafts are read-only** (`409` code `draft_published`) with one deliberate exception: a PATCH whose only change is `statementHtml` reopens the draft for a correction cycle (`status` → `draft`, `revision` + 1, verified revision cleared; the live problem is untouched until you publish again). The `problemId` is locked forever after the first publication — changing it returns `409` code `published_problem_id_locked`.',
      },
      { kind: 'heading', level: 3, text: 'Reopen and resync' },
      {
        kind: 'list',
        items: [
          '`POST /admin/authoring/drafts/:id/new-revision` — no body. Only for published drafts: reopens the full draft for editing (`status` → `draft`, `revision` + 1). Otherwise `409` code `draft_not_published`.',
          '`POST /admin/authoring/drafts/:id/refresh-author-profile` — body `{ "expectedRevision": n }`. Re-copies the author snapshot from the linked profile. `409` codes: `author_profile_not_selected` (no linked profile), `author_profile_missing` (profile deleted).',
        ],
      },
      { kind: 'heading', level: 3, text: 'Statement assets, preview and PDF' },
      {
        kind: 'list',
        items: [
          '`POST /admin/authoring/drafts/:id/assets` — multipart: file part **`asset`** (JPEG/PNG/WebP, at most 10 MiB normalized, at most 100 MiB per draft total) plus form fields `expectedRevision` (required) and `filename` (optional, at most 255 chars). **201** `{ "asset": {...}, "draftRevision": n }`. Errors: `409 asset_filename_conflict`, `413 asset_total_size_exceeded`, plus the usual revision/published conflicts. Each upload bumps the draft revision.',
          '`GET /admin/authoring/drafts/:id/assets` — list asset metadata; `GET .../assets/:assetId` — the raw image bytes.',
          '`DELETE /admin/authoring/drafts/:id/assets/:assetId?expectedRevision=n` — remove an asset (revision bumps).',
          '`POST /admin/authoring/drafts/:id/preview` — body `{ "statementHtml": "..." }` → `{ "html": "..." }` with the server-side sanitized statement. Use it to validate statement HTML; a statement problem returns `400` with a statement error code.',
          '`GET /admin/authoring/drafts/:id/pdf` — the latest successfully built PDF bytes (`404` code `pdf_missing` if none).',
        ],
      },
    ],
  },
  {
    id: 'testcases',
    title: 'Testcases',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Testcases are input/expected-output **text** pairs stored on the draft. An empty output file is a valid expected output; an omitted output is a missing pair. Every mutation takes `expectedRevision` and bumps the revision by one, resetting the draft to `draft`.',
      },
      { kind: 'heading', level: 3, text: 'Caps and file rules' },
      {
        kind: 'list',
        items: [
          'At most **1000 cases** per draft; **64 MiB per file**; **512 MiB total** across all files.',
          'Content must be UTF-8 text without NUL bytes.',
          'Filenames must match `[A-Za-z0-9][A-Za-z0-9._-]*`, at most 255 chars, no `..`; input filenames must be unique within the draft.',
        ],
      },
      { kind: 'heading', level: 3, text: 'Add one case — POST /admin/authoring/drafts/:id/testcases' },
      {
        kind: 'paragraph',
        text: 'Multipart form data: file part **`input`** (required), optional file part **`output`**, and the form field `expectedRevision`. Appends the case with the next case number. **201** `{ "revision": n }`.',
      },
      {
        kind: 'code',
        language: 'bash',
        code: 'curl -s -b cookies.txt \\\n  -F "input=@case1.in;filename=1.in" \\\n  -F "output=@case1.out;filename=1.out" \\\n  -F "expectedRevision=2" \\\n  "$BASE/admin/authoring/drafts/$DRAFT_ID/testcases"',
      },
      { kind: 'heading', level: 3, text: 'Replace or delete one case — PATCH / DELETE .../testcases/:caseId' },
      {
        kind: 'paragraph',
        text: '`PATCH` is multipart with file part `input` and/or `output` (at least one). Note that replacing the **input alone clears the stored output** — the old expected output may no longer match. `DELETE` takes a JSON body `{ "expectedRevision": n }`. Both return `{ "revision": n }`.',
      },
      { kind: 'heading', level: 3, text: 'Replace the whole set — POST with a ZIP archive' },
      {
        kind: 'paragraph',
        text: 'Send multipart with file part **`archive`** instead of `input`/`output` (never both). The archive replaces every existing testcase. Exactly one layout is accepted — do not mix:',
      },
      {
        kind: 'list',
        items: [
          '**Flat pairs** in one directory, recognized by name: `1.in`/`1.out`, `input1.in`/`output1.out`, `2.txt`/`2.sol` — an `.in`/`.txt` extension or `input` prefix marks an input; `.out`/`.sol` or `output` prefix marks an output. Every output needs a matching input number.',
          '**Directory layout**: one `input/` directory plus one `output/` directory with matching filenames (outputs may be partial).',
          'macOS junk entries (`__MACOSX`, `.DS_Store`, `._*` AppleDouble files) are ignored. ZIP64, split and encrypted archives are rejected.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'Size/count violations return **413** (`testcase_file_too_large`, `testcase_total_size_exceeded`, `testcase_count_exceeded`); structural problems return **400** (`invalid_testcase_archive`, `unsafe_testcase_archive`, `ambiguous_testcase_archive`, `duplicate_testcase_filename`, `testcase_input_required`, `invalid_testcase_text`, `invalid_testcase_upload`). Revision conflicts and published drafts return the usual 409 codes.',
      },
      { kind: 'heading', level: 3, text: 'List and inspect' },
      {
        kind: 'paragraph',
        text: '`GET /admin/authoring/drafts/:id/testcases` → `{ "revision": n, "testcases": [...] }` with metadata per case (`id`, `caseNumber`, `filename`, `inputBytes`, `outputBytes`, `hasOutput`, `source` (`uploaded` or `generated`), `sourceRevision`, timestamps). `GET .../testcases/:caseId` adds the full `input` and `output` contents. Unknown draft/case → `404`.',
      },
    ],
  },
  {
    id: 'jobs',
    title: 'Jobs — compile, generate, outputs, pdf, verify',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Compilation, input generation, output production, PDF rendering and verification run **asynchronously** on a runner. Each action is `POST /admin/authoring/drafts/:id/jobs/<action>` and returns **202** with the queued job. Poll `GET /admin/authoring/jobs/:id` until a terminal status; `GET /admin/authoring/drafts/:id/jobs` lists the last 100 jobs of a draft (without `log`/`resultSummary`).',
      },
      {
        kind: 'table',
        head: ['Action', 'Endpoint', 'Body', 'What it does'],
        rows: [
          ['compile', 'POST .../jobs/compile', '{ "expectedRevision": n, "target": "solution" or "generator" }', 'Compiles the stored source; `target` defaults to "solution"'],
          ['generate', 'POST .../jobs/generate', '{ "expectedRevision": n, "seed": "12345" }', 'Runs the generator. `seed` is an unsigned 64-bit decimal string. **Replaces every stored testcase** with the generated inputs (outputs cleared)'],
          ['outputs', 'POST .../jobs/outputs', '{ "expectedRevision": n }', 'Runs the reference solution on every stored input and stores the outputs. All-or-nothing: on failure the existing outputs remain'],
          ['pdf', 'POST .../jobs/pdf', '{ "expectedRevision": n }', 'Renders the statement PDF (for previewing the statement)'],
          ['verify', 'POST .../jobs/verify', '{ "expectedRevision": n }', 'The full gate: compiles the solution, runs every case, compares outputs, builds the PDF. On success the draft becomes `ready` with `verifiedRevision` = the revision'],
        ],
      },
      {
        kind: 'paragraph',
        text: '**Do not edit while a job runs.** A job executes against the exact revision you pass; if the draft changes before the result is imported, the result is recorded as `stale` and discarded. Queue a job, poll it to a terminal status, then continue. Verification additionally resets the draft to `draft` the moment it is queued (a fresh verify supersedes prior readiness).',
      },
      {
        kind: 'paragraph',
        text: 'Job statuses: `queued`, `compiling`, `running` (active) → `succeeded`, `failed`, `timed_out` (terminal). `stale` means the result was discarded because the draft moved on. Results are imported within about a second of completion, so polling every 1–2 seconds is plenty; the hard job timeout is 15 minutes.',
      },
      { kind: 'heading', level: 3, text: 'Job response shape' },
      {
        kind: 'code',
        language: 'json',
        code: '{\n  "id": "j0a1...", "draftId": "d4b0...", "draftRevision": 2,\n  "jobType": "verify_all",\n  "status": "succeeded",\n  "resultSummary": { "verifiedRevision": 2, "verification": { "caseCount": 5, "checks": { "solution": "passed", "execution": "passed", "pdf": "passed", "generator": "skipped" } } },\n  "log": "...runner diagnostic text...",\n  "errorCode": null, "errorMessage": null,\n  "createdAt": "...", "startedAt": "...", "finishedAt": "..."\n}',
      },
      {
        kind: 'paragraph',
        text: '`jobType` values: `compile_solution`, `compile_generator`, `generate_inputs`, `generate_outputs`, `build_pdf`, `verify_all` (`sync_pdf` appears only from internal profile-sync cascades). On failure, `errorCode`/`errorMessage` carry the reason and `log` the runner diagnostics; a failed verify also sets `resultSummary.failedCase` when a specific testcase broke.',
      },
      { kind: 'heading', level: 3, text: 'Queue-time error codes' },
      {
        kind: 'table',
        head: ['HTTP', 'Code', 'Meaning'],
        rows: [
          ['400', 'source_missing', 'The selected C++ source is empty'],
          ['400', 'invalid_metadata', 'Problem ID, author metadata or limits are invalid'],
          ['400', 'inputs_missing', 'outputs/verify: store at least one input first'],
          ['400', 'outputs_missing', 'verify: every stored input needs an expected output'],
          ['400', 'invalid_testcases', 'Testcase names, pairing, count, size or snapshot exceed limits'],
          ['400', 'invalid_statement', 'Statement is empty, unsafe, too large, or references missing assets'],
          ['400', 'unsupported_template', 'The PDF template version is not supported'],
          ['400', 'unsupported_resource_limits', 'Memory limit above 736 MiB or time limit above 900000 ms'],
          ['404', 'draft_not_found', 'Unknown draft id'],
          ['409', 'job_active', 'This draft already has an active job (response includes `jobId`); wait for it'],
          ['409', 'draft_published', 'Published drafts are read-only'],
          ['409', 'revision_conflict', 'Expected revision mismatch (response includes `currentRevision`); reload and retry'],
          ['429', 'queue_full', 'The authoring queue is full; retry later'],
          ['503', 'runner_unavailable', 'The authoring runner is not configured on this deployment'],
        ],
      },
    ],
  },
  {
    id: 'publish',
    title: 'Publish',
    blocks: [
      {
        kind: 'paragraph',
        text: '`POST /admin/authoring/drafts/:id/publish` with body `{ "expectedRevision": n }` copies the verified artifacts into the live grader. **Verification is mandatory and must match the current revision**: the publish gate re-checks everything the verify job checked.',
      },
      { kind: 'heading', level: 3, text: 'Preconditions (all enforced server-side)' },
      {
        kind: 'list',
        ordered: true,
        items: [
          'The draft is not already published, and no authoring job is active.',
          'Status is `ready` with `verifiedRevision` equal to the current revision (a successful verify ran on exactly this draft state).',
          'The stored PDF is the one that verification produced (byte-identical manifest).',
          'The stored testcase pairs exactly match the verification report — same count, same pairing, same total bytes.',
          'Metadata (problem ID, author fields, limits) is valid.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'Success: **201** on first publication, **200** on republish, both with `{ "draftId", "problemId", "revision", "caseCount", "publishedAt", "isVisible", "status": "published" }`. The problem is created **hidden** — make it visible to contestants in Problem Management. The draft becomes read-only.',
      },
      { kind: 'heading', level: 3, text: 'Failure codes' },
      {
        kind: 'table',
        head: ['HTTP', 'Code', 'Meaning'],
        rows: [
          ['404', 'draft_not_found', 'Unknown draft id'],
          ['409', 'draft_not_ready', 'Verify the current draft revision before publishing'],
          ['409', 'pdf_not_verified', 'The current PDF does not match successful verification (re-run verify)'],
          ['409', 'invalid_testcases', 'Stored testcase pairs do not match successful verification'],
          ['409', 'job_active', 'Wait for the active authoring job before publishing'],
          ['409', 'revision_conflict', 'Expected revision mismatch (includes `currentRevision`); reload and retry'],
          ['409', 'draft_published', 'The draft is already published and read-only'],
          ['409', 'problem_id_conflict', 'A problem with this ID already exists; nothing was overwritten'],
          ['409', 'published_problem_missing', 'Republish: the original published problem is missing; nothing was updated'],
          ['409', 'published_problem_mismatch', 'Republish: the live problem was edited outside authoring; nothing was updated'],
          ['409', 'published_problem_provenance_missing', 'Republish: the original publication cannot be matched safely; nothing was updated'],
        ],
      },
      { kind: 'heading', level: 3, text: 'Republish and provenance' },
      {
        kind: 'paragraph',
        text: 'After the first publication the draft\'s `problemId` is locked. To ship a correction: `PATCH` only `statementHtml`, or `POST /new-revision` to reopen everything; edit; re-run the testcase/verify cycle; publish again — a **republish updates the existing problem in place**. The update is guarded by provenance: if someone edited the live problem outside authoring (title, author, categories, difficulty, limits), the republish refuses with `published_problem_mismatch` rather than overwriting their work.',
      },
    ],
  },
  {
    id: 'profiles',
    title: 'Author profiles',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Author profiles are reusable author identities that can be linked to drafts (and to user accounts). They are a supporting cast for the draft workflow — brief reference:',
      },
      {
        kind: 'list',
        items: [
          '`POST /admin/author-profiles` — multipart with fields `akaName` (1–100), `realName` (1–255), `defaultLanguage` (1–50), `countryCode` (3 uppercase letters), `userId` (optional integer), and optional file part **`profileImage`** (JPEG/PNG/WebP, at most 10 MiB, normalized to a 512 px PNG). **201** with the profile; `409 author_profile_user_conflict` if the user account is already linked.',
          '`GET /admin/author-profiles` — list; `GET /admin/author-profiles/:id/image` — the 512 px PNG.',
          '`PATCH /admin/author-profiles/:id` — any subset of the fields plus `removeProfileImage` and `confirmed` (booleans). **Confirmation gate**: an author-relevant change without `confirmed=true` does not save — it returns `{ "confirmationRequired": true, "affectedDrafts": n, "affectedPublishedProblems": n, "profile": {...} }`. Re-send with `confirmed=true` to apply; the change then cascades to every linked draft (metadata refresh, PDF rebuild, republish) via profile-sync jobs.',
          '`GET /admin/authoring/profile-syncs` and `GET /admin/authoring/profile-syncs/:id` — the profile-sync cascade runs and their per-draft items.',
        ],
      },
    ],
  },
  {
    id: 'worked-example',
    title: 'Worked example — publishing A + B end to end',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A complete classical problem, from login to publish, as copy-pasteable curl. Replace the placeholders in CAPS. The example generates testcases with a seeded generator; the manual alternative (uploading a ZIP) is shown in the Testcases section.',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 0. One-time setup: log in and keep the cookie for the whole session (24 h)\nBASE="http://localhost/api"\ncurl -s -c cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}\' \\\n  "$BASE/login"',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 1. Create the draft with statement, solution and generator in one shot.\n#    Read "id" and "revision" (starts at 1) from the 201 response.\ncurl -s -b cookies.txt -H "Content-Type: application/json" -d @- \\\n  "$BASE/admin/authoring/drafts" <<\'JSON\'\n{\n  "problemId": "aplusb",\n  "title": "A + B",\n  "authorAkaName": "Agent Author",\n  "authorRealName": "Automated Authoring Agent",\n  "language": "English",\n  "countryCode": "THA",\n  "categories": ["Implementation"],\n  "difficulty": 800,\n  "timeLimitMs": 1000,\n  "memoryLimitMb": 256,\n  "statementHtml": "<h2>A + B</h2><p>Read two integers and print their sum.</p><h3>Input</h3><p>A single line with two integers a and b (0 ≤ a, b ≤ 1000000000).</p><h3>Output</h3><p>Print a + b.</p>",\n  "solutionCpp": "#include <iostream>\\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << std::endl; }",\n  "generatorCpp": "#include <bits/stdc++.h>\\nusing namespace std;\\nint main(int argc, char** argv) {\\n  mt19937_64 gen(argc > 1 ? stoull(argv[1]) : 12345ULL);\\n  for (int i = 1; i <= 5; i++) {\\n    ofstream f(\\"input/input\\" + to_string(i) + \\".txt\\");\\n    if (!f) return 1;\\n    f << gen() % 1000000001 << \' \' << gen() % 1000000001 << \'\\n\';\\n  }\\n}"\n}\nJSON\n\nDRAFT_ID="<paste id>"\nREV=1',
      },
      {
        kind: 'paragraph',
        text: '(Patch any field the same way: `PATCH /admin/authoring/drafts/$DRAFT_ID` with `{"expectedRevision": $REV, "title": "..."}` — the response carries the bumped revision. Track it in `REV` after every write.)',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 2. Generate inputs from the seeded generator (replaces any stored testcases).\n#    202 → note the job "id".\ncurl -s -b cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"expectedRevision":\'"$REV"\',"seed":"12345"}\' \\\n  "$BASE/admin/authoring/drafts/$DRAFT_ID/jobs/generate"\n\n# 3. Poll the job until "status" is succeeded / failed / timed_out.\ncurl -s -b cookies.txt "$BASE/admin/authoring/jobs/JOB_ID"',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 4. Generate expected outputs by running the reference solution on every input.\ncurl -s -b cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"expectedRevision":\'"$REV"\'}\' \\\n  "$BASE/admin/authoring/drafts/$DRAFT_ID/jobs/outputs"\n# → poll JOB_ID as above. On success the draft status is "generated".',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 5. Verify: compiles, runs every case, compares outputs, builds the PDF.\ncurl -s -b cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"expectedRevision":\'"$REV"\'}\' \\\n  "$BASE/admin/authoring/drafts/$DRAFT_ID/jobs/verify"\n# → poll JOB_ID. On success: draft "status": "ready", "verifiedRevision": REV.',
      },
      {
        kind: 'code',
        language: 'bash',
        code: '# 6. Publish (201 = created as a hidden problem).\ncurl -s -b cookies.txt -H "Content-Type: application/json" \\\n  -d \'{"expectedRevision":\'"$REV"\'}\' \\\n  "$BASE/admin/authoring/drafts/$DRAFT_ID/publish"\n# → { "draftId": "...", "problemId": "aplusb", "caseCount": 5, "status": "published", ... }\n# The problem is live but hidden; make it visible in Problem Management.',
      },
      {
        kind: 'paragraph',
        text: 'If any step fails, the error `code` names the reason (see the tables above); fix the draft with a `PATCH` (using the fresh revision), then re-run the affected jobs — anything that changes the draft resets verification, so always end with a successful `verify` before publishing.',
      },
    ],
  },
  {
    id: 'rules',
    title: 'Rules summary',
    blocks: [
      {
        kind: 'table',
        head: ['Rule', 'Detail'],
        rows: [
          ['Authentication', 'Staff or admin session cookie. `POST /api/login` once; the cookie lasts 24 hours. 403 for plain users.'],
          ['Login lockout', '10 failed logins for one username within 15 minutes lock the account for 15 minutes. Never retry logins in a loop.'],
          ['Base URL', 'Prefix every backend path with `/api` through the site proxy; the proxy strips it.'],
          ['Revision tracking', 'Every write (draft PATCH, testcase, asset) takes `expectedRevision` and returns `revision` + 1. On `409 revision_conflict`, read `currentRevision`, re-apply, retry.'],
          ['One writer at a time', 'A draft supports one active job. Queue → poll to terminal status → edit. Concurrent edits make job results `stale` and fight each other.'],
          ['Mandatory order', 'Statement + solution → inputs (generator job or ZIP upload) → outputs → verify → publish. Publishing requires verify to have succeeded at the exact current revision.'],
          ['Testcase caps', '1000 cases, 64 MiB per file, 512 MiB total, UTF-8 without NUL, safe unique filenames.'],
          ['After publishing', 'Draft is read-only; `statementHtml`-only PATCH or `new-revision` reopens it; `problemId` is locked; republish updates the same problem, guarded by provenance.'],
          ['Rate limits', '1000 API requests / 15 min per IP; login 10 / 15 min; authoring queue caps pending jobs (429 `queue_full`).'],
          ['One draft per agent', 'Keep concurrent agents on separate drafts — two writers on one draft produce endless revision conflicts.'],
        ],
      },
    ],
  },
];

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|');

/** Serialize the doc to clean markdown — what the "Copy for AI agent" button copies. */
export function buildAiDocsMarkdown(): string {
  const lines: string[] = [`# ${AI_DOC_TITLE}`, ''];
  for (const section of aiDocsSections) {
    lines.push(`## ${section.title}`, '');
    for (const block of section.blocks) {
      switch (block.kind) {
        case 'heading':
          lines.push(`${block.level === 3 ? '###' : '####'} ${block.text}`, '');
          break;
        case 'paragraph':
          lines.push(block.text, '');
          break;
        case 'list':
          block.items.forEach((item, index) => {
            lines.push(block.ordered ? `${index + 1}. ${item}` : `- ${item}`);
          });
          lines.push('');
          break;
        case 'code':
          lines.push('```' + (block.language ?? ''), block.code, '```', '');
          break;
        case 'table':
          lines.push(`| ${block.head.map(escapeCell).join(' | ')} |`);
          lines.push(`| ${block.head.map(() => '---').join(' | ')} |`);
          for (const row of block.rows) {
            lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
          }
          lines.push('');
          break;
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
