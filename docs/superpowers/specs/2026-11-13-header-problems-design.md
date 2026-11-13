# Header Problems (function-implementation problems) — Design

Date: 2026-11-13
Status: draft, awaiting approval

## Intent

Support the problem style used in Chula 2110328 (Data Structures & Algorithms),
e.g. `d65_q3b_queue_total_reverse`: the student does **not** write a whole
program. The problem ships a data-structure header (`queue.h`, `vector.h`, …)
that declares a class in `namespace CP`, a `main.cpp`, and a `student.h`
template. The student implements (and may edit) member functions in
`student.h` and submits **only `student.h`**. The grader compiles it together
with its **own** `main.cpp` and header — the grader's `main.cpp` differs from
the student's copy (e.g. it reads a command stream, interleaves push/pop with
the new function, and instantiates other `T` such as `std::string`) so it can
catch edits that break pre-existing functions.

This feature is the prerequisite for a follow-up project: a starter set of
50 such problems (pair / vector / stack / queue / priority_queue × 10, easy →
hard), imported through the batch upload defined here. That content project is
out of scope for this document.

## Goals

- A problem can be of type `header` (the existing behaviour is type `standard`).
- A header problem stores two file sets:
  - **grader files** — secret; used only to compile submissions
    (e.g. `main.cpp`, `queue.h`).
  - **starter files** — public; downloadable by students as a ZIP
    (e.g. the student `main.cpp`, `queue.h`, `student.h` template, optionally a
    `.cbp`).
- A header problem names the **submission filename** (default `student.h`).
- Judging a header submission: place the submitted code as `<submission
  filename>` next to the grader files, compile every grader `.cpp`, run the
  binary against testcases exactly like a standard C++ submission.
- Students download starter files from the problem page (and the contest
  problem page), and the submit form makes clear they submit `student.h`, C++
  only.
- Admins set the type, submission filename, grader files and starter files from
  the problem admin UI, and via batch-upload ZIP; problem export includes them
  so export → import round-trips.

## Non-goals

- Python header problems. Header problems are C++ only.
- Multiple submitted files. Exactly one submitted file.
- Automatic enforcement of the statement rules "student.h must not do I/O /
  must not use other preprocessor directives". The original grader does not
  enforce them either (checked manually afterwards); admins can read submitted
  code as today. The existing `findForbiddenInclude` guard still runs.
- Authoring-workspace (problem_drafts → publish) support for header problems.
  Authoring keeps producing `standard` problems only (see Constraints for the
  one guard it needs).
- Changing scoring. The judge stays stop-on-first-failure with prefix score
  (JUDGE-007); problem content orders testcases by subtask so prefix score
  reproduces the statement's subtask percentages.
- Changing compiler flags. Header problems use exactly the standard C++ flags
  (`g++ -std=c++20 -fsanitize=signed-integer-overflow
  -fno-sanitize-recover=signed-integer-overflow`, no `-O2`); problem content
  calibrates time limits against this judge.

## Anti-goals (would be a failure even if it "works")

- A student can casually obtain the grader's `main.cpp` **source text** — by
  reading it from the workspace at run time, through echoed source lines in
  compile errors, or by embedding it with `asm(".incbin ...")`. Secrecy target
  is "same level as standard problems today", not "no channel at all": a
  determined student can already print testcase input to stderr and crash to
  see it in the Runtime Error output, and can likewise dump their own binary,
  so compiled grader logic and grader identifiers in diagnostics are accepted
  leaks (see "Calls made after review").
- Standard problems behave any differently, or existing data needs manual
  fixing after the migration.
- A header problem becomes judgeable with an incomplete setup (no grader
  `.cpp`, no testcases) and produces confusing System Errors for students.

## Constraints (from the current code)

- Judge pipeline: `services/submissionService.ts` (`runSubmissionPipeline`)
  writes the code as `solution.<ext>` in a per-submission sandbox workspace and
  compiles via `LANGUAGE_PREPARE[lang].checkCommand`; in production every
  workspace file operation runs as the sandbox uid (`writeSandboxFile`,
  `chmodSandboxPath`, `removeSandboxWorkspace` in `utils/sandboxProcess.ts`) —
  root has no CAP_CHOWN/FOWNER/DAC_OVERRIDE. Any new file operation in the
  workspace must follow the same by-construction pattern.
- The run step (`judgeService.runSingleCase`) executes the binary **as the same
  sandbox uid that owns the workspace files**, so anything left in the
  workspace is readable by the student's program (it can find the workspace via
  `/proc/self/exe`). Grader sources (and the submitted header) must be deleted
  from the workspace after compile and before the first testcase runs.
- Compile diagnostics are shown to the submitter after
  `sanitizeCompilerStderr`. g++ echoes source lines (caret display) from any
  file, including the grader `main.cpp`.
- Problem ids can be renamed (`updateProblem` cascades manually to dependent
  tables); deletes are explicit in `deleteProblem` / `deleteProblems`.
- Schema changes go through a new numbered migration (next: `0024…`), never by
  editing an applied one.
- Access rules for problem assets: `GET /problems/:id/pdf` (public access mode,
  hidden/contest problems 404 for non-staff) and
  `GET /contests/:id/problems/:problemId/pdf` (contest-guarded). Starter files
  must follow the same two rules.
- Authoring publish writes into `problems`; it must not clobber a header
  problem's type/files.
- Validation via Zod in `schemas/requestSchemas.ts`; uploads via
  `middleware/upload.ts`; archives already handled with zip-slip/size checks in
  `batchUploadService.ts` (reuse those checks for every new ZIP intake).

## Approaches considered

- **A. Separate stored files + multi-file compile (chosen).** New
  `problem_files` storage, header-aware judge step, starter-ZIP download, admin
  + batch-upload + export support. Most work, but matches the original grader
  exactly: students keep `#include "queue.h"`, diagnostics point at real
  `student.h` lines, and the run directory can be scrubbed of grader sources.
- **B. Concatenate into one `solution.cpp`.** Store header/main as text, glue
  `ds.h + student.h + main.cpp`, reuse the single-file pipeline. Less judge
  work, but requires stripping the student's `#include "queue.h"`, shifts
  line numbers in diagnostics, makes leaking the secret main through
  diagnostics easier, and still needs starter-file distribution — rejected.
- **C. Hide grader files inside the testcase ZIP.** Rejected: testcase intake
  and the admin testcase viewer assume `.in/.out` pairs only; overloading them
  is fragile.

User picked A.

## Design

### Data model (migration `0024HeaderProblems`)

- `problems.problem_type TEXT NOT NULL DEFAULT 'standard'`
  `CHECK (problem_type IN ('standard','header'))`.
- `problems.submission_filename TEXT NULL` — required (non-null) when
  `problem_type = 'header'`, null otherwise (CHECK constraint).
- New table `problem_files`:
  - `problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE`
  - `role TEXT NOT NULL CHECK (role IN ('grader','starter'))`
  - `filename TEXT NOT NULL`
  - `content BYTEA NOT NULL`
  - `PRIMARY KEY (problem_id, role, filename)`
  (If `ON UPDATE CASCADE` conflicts with how renames are done today, the
  builder may instead add the table to the explicit cascade in `updateProblem`
  and the explicit deletes in `deleteProblem(s)` — either is fine, but both
  rename and delete must be covered and tested.)
- Existing rows default to `standard`; no data backfill.

### File rules

- Filenames: flat names only (no directories), `^[A-Za-z0-9_.-]{1,100}$`, no
  leading dot.
- Grader files: extensions `.cpp`, `.h`, `.hpp`; at least one `.cpp`; must not
  contain a file named the same as `submission_filename`.
- Starter files: any flat filename (allows `.cbp`, `.txt`); not required to
  exist.
- `submission_filename`: same filename rule, extension `.h` or `.hpp`.
- Per-file cap 1 MiB, at most 20 files per role (new constants, e.g.
  `HEADER_PROBLEM_LIMITS` in `constants/index.ts`).
- Grader/starter files are replaced as a whole set per role (replace-all
  semantics, like testcase upload) — no per-file editing UI.

### Judging

In `runSubmissionPipeline`, when the problem is `header`:

1. Reject non-`cpp` language as Compilation Error defensively (submit-time
   validation already prevents it — see Submission).
2. Write each grader file into the workspace (sandbox-owned, like
   `writeSandboxFile`), and write the submitted code as
   `<submission_filename>`.
3. Run `findForbiddenInclude` on the submitted code (unchanged guard), plus a
   header-problem guard that rejects (Compilation Error with a clear message)
   submitted code containing the tokens `asm`, `__asm`, `__asm__`, `incbin`
   or `.include` anywhere (after comment stripping, like the include guard),
   closing the assembler file-embed channel. Best-effort, like the include
   guard; the statement already forbids such tricks.
4. Compile: `g++` with the standard C++ flags, all grader `.cpp` files as
   inputs, `-o solution.out`, plus `-fno-diagnostics-show-caret` so no source
   lines are echoed. cwd = workspace (relative paths, as today).
5. On compile failure: Compilation Error with sanitized stderr. Sanitizing
   must additionally ensure no grader-file content appears; with caret display
   off, only `file:line:col: message` lines remain, which is acceptable
   (file names and line numbers of the grader main may show; its source text
   must not).
6. After a successful compile, delete every grader file and the submitted
   header from the workspace (as the sandbox uid in privileged mode), leaving
   only the binary, before `judge()` runs the first testcase.
7. Everything else (limits, verdicts, XP, realtime) is unchanged.

Ideally this is expressed as a "prepare plan" next to `LANGUAGE_PREPARE`
rather than `if (header)` branches scattered through the pipeline; exact shape
is left to the builder.

### Submission

- Submit-time validation (`validateAndQueueSubmission`): header problem +
  language ≠ `cpp` → 400 "This problem accepts C++ only."
- Header problem with no grader `.cpp` file → 400 like the existing
  zero-testcase rule ("not ready yet").
- Rejudge needs no special handling (it reuses the pipeline).

### Problem API

- Problem detail DTOs (`GET /problems/:id`, contest problem detail, admin
  problem detail) gain `problem_type`, `submission_filename`, and
  `has_starter_files`.
- `GET /problems/:id/starter` → ZIP of starter files
  (`<problem-id>-starter.zip`), same access rule as `/problems/:id/pdf`.
- `GET /contests/:id/problems/:problemId/starter` → same, guarded like the
  contest PDF route.
- Admin (staff|admin):
  - `PUT /admin/problems/:id` / `POST /admin/problems` accept
    `problem_type` and `submission_filename` (Zod-validated; switching to
    `standard` keeps stored files but they are ignored — or deletes them;
    builder's call, but it must be consistent and tested).
  - Changing `problem_type` or `submission_filename` is refused (409) once the
    problem has any row in `submissions` or `contest_submissions`: old
    submissions would otherwise be rejudged under the wrong shape. Grader
    files, starter files and testcases stay replaceable at any time (fixing a
    grader `main.cpp` then rejudging is a normal workflow). No per-submission
    snapshot of type/filename is stored.
  - `POST /admin/problems/:id/files/:role` — upload a ZIP (flat) that replaces
    that role's file set; validated with the rules above and the existing
    archive safety checks.
  - `GET /admin/problems/:id/files` — list both roles (name + size);
    `GET /admin/problems/:id/files/:role/:filename` — download one (staff
    only, grader files never exposed elsewhere).

### Batch upload / export

- Per-problem directory may contain `grader/` and `starter/` subfolders; their
  files populate `problem_files`. `config.json` gains optional
  `"problem_type": "header"` and `"submission_filename": "student.h"`.
  Testcase detection must ignore `grader/` and `starter/`.
- A header problem in a batch ZIP that fails validation (e.g. no grader
  `.cpp`) is reported in the batch log and skipped, same as other per-problem
  errors today.
- Problem export writes the same layout and fields, so export → import into a
  database without that id round-trips a header problem byte-for-byte.
- Existing ids keep today's semantics: batch import of an id that already
  exists is SKIPPED for PDF/testcases, and likewise leaves `problem_type`,
  `submission_filename` and `problem_files` untouched (only categories,
  difficulty and collection are updated, as today). Correcting an existing
  header problem goes through the admin per-problem uploads, or delete +
  re-import.

### Authoring guard

- Authoring publish onto an existing problem id that is `header` must either
  refuse or leave `problem_type`, `submission_filename` and `problem_files`
  untouched. Builder's choice; must be tested.

### Frontend

- Problem page (and contest problem page) for a header problem:
  - "Download starter files" button next to the PDF (hidden when no starter
    files).
  - Submit form: language buttons replaced by a fixed "C++" label; the editor
    label reads "Your `student.h`" (uses `submission_filename`).
  - A short line explaining "Submit only `student.h`; it is compiled with the
    grader's own `main.cpp`."
- Admin `ProblemModal`: a "Problem type" `SegmentedControl` (Standard /
  Header); when Header: submission filename field (default `student.h`) and
  two upload rows (grader ZIP, starter ZIP) showing the current file list with
  sizes, each replace-all. Follow existing admin patterns (Dialog, quiet
  actions, testcase upload UX).
- Problem list: a small "Header" (`.h`) badge on header problems (optional;
  builder may skip if it clutters the card).
- New service functions under `services/` keep the 85%/90% coverage gate.

### Testing

- Backend unit: filename/file-set validation; prepare plan for header
  problems (compile command contains all grader `.cpp`, caret flag,
  submission filename); submit rejects Python and not-ready header problems;
  starter ZIP access rules (public, hidden, contest, private mode); batch
  upload with `grader/`/`starter/`; export round-trip; rename/delete cascade.
- Backend integration (where g++ is available, like existing judge tests): a
  tiny header problem (e.g. a 2-function `CP::stack`) judged Accepted, WA,
  Compilation Error (diagnostic contains no grader source text), a
  submission that tries to `fopen` the grader `main.cpp` at run time fails to
  read it, and a submission using `asm(".incbin ...")` is rejected.
- Type/filename change refused with 409 once submissions exist.
- Frontend: submit form in header mode, starter download button, admin modal
  type switch.
- Visual regression baselines updated if the admin problem modal changes.

## Calls made after review (designer's calls, user may override)

1. Grader secrecy = "no casual source-text leak", matching the existing
   standard-problem level (Runtime Error stderr already exposes whatever a
   program prints, including testcase input). Measures: scrub the workspace
   before running, `-fno-diagnostics-show-caret`, and the `asm`/`incbin`
   token guard. Not done: stripping the binary, hiding RE stderr, redacting
   grader identifiers from diagnostics.
2. Type / submission filename are locked once submissions exist (409); files
   and testcases stay replaceable.
3. Batch import does not update an existing header problem (same as PDF and
   testcases today).
4. Compile errors may show grader file names, line numbers and identifiers
   (e.g. `no matching function for call to 'CP::queue<int>::f(int&)'`); only
   echoed source lines are suppressed.

## Left to the builder

- Exact module/function boundaries (prepare-plan shape, service names).
- Whether switching a problem back to `standard` deletes its files.
- Whether authoring publish refuses or preserves on header problems.
- Exact wording/layout of the new UI bits within existing design patterns.
- Whether to show the problem-list badge.
