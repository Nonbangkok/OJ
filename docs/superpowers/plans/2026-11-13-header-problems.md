# Header Problems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a problem be of type `header`: students submit only `student.h`, which the judge compiles together with secret grader files (`main.cpp`, `<ds>.h`), while public starter files are downloadable as a ZIP.

**Architecture:** Migration 0024 adds `problems.problem_type` / `problems.submission_filename` and a `problem_files` table (role `grader` | `starter`). A small pure module validates file sets and flat ZIPs; a service reads/writes them. The submission pipeline gains a header branch that writes grader files + the submission into the sandbox workspace, compiles all grader `.cpp`, then deletes every source before running. Problem/contest/admin APIs, batch upload, export, and the frontend problem page + admin modal expose it.

**Tech Stack:** Express 5 + TypeScript (NodeNext, strict), `pg` raw SQL, Zod, multer, unzipper, archiver 8, Jest + supertest; React 19 + Vite + Jest/RTL.

**Spec:** `docs/superpowers/specs/2026-11-13-header-problems-design.md`

## Global Constraints

- Problem types: exactly `'standard'` and `'header'`; default `'standard'`; existing rows untouched.
- `submission_filename` non-null iff `problem_type = 'header'`; default value offered by UI/import: `student.h`.
- Filename rule (all three kinds): `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$` (flat, no leading dot, ≤100 chars).
- Grader files: extensions `.cpp` `.h` `.hpp`; ≥1 `.cpp`; none named `submission_filename`.
- `submission_filename`: extension `.h` or `.hpp`.
- Limits: ≤1 MiB per file, ≤20 files per role → `HEADER_PROBLEM_LIMITS = { MAX_FILE_BYTES: 1024 * 1024, MAX_FILES_PER_ROLE: 20 }` in `backend/constants/index.ts`.
- Header problems are C++ only; compile flags identical to standard C++ plus `-fno-diagnostics-show-caret`; no `-O2`.
- Scoring unchanged (stop-on-first-failure prefix score).
- Batch import of an existing id never changes `problem_type`, `submission_filename` or `problem_files`.
- `problem_type` / `submission_filename` change → 409 once any `submissions` or `contest_submissions` row exists for the problem.
- Every new archive intake uses `assertSafeArchive` (zip-slip / zip-bomb).
- Workspace file ops in production go through sandbox-uid helpers (`utils/sandboxProcess.ts`); never `chown`.
- Use `utils/logger.ts`, not `console.*`, in new code.
- Run backend tests with `npm test` (not bare jest); frontend with `npx jest <file>` / `npm run validate`.
- Commits: no `Co-Authored-By` trailer (user preference), user is sole author.

## Review Focus

1. A header problem whose grader ZIP has nested folders (`queue/main.cpp`) → rejected with a message naming the file, not silently flattened. (Task 2 test.)
2. Student `student.h` that `#include "main.cpp"` or defines its own `main` → plain Compilation Error, no grader source text in output. (Task 5 integration test.)
3. Starter download for a hidden problem / a contest problem by a non-participant → 404 / 403 exactly like the PDF routes. (Task 7 tests.)
4. Problem id rename and delete with stored files → files follow the rename and vanish on delete. (Task 3 test.)
5. A header problem exported then imported into an empty DB → identical type, filename and file bytes. (Task 8 test.)

---

### Task 1: Schema, types, constants

**Files:**
- Create: `backend/migrations/0024HeaderProblems.ts`
- Modify: `backend/migrations/index.ts` (register `{ version: '0024_header_problems', sql: headerProblemsSql }`)
- Modify: `backend/constants/index.ts` (add `PROBLEM_TYPES`, `ProblemType`, `PROBLEM_FILE_ROLES`, `ProblemFileRole`, `HEADER_PROBLEM_LIMITS`, `DEFAULT_SUBMISSION_FILENAME = 'student.h'`)
- Modify: `backend/types/models.ts` (`ProblemRow` gains `problem_type: ProblemType; submission_filename: string | null`; new `ProblemFileRow { problem_id: string; role: ProblemFileRole; filename: string; content: Buffer }`)
- Test: `backend/tests/migrations/headerProblemsMigration.test.ts`

**Interfaces:**
- Produces: `PROBLEM_TYPES = ['standard','header'] as const`, `PROBLEM_FILE_ROLES = ['grader','starter'] as const`, `HEADER_PROBLEM_LIMITS`, `DEFAULT_SUBMISSION_FILENAME`, `ProblemFileRow`; table `problem_files(problem_id TEXT REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE, role TEXT CHECK, filename TEXT, content BYTEA, PRIMARY KEY(problem_id, role, filename))`; columns `problems.problem_type TEXT NOT NULL DEFAULT 'standard' CHECK (problem_type IN ('standard','header'))`, `problems.submission_filename TEXT NULL`, `CHECK ((problem_type = 'header') = (submission_filename IS NOT NULL))`.

- [ ] **Step 1: Write the failing migration test** (follow `userSubmissionLockMigration.test.ts`'s gated real-DB pattern)
  - `it('adds problem_type defaulting to standard for existing rows')` — insert a problem before applying 0024, apply, expect `problem_type === 'standard'`, `submission_filename === null`.
  - `it('rejects header without submission_filename')` — expect insert with `problem_type='header'`, null filename to throw code `23514`.
  - `it('problem_files follows problem id rename and delete')` — insert problem + file, `UPDATE problems SET id='p2'`, expect file row with `problem_id='p2'`; `DELETE FROM problems` → 0 file rows.
  - `it('is idempotent')` — applying the SQL twice does not throw (`IF NOT EXISTS` / guarded constraint adds).
- [ ] **Step 2: Run** `cd backend && npm test -- tests/migrations/headerProblemsMigration.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `headerProblemsSql`** plus constants/types above. Check whether `updateProblem`'s explicit rename cascade needs a `problem_files` line: with `ON UPDATE CASCADE` it does not; confirm by the rename test.
- [ ] **Step 4: Run** the test → PASS; then `npm run build` → no type errors.
- [ ] **Step 5: Commit** `feat(db): header problem type and problem_files (0024)`

### Task 2: File-set validation and flat ZIP reading (pure)

**Files:**
- Create: `backend/utils/headerProblemFiles.ts`
- Test: `backend/tests/utils/headerProblemFiles.test.ts`

**Interfaces:**
- Consumes: Task 1 constants.
- Produces:
  - `interface ProblemFileInput { filename: string; content: Buffer }`
  - `validateProblemFilename(name: string): string | null` — error message or null.
  - `validateSubmissionFilename(name: string): string | null`
  - `validateProblemFileSet(role: ProblemFileRole, files: readonly ProblemFileInput[], submissionFilename: string | null): string | null`
  - `readFlatZip(zip: Buffer): Promise<ProblemFileInput[]>` — throws `Error` with a user-facing message on nested paths, duplicates, unsafe archive, or limits; ignores `__MACOSX/` and `.DS_Store`.

- [ ] **Step 1: Failing tests**
  - `validateProblemFilename`: `'main.cpp'`→null; `'../x.h'`, `'a/b.h'`, `'.hidden'`, `''`, 101-char name → non-null.
  - `validateSubmissionFilename`: `'student.h'`, `'student.hpp'`→null; `'student.cpp'`→non-null.
  - `validateProblemFileSet('grader', [queue.h], 'student.h')` → message contains `.cpp`; with `student.h` among grader files → message contains `student.h`; `run.py` in grader → non-null; 21 files → non-null; a 1 MiB + 1 byte file → non-null; `starter` with `student.cbp` → null; empty starter set → null.
  - `readFlatZip`: ZIP of `main.cpp`+`queue.h` → 2 entries with exact bytes; ZIP containing `queue/main.cpp` → rejects with message containing `queue/main.cpp`; ZIP with `__MACOSX/._main.cpp` → ignored.
- [ ] **Step 2: Run** `npm test -- tests/utils/headerProblemFiles.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `unzipper.Open.buffer` + `assertSafeArchive` from `services/batchUploadService.ts` (export it if not exported; it is already unit-tested in `tests/services/assertSafeArchive.test.ts`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: header problem file validation`

### Task 3: Problem files service

**Files:**
- Create: `backend/services/problemFilesService.ts`
- Test: `backend/tests/services/problemFilesService.test.ts`

**Interfaces:**
- Consumes: Task 2 `ProblemFileInput`, `validateProblemFileSet`.
- Produces:
  - `listProblemFiles(problemId: string): Promise<Array<{ role: ProblemFileRole; filename: string; bytes: number }>>` (sizes via `OCTET_LENGTH`, no content read)
  - `getProblemFiles(problemId: string, role: ProblemFileRole, client?: PoolClient): Promise<ProblemFileInput[]>` (ordered by filename; uses `db.query` when no client)
  - `getProblemFile(problemId: string, role: ProblemFileRole, filename: string): Promise<Buffer | null>`
  - `replaceProblemFiles(client: PoolClient, problemId: string, role: ProblemFileRole, files: readonly ProblemFileInput[]): Promise<void>` — DELETE role set then INSERT; caller owns the transaction; validates with the problem's current `submission_filename` and throws `AppError(…, 400)` on invalid.
  - `getHeaderJudgeSpec(problemId: string): Promise<{ problemType: ProblemType; submissionFilename: string | null; graderFiles: ProblemFileInput[] } | null>` (null = problem missing)
  - `hasGraderSource(problemId: string): Promise<boolean>` (any grader file ending `.cpp`)
  - `appendStarterZip(archive: ZipArchive, files: readonly ProblemFileInput[]): void`

- [ ] **Step 1: Failing tests** (mock `db` like `problemQueryService.test.ts`): replace issues DELETE then one INSERT per file inside the given client; invalid set → `AppError` 400 and no INSERT; `getHeaderJudgeSpec` returns null for missing problem and empty `graderFiles` for standard; `hasGraderSource` SQL matches `LIKE '%.cpp'`.
- [ ] **Step 2: Run** `npm test -- tests/services/problemFilesService.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS (service file is under the backend coverage scope it already uses).
- [ ] **Step 5: Commit** `feat: problem files service`

### Task 4: Assembler-embed guard

**Files:**
- Modify: `backend/utils/compileGuard.ts`
- Test: `backend/tests/services/compileGuard.test.ts`

**Interfaces:**
- Produces: `findForbiddenAsm(code: string): string | null` — returns the matched token or null. Comment-strip like `findForbiddenInclude` (block + line comments). Matches identifier tokens `asm`, `__asm`, `__asm__` (word-boundary) and the substrings `incbin`, `.include` anywhere.

- [ ] **Step 1: Failing tests:** `'asm(".incbin \\"main.cpp\\"")'`→`'asm'`; `'__asm__ volatile("")'`→`'__asm__'`; `'const char* s = "incbin";'`→`'incbin'`; `'x .include y'`→`'.include'`; `'int plasma = 1;'`→null; `'int spasm;'`→null; `'// asm\nint x;'`→null; `'/* asm */ int x;'`→null. (Token-pasting forms like `incb##in` are knowingly not caught — best-effort per spec.)
- [ ] **Step 2: Run** `npm test -- tests/services/compileGuard.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: reject inline assembly in header submissions`

### Task 5: Header branch in the judge pipeline

**Files:**
- Modify: `backend/constants/index.ts` (add `HEADER_CPP_PREPARE` next to `LANGUAGE_PREPARE`)
- Modify: `backend/utils/sandboxProcess.ts` (add `removeSandboxFiles`)
- Modify: `backend/services/submissionService.ts` (`runSubmissionPipeline`)
- Test: `backend/tests/services/submissionService.test.ts`, `backend/tests/utils/sandboxProcess.test.ts`, `backend/tests/integration/judgeRuntime.test.ts`

**Interfaces:**
- Consumes: `getHeaderJudgeSpec` (Task 3), `findForbiddenAsm` (Task 4).
- Produces:
  - `HEADER_CPP_PREPARE.checkCommand(cppSources: readonly string[], outputPath: string): RunnableCommand` → `g++ -std=c++20 -fsanitize=signed-integer-overflow -fno-sanitize-recover=signed-integer-overflow -fno-diagnostics-show-caret <sources…> -o <outputPath>` (reuse the flag list from `LANGUAGE_PREPARE.cpp`; don't duplicate literals).
  - `removeSandboxFiles(workspaceDir: string, fileNames: readonly string[], options: SandboxWorkspaceOptions): Promise<void>` — uid-dropped `rm -f -- <paths>`; throws on failure (a failed scrub must not run untrusted code next to grader sources).

Pipeline behaviour for `problem_type = 'header'` (fetch spec once after loading the submission row):
1. `language !== 'cpp'` → Compilation Error, output `This problem accepts C++ only.`
2. `findForbiddenInclude(code) ?? findForbiddenAsm(code)` → Compilation Error (existing message for include; `Compilation rejected: inline assembly ("<token>") is not allowed in this problem.` for asm).
3. Write each grader file (utf-8) and the code as `submissionFilename` into the workspace (privileged: `writeSandboxFile`; dev: `fs.promises.writeFile` mode 0600).
4. Compile with `HEADER_CPP_PREPARE` over grader `.cpp` names (sorted), same `runBoundedCompile`. On failure: `sanitizeCompilerStderr(stderr, submissionFilename)` + existing `oj-submissions` path strip.
5. On success: `removeSandboxFiles` (dev path: `fs.promises.rm`) for all grader filenames + `submissionFilename`; then chmod binary and `judge()` as today.
- Standard problems take the existing path unchanged.

- [ ] **Step 1: Failing unit tests** in `submissionService.test.ts` (existing mocks): header + python → status CE with that message and `judge` not called; header + asm → CE, compile not spawned; header happy path → compile args include `main.cpp` and `-fno-diagnostics-show-caret`, not `solution.cpp`, and the removal helper is called with `['main.cpp','queue.h','student.h']` before `judge`; header with `removeSandboxFiles` rejecting → System Error and `judge` not called; standard problem → unchanged args (existing tests stay green).
- [ ] **Step 2: Failing `sandboxProcess.test.ts`** case: `removeSandboxFiles` spawns `rm` with `['-f','--', <abs paths>]` as the sandbox uid and throws on non-zero exit.
- [ ] **Step 3: Run** `npm test -- tests/services/submissionService.test.ts tests/utils/sandboxProcess.test.ts` → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Extend `judgeRuntime.test.ts`** (runs only inside the backend image): seed header problem `hstack` (grader `main.cpp` reading `n` then pushing/popping a `CP::stack<int>` from `stack.h`, `stack.h` declaring `push/pop/top/size`, testcases `3\n1 2 3\n`→`3 2 1\n`). Cases: correct `student.h` → Accepted 100; wrong pop → Wrong Answer; syntax error → CE whose output contains `student.h` and does not contain a distinctive marker comment/string placed in the grader `main.cpp` (e.g. `GRADER_SECRET_MARKER`); `#include "main.cpp"` in student.h → CE without the marker; student.h with a global ctor doing `fopen("main.cpp")` / `fopen("<workspace>/main.cpp")` via `/proc/self/exe` dirname and printing `open`/`closed` → output `closed` (assert via a testcase expecting `closed`); `asm(".incbin …")` → CE.
- [ ] **Step 7: Run in the backend image** `docker compose exec backend sh -c 'JUDGE_RUNTIME_REQUIRED=1 INTEGRATION_DATABASE_URL=… npm test -- tests/integration/judgeRuntime.test.ts'` (use whatever env the existing CI step uses) → PASS.
- [ ] **Step 8: Commit** `feat(judge): compile header submissions with grader files`

### Task 6: Submit-time rules and type lock

**Files:**
- Modify: `backend/services/submissionQueryService.ts` (`validateAndQueueSubmission`)
- Modify: `backend/schemas/requestSchemas.ts` (`createProblemSchema`, `updateProblemSchema`)
- Modify: `backend/services/problemQueryService.ts` (`createProblem`, `updateProblem`)
- Modify: `backend/types/api.ts` (`CreateProblemRequestBody`, `UpdateProblemRequestBody`)
- Modify: `backend/controllers/problemController.ts` (map `'type_locked'` → 409)
- Test: `backend/tests/services/submissionQueryService.test.ts`, `backend/tests/services/problemQueryService.test.ts`, `backend/tests/problemController.test.ts`

**Interfaces:**
- Consumes: `hasGraderSource` (Task 3).
- Produces: schemas accept optional `problem_type: z.enum(PROBLEM_TYPES)` and `submission_filename: z.string().nullable().optional()` with a `superRefine` using `validateSubmissionFilename` (header ⇒ filename required, defaulting to `DEFAULT_SUBMISSION_FILENAME` when omitted on create; standard ⇒ stored null). `updateProblem` returns `'duplicate_id' | 'not_found' | 'type_locked' | ProblemRow`.

- [ ] **Step 1: Failing tests:** submit to header problem with `language:'python'` → 400 `This problem accepts C++ only.`; header problem without grader `.cpp` → 400 `This problem is not ready for submissions yet.`; standard problem path unchanged. `updateProblem` changing `problem_type` when `EXISTS(submissions)` or `EXISTS(contest_submissions)` → `'type_locked'`; same type with other field changes → updates; controller returns 409 `Problem type and submission filename cannot change after submissions exist.`
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement.** Switching header → standard (allowed only with no submissions) keeps `problem_files` rows; they are ignored by the judge and hidden from the API (`has_starter_files` false for standard).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: header problem submit rules and type lock`

### Task 7: Read APIs — detail DTOs, starter downloads, admin file endpoints

**Files:**
- Modify: `backend/types/models.ts` (`ProblemDetailDTO` + contest detail row gain `problem_type`, `submission_filename`, `has_starter_files`)
- Modify: `backend/services/problemQueryService.ts` (`getProblemDetail`, admin detail), `backend/services/contestParticipantQueryService.ts` (`getContestProblemDetailForParticipant`; new `getContestProblemStarterForParticipant`)
- Modify: `backend/controllers/problemController.ts`, `backend/controllers/contestController.ts`
- Modify: `backend/middleware/upload.ts` only if a new memory policy is needed (reuse `memoryUpload`)
- Test: `backend/tests/problemController.test.ts`, `backend/tests/contestController.test.ts`, `backend/tests/siteAccess.test.ts`

**Interfaces:**
- Consumes: Task 3 service.
- Produces `getContestProblemStarterForParticipant(contestId: string, problemId: string, userId: number, viewer?: { id: number; role: string }): Promise<{ kind: 'not_found_contest' | 'inactive' | 'not_participant' | 'not_found_starter' } | { kind: 'ok'; files: ProblemFileInput[] }>` (same gate order as `getContestProblemPdfForParticipant`).
- Produces routes:
  - `GET /problems/:id/starter` (`requirePublicAccess`) → `application/zip`, `Content-Disposition: attachment; filename="<id>-starter.zip"`; 404 `Starter files not found.` when hidden/contest problem for non-staff (same rule as `/problems/:id/pdf`), when standard, or when no starter files.
  - `GET /contests/:id/problems/:problemId/starter` (`requireAuth`) → same outcomes/messages as the contest PDF route (`not_found_contest` 404, `inactive` 403, `not_participant` 403, missing 404). Finished contests: problem must be in `contest_problems`; files read from `problem_files` by `problem_id`.
  - `GET /admin/problems/:id/files` → `{ problem_type, submission_filename, files: Array<{ role, filename, bytes }> }`
  - `GET /admin/problems/:id/files/:role/:filename` → raw bytes, `application/octet-stream`, `X-Content-Type-Options: nosniff`.
  - `PUT /admin/problems/:id/files/:role` (`memoryUpload.single('filesZip')`) → `readFlatZip` → `replaceProblemFiles` in `withTransaction` → `{ message, files }`; 400 with validation message; 404 unknown problem; 400 when problem is standard (`Only header problems have files.`).
  - Param schemas in `requestSchemas.ts`: `problemFileRoleParamSchema` (`role: z.enum(PROBLEM_FILE_ROLES)`), filename validated with `validateProblemFilename`.

- [ ] **Step 1: Failing controller tests:** public starter 200 for visible header problem (ZIP lists the stored names), 404 for hidden (guest and user), 200 for staff on hidden, 404 for standard, 401 in PRIVATE mode for guest; contest starter mirrors each contest-PDF outcome; admin list/download/replace happy paths; replace with nested-path ZIP → 400 naming the path; non-staff → 403 on admin routes; detail DTO includes the three new fields.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/problemController.test.ts tests/contestController.test.ts tests/siteAccess.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(api): starter downloads and admin problem file endpoints`

### Task 8: Batch upload and export

**Files:**
- Modify: `backend/schemas/problemZipConfig.ts` (`problem_type?`, `submission_filename?`; header ⇒ filename defaults to `student.h`)
- Modify: `backend/services/batchUploadService.ts` (`processProblemDirectory`)
- Modify: `backend/services/problemConfigSerializer.ts`, `backend/types/api.ts` (`ProblemExportConfig`), `backend/types/service.ts` (`ProblemExportBundle` gains `files: ProblemFileInput & { role }[]`), `backend/services/problemQueryService.ts` (`getProblemExportBundle`)
- Modify: `backend/controllers/problemController.ts` (export route writes `grader/` and `starter/`)
- Test: `backend/tests/services/batchUploadService.test.ts`, `backend/tests/services/problemConfigSerializer.test.ts`, `backend/tests/integration/problemZipImport.test.ts`

**Interfaces:**
- Consumes: Task 2 validation, Task 3 `replaceProblemFiles`.
- Produces: config.json keys `"problem_type"` (omitted/`"standard"` for standard) and `"submission_filename"` (header only). Export layout per problem: `config.json`, `<id>.pdf`, `testcases/input|output/…`, `grader/<file>`, `starter/<file>`.

Rules: new header problem → insert with type/filename, read `grader/` and `starter/` (flat; nested → per-problem error) and `replaceProblemFiles`; validation failure → whole problem rolled back and reported in `errors` (existing per-problem error path). Testcase directory scan skips `grader` and `starter`. Existing id → unchanged SKIPPED behaviour (no type/file changes).

- [ ] **Step 1: Failing tests:** batch ZIP with header problem → ADDED, type/filename/files stored; header without `grader/*.cpp` → error entry naming the problem, no problem row; `grader/` with only `.h` files is not mistaken for testcases; existing id with different `problem_type` → SKIPPED and type unchanged; serializer emits `problem_type`/`submission_filename` only for header; integration round-trip: export a header problem, import into a fresh schema → identical type, filename, and file bytes (Review Focus 5).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/services/batchUploadService.test.ts tests/services/problemConfigSerializer.test.ts tests/integration/problemZipImport.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: header problems in batch upload and export`

### Task 9: Authoring publish guard

**Files:**
- Modify: `backend/services/authoringPublishService.ts` (republish `UPDATE problems … WHERE` adds `AND problem_type = 'standard'`)
- Test: `backend/tests/integration/authoringPublish.test.ts`

Decision (builder's call in spec, made here): republishing onto a header problem is refused through the existing `published_problem_mismatch` rejection; type/filename/files never change.

- [ ] **Step 1: Failing test:** publish draft, flip the live problem to header via SQL, republish → rejected `published_problem_mismatch`; problem still header with its files.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(authoring): never republish over a header problem`

### Task 10: Frontend — problem page and submit form

**Files:**
- Modify: `frontend/src/types/models.ts` / `api.ts` (problem detail gains `problem_type`, `submission_filename`, `has_starter_files`)
- Modify: `frontend/src/services/problemService.ts` (`getStarterUrl(problemId, contestId = null): string`, mirrors `getPdfUrl`)
- Modify: `frontend/src/pages/problem/ProblemDetail.tsx` (download button next to "View PDF" when `has_starter_files`; pass `problem` header info to the form)
- Modify: `frontend/src/features/problem/submission/CodeSubmissionForm.tsx`, `frontend/src/hooks/useCodeSubmission.ts` (prop `submissionFilename?: string | null`; when set: language fixed to `cpp`, buttons replaced by a static `C++` label, label `Your student.h` (uses the filename), helper text `Submit only student.h — it is compiled with the grader's own main.cpp.` with the filename substituted)
- Test: `frontend/src/tests/services/problemService.test.ts` (or existing services test), `frontend/src/tests/components/CodeSubmissionForm.test.tsx`, `frontend/src/tests/hooks/useCodeSubmission.test.ts`, `frontend/src/tests/pages/ProblemDetail.test.tsx`

- [ ] **Step 1: Failing tests:** `getStarterUrl('p1')` → `/api/problems/p1/starter`, with contest `5` → `/api/contests/5/problems/p1/starter`; form with `submissionFilename="student.h"` shows no Python button, shows `Your student.h`, submits `language: 'cpp'`; ProblemDetail renders a `Download starter files` link with the starter href only when `has_starter_files`.
- [ ] **Step 2: Run** `cd frontend && npx jest src/tests/components/CodeSubmissionForm.test.tsx src/tests/pages/ProblemDetail.test.tsx src/tests/hooks/useCodeSubmission.test.ts` → FAIL.
- [ ] **Step 3: Implement** (a plain `<a href download>` styled like the existing view-PDF button; no new dependency).
- [ ] **Step 4: Run** → PASS; `npm run test:ci` keeps the services coverage gate (85% branches / 90% lines).
- [ ] **Step 5: Commit** `feat(frontend): starter download and header submit form`

### Task 11: Frontend — admin problem modal

**Files:**
- Modify: `frontend/src/services/admin/problemsAdminService.ts` (`getProblemFiles(problemId)`, `replaceProblemFiles(problemId, role, zip: File)`, `downloadProblemFile(problemId, role, filename)`; create/update payloads carry `problem_type`, `submission_filename`)
- Modify: `frontend/src/features/admin/problems/ProblemModal.tsx` (+ a small `ProblemFilesSection.tsx` beside it)
- Test: `frontend/src/tests/services/` (admin problems service test file), `frontend/src/tests/features/admin/ProblemManagement.test.tsx`
- Visual: `npm run test:visual:update` if the admin modal baseline changes.

UI: `SegmentedControl` "Problem type" (Standard / Header). Header shows a `Submission filename` input (default `student.h`) and two rows, "Grader files (ZIP)" and "Starter files (ZIP)", each listing current files with sizes and a replace-all upload. Disable the type control and filename input with hint `Locked after the first submission.` when the API answered 409 or the problem has submissions (use the 409 message inline; no extra endpoint). File rows only appear for an existing (saved) problem.

- [ ] **Step 1: Failing tests:** service methods hit the routes from Task 7 with `filesZip` field; modal switching to Header shows the filename input with `student.h`; uploading grader ZIP calls `replaceProblemFiles(id,'grader',file)` and re-lists; 400 message shown inline; 409 on save shows the lock message.
- [ ] **Step 2: Run** `npx jest src/tests/features/admin/ProblemManagement.test.tsx` (+ service test) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run validate` → PASS.
- [ ] **Step 5: Commit** `feat(admin): header problem type and file uploads`

### Task 12: Docs and full verification

**Files:**
- Modify: `CLAUDE.md` (Judging pipeline: header problems paragraph; Database: `problem_files`, migration 0024), `.context/DATA_MODEL.md`, `.context/API_SCHEMA.md`

- [ ] **Step 1:** Update docs (one paragraph each, matching existing tone).
- [ ] **Step 2: Run** `./tests/run_tests.sh` → exit 0; `cd frontend && npm run validate` → exit 0.
- [ ] **Step 3: Manual check on the local stack** (`docker-compose up --build -d`): create a header problem from the course example `d65_q3b_queue_total_reverse` (grader main written to read the testcase format; 2 small testcases), download starter ZIP as a student, submit the reference `student.h` → Accepted; submit one with `reverse()` empty → Wrong Answer.
- [ ] **Step 4: Commit** `docs: header problems`
