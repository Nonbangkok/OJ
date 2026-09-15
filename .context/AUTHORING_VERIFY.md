# Mechanical verification — Slice 8

## API and lifecycle

Authenticated admins send `POST /admin/authoring/drafts/:id/jobs/verify` with
`{ "expectedRevision": 3 }`. Response202 contains job metadata, never private
source or testcase bytes. Poll `GET /admin/authoring/jobs/:id` until terminal.

Queue reservation validates stored metadata using the editor's existing Problem
ID/title/author/language/country/limit rules. IDs are not reserved here; uniqueness
against published problems remains a Publish transaction requirement in Slice9.
The statement must be nonempty, safe, and reference only captured assets. A saved
solution and at least one complete input/output pair are required. Null output is
missing; an empty string is a valid expected output. A blank/null generator is
optional. No existing PDF is required because verification renders one itself.

Errors before queueing:

- 400: `invalid_metadata`, `source_missing`, `invalid_statement`,
  `unsupported_template`, `inputs_missing`, `outputs_missing`, `invalid_testcases`,
  `unsupported_resource_limits` or body/UUID validation errors.
- 404 missing draft;409 revision conflict, published draft or active job;
  429 global queue cap;503 runner not configured.

An accepted verification supersedes previous readiness: sets `draft`, clears
`verified_revision`, and keeps the revision, existing PDF and testcase data intact.
Rejected queue requests do not mutate the draft. After every mechanical check
passes, the backend atomically installs the new PDF, sets `latest_pdf_revision`
and `verified_revision` to the captured revision, and changes status to `ready`.

Saving any author-controlled content advances revision and invalidates readiness.
Stale/failed/corrupt/incomplete/duplicate/expired results cannot make a draft ready
or replace its old PDF. Verification **never rewrites inputs or expected outputs**.
It does not publish or make a problem visible.

## Immutable transport and execution

`verify_all` combines the version1 PDF snapshot, solution source, optional
`generatorSource`, ordered `cases`, corresponding `expectedOutputs` size/hash
manifests and runtime limits. Queueing holds the draft lock while capturing all
data. No new migration: inputs use `authoring_job_inputs`; avatar/assets and
expected output bytes use `authoring_job_files` (names `output:<case UUID>`).
There are no foreign keys back to mutable live testcase or image rows.

Delivery verifies hashes and text, writes files individually under a root-private
staging directory and exposes the request atomically. Execution consumes only
these captured bytes, not live DB rows. Expected files live under `expected/` and
are not accessible inside the solution jail. Terminal cleanup releases both DB
snapshot tables and transport files, including reconciliation after restart.

The worker performs, in order:

1. Re-sanitize captured HTML and render the versioned PDF.
2. Compile the reference solution once as C++20, statically linked.
3. If present, compile the generator as C++20; **do not execute it**.
4. Execute the solution sequentially against every captured input.
5. Validate captured stdout and compare it to the stored expected output using
   the current contestant judge semantics: `text.trim().replace(/\r\n/g, '\n')`,
   then exact string equality. Internal whitespace remains significant. No
   token matching, floating-point tolerance, custom checker or brute solution.

Output files are staged one at a time on the private disk-backed spool, compared
and discarded. They are not installed as testcase answers or published artifacts.
Only the verified PDF has an artifact manifest on successful completion.

The backend checks the complete report against the captured job: ordered case
identity, case count, total stored bytes, configured memory, generator presence,
all required checks passed and matching PDF template/hash. Under the draft lock,
it checks source revision and the active job again. The final job UPDATE uses
database `clock_timestamp()` to reject expiry during artifact I/O. If rejected,
all pending PDF/readiness writes roll back before timeout cleanup is recorded.

## Reports, limits and meaning

`resultSummary.verification` contains:

- `checks.pdf`, `.solution`, `.generator`, `.execution`: `pending`, `passed` or
  `failed`; only generator may be `skipped`.
- `cases`: attempted case IDs/numbers and supervisor-measured wall `durationMs`,
  in order through the first failure. Pre-execution failures may have duration0.
- `caseCount`, `totalTestcaseBytes` (stored inputs + expected outputs),
  `memoryLimitMb`, `peakMemoryBytes: null`, and bounded `warnings`.

Top-level summary retains phase-labelled logs, runtime duration/exit code,
`failedCase` for the first execution/comparison failure, PDF manifest when successful,
`totalArtifactBytes` (stored pair bytes, captured images and successful PDF), and
`verifiedRevision` only when applied successfully. Infrastructure failures before
stage reporting may have a null verification report. A stale job can retain a
successful worker report without a verified revision or an installed PDF.

Bounds are unchanged:1000 pairs,64 MiB per input/output,512 MiB total stored pairs
and separately stored inputs + actual execution outputs,30s/compiler,60s/PDF,
15min whole job including queueing,1 CPU/1 GiB RAM/256 PID container. Solution
memory accepts at most736 MiB plus32 MiB address-space allowance. Network remains
disabled, sources compile unprivileged, solution runs inside the existing
read-only chroot, and expected outputs stay outside it.

Peak RSS and exact MLE classification remain unavailable; a warning says so.
Memory limits are enforced, not measured or certified. Generator reproducibility
is unverified and explicitly warned when one exists; it does not block readiness.
`wrong_answer` means stored-output mismatch, not a proof that either algorithm or
expected answer is mathematically incorrect. The author owns content correctness.

Deploy backend and runner together; do not mix expanded strict protocol variants
with an older runner. This slice does not redeploy existing stacks. Publish is
Slice9 and the Admin UI is Slice10. Reproduction commands are in README.
