# Reference-solution outputs — Slice 6

## API and semantics

Authenticated staff/admins queue `POST /admin/authoring/drafts/:id/jobs/outputs`:

```json
{ "expectedRevision": 3 }
```

The response is HTTP 202 with private-job metadata, not source or testcase contents.
Poll `GET /admin/authoring/jobs/:id` for status, diagnostics and result summary.
The draft needs a nonempty C++ solution and at least one stored input; no generator
is required. Manual and generated inputs can be used together. Existing single-job,
queue-cap, revision and published-draft guards apply. Missing source/inputs and
unsupported limits return explicit HTTP 400 codes; an unconfigured runner returns 503.

Queue reservation captures solution source, time/memory limits, ordered case IDs,
filenames, sizes and SHA-256 hashes. Migration `0004_authoring_job_inputs` stores
the actual immutable input bytes separately from the bounded JSON request. Snapshot
rows have no foreign key to live cases, so edits/deletions cannot alter queued work.
The coordinator delivers one input at a time into the private request directory and
renames it into the ready queue only after all files validate. Delivery can recover
from a backend restart without consulting the current live inputs.

The runner compiles C++20 once with static linking, executes it once per stored
input, and captures exact stdout. Whitespace, CRLF, BOM and empty output are retained;
NUL and malformed UTF-8 fail validation. Stderr is diagnostic text, never an answer.
Outputs are staged incrementally on the private disk-backed spool, rather than
retaining the entire testcase set in memory or the runner's work tmpfs.

Only successful completion of every case publishes an output manifest. The backend
checks identity, revision, complete ordered case mapping, input+output aggregate
size, every file's size/hash/text, and imports **all outputs in one transaction**.
Case IDs, order, input data and input provenance remain unchanged. Success sets
`generated`, clears verified readiness, and retains the captured revision. A failed,
timed-out, stale, duplicate, corrupted or incomplete result cannot partly replace
previous outputs. A concurrent terminal transition during import rolls back the
whole transaction. Terminal jobs release input snapshot rows; coordinator cleanup
removes transport files after acknowledgement or on subsequent recovery.

## Runtime contract

- Same network-none, read-only, 1 CPU / 1 GiB / 256 PID container as Slice 5.
- Per-case wall timeout uses the problem's `timeLimitMs`; total job deadline is
  15 minutes, including queue time and compilation. Compilation is capped at 30s.
- Solution address-space limit is `memoryLimitMb + 32 MiB`, matching the existing
  judge's allowance. Current runner supports requested memory limits up to **736 MiB**
  and time limits up to 900000ms. Larger configured values are explicitly rejected
  with `unsupported_resource_limits`, never silently reduced. Very large valid jobs
  can still exhaust the overall deadline before all cases finish.
- Solution runs as uid/gid 65534 in a read-only minimal chroot containing only its
  executable. No host files, shell, network sockets, writable scratch filesystem,
  user-supplied environment or compiler flags are available.
- Solution forks/vfork/non-thread clones are denied, so child processes cannot
  multiply the per-process memory allowance. Normal threads sharing address space
  remain allowed, subject to the 128-task limit. Generator fork behavior is retained.
- Stdout: at most 64 MiB per case; complete stored input+new output set at most
  512 MiB, at most 1000 cases. Stderr: 10 MiB per execution, 64 KiB retained log.
- Per-case `durationMs` is supervisor-measured wall time, not a parsed claim from
  the solution. Peak RSS/CPU usage and an exact MLE verdict are not reported here;
  address-space allocation failures/nonzero exits are `solution_runtime_error`.
- First runtime failure records `failedCase` with case ID, number and wall duration.
  Success records `caseCount` and output hashes/sizes/durations. Compiler failures
  have no failed testcase because execution has not started.

Generation is not an algorithm-correctness check or `Verify All`; it uses the
author's reference solution as the answer source. The contestant judge and its
existing whitespace matcher are unchanged. PDF rendering is Slice 7, mechanical
verification Slice 8, Publish Slice 9 and Admin frontend Slice 10.

## Deployment and verification

Deploy backend and runner images together and run the registered migrations before
enabling new jobs. Do not mix a Slice 6 producer with a Slice 5 runner: both use a
strict version-1 schema, whose supported job variants have expanded.

Use `tests/authoring/compose.yml` as documented in README for a disposable PostgreSQL
database plus isolated runner. Never point the full integration suite at user data;
older suites reset the public schema. Relevant suites: `authoringOutputs`,
`authoringOutputRuntime` (including portable process tests), `authoringOutputProtocol`,
`authoringOutputSpool`, existing generator/job regression suites and Compose policy.
