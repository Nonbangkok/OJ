# Authoring runner protocol — Slices 4–7

Version 1 implements asynchronous `compile_solution`, `compile_generator`,
`run_generator`, `generate_outputs` and `build_pdf` jobs. Compilation-only jobs discard their binaries. Generator jobs
execute a statically linked C++20 binary inside a private jail and persist validated
inputs through the spool. See `AUTHORING_TESTCASES.md` for the Slice 5 artifact and
manual-upload workflow. `AUTHORING_OUTPUTS.md` describes immutable input snapshots,
per-case reference execution and transactional output replacement. `AUTHORING_PDF.md`
describes sanitized immutable statement/image snapshots, bounded PDF rendering and private previews.

## Data flow

1. Admin sends `POST /admin/authoring/drafts/:id/jobs/compile` with a current revision.
2. Backend locks the draft and inserts a job with `request_snapshot` in one DB transaction.
   A partial unique index permits only one active job per draft. Queue reservations
   also serialize the global cap of 100 active jobs.
3. The coordinator writes the immutable JSON request to a private staging directory,
   then atomically renames the complete directory into `ready/<jobId>`.
4. The runner atomically claims `ready/<jobId>` as `active/<jobId>`, compiles the captured
   source in a disposable workspace, and atomically publishes `results/<jobId>.json`.
5. The coordinator validates result identity/schema/size, locks the draft, and applies
   the result only if the job remains active. A changed draft revision yields `stale`.
6. DB completion clears the extra source snapshot. Logs and summary remain in the job;
   acknowledged spool files are removed. Compilation never makes a draft Ready.

`backend/authoring/protocol.ts` is the shared, strict Zod contract and limit definition.
Requests contain version, job UUID, draft UUID, captured revision, compile kind,
source, and deadline. Results contain the same identity plus terminal status,
error code, bounded log, exit code, and duration. Clients cannot set commands,
filesystem paths, environment variables, or compiler flags.

## Recovery and duplicate handling

- DB commit before file delivery: the next coordinator tick redelivers the stored snapshot.
- Repeated delivery while ready/active/completed files exist: the first snapshot/result wins.
- Runner restart with active work: startup emits `runner_interrupted` for unfinished jobs.
- Result exists before DB import: startup/next tick imports it.
- DB import before file cleanup: the next scan cleans files for terminal jobs.
- Duplicate results cannot overwrite a terminal DB job; source revisions are checked under a draft lock.
- Invalid JSON, oversized/symlink results, or mismatched identities fail the job durably.
- Jobs without a result expire after 15 minutes, including time spent queued. Disk/DB outages
  are retried rather than being reported as successful work.
- Unfinished staging entries older than the job timeout are cleaned. The database stores
  bounded diagnostics for failures; there is no failed-workspace retention requirement.

The backend coordinator uses a PostgreSQL advisory lock per reconciliation pass;
runner processes use a kernel `flock` on the shared volume. Run one consumer per
spool. Both supervisors must own the same root-private spool; compiler subprocesses
must not be able to read or write it.

## Runtime boundaries

Compose supplies a dedicated `authoring-jobs` volume to backend and runner. The
runner image contains the worker, Zod/HTML parser, compiler, pinned wkhtmltopdf,
versioned template/font bundle and OS tools. It receives no
database credentials, API secrets, Docker socket, host workspace, or network.

- Read-only container root; disposable 768 MiB executable `/work` and 32 MiB noexec `/tmp`.
- Container: 1 CPU, 1 GiB memory, 256 processes, no-new-privileges.
- Root supervisor retains SETUID, SETGID, KILL, SYS_CHROOT and DAC_OVERRIDE capabilities;
  the last two enable the runtime jail and cleanup of unreadable child-owned files.
- Compiler: uid/gid 65534; minimal PATH/LANG/TMPDIR environment; no shell.
- Compiler limits: 30 seconds wall time, 768 MiB address space, 128 processes,
  64 MiB per output file, no core dumps, 10 MiB diagnostics before termination.
- Persisted logs: at most 64 KiB; workspace paths and control characters removed.
- PDF renderer: Ubuntu24.04/wkhtmltopdf0.12.6-2build2, uid/gid65534, offscreen Qt,
  60s wall, 2 GiB virtual address space within the unchanged1 GiB container RAM cap,
  64 MiB PDF maximum, captured-image/template-only local loading and no network.
- Literal forbidden includes use the same guard as the existing judge. Filesystem
  permissions isolate private job files even when macro includes bypass that guard.
- Compiler process groups are killed on timeout/output overflow/shutdown and workspaces
  removed after completion. Generator execution is enabled in a private chroot;
  reference execution uses a read-only chroot and captured stdin (see Slice 6 contract).

`AUTHORING_JOBS_DIR` is validated in backend runtime config. Compose sets `/jobs`;
an empty host value disables queue submission (HTTP 503) while existing job history
remains readable. Start the normal Compose stack to use the runner. Production's
overlay preserves the same worker isolation and shared volume configuration.

## Verification

- `authoringTransport.test.ts`: atomic delivery, immutable retry, symlink refusal,
  restart recovery, bounded process logs/time, and child environment isolation.
- `authoringCoordinator.test.ts`: discard the connection after an advisory-unlock
  failure, preventing leaked pool slots or reused sessions with uncertain locks.
- `authoringJobs.test.ts`: real PostgreSQL reservation conflicts, durable redelivery,
  stale and duplicate results, malformed output, expiry, UUID normalization, and
  optional HTTP-to-runner E2E fixtures.
- `authoringCompiler.test.ts`: real Linux C++20 success/error/timeout fixtures and
  forbidden/private include tests, running as nobody from a root supervisor.
- `authoringJobController.test.ts`: auth, body validation, disabled runner, conflict
  mapping, and metadata-only responses.
- `tests/composeConfig.test.mjs`: local and production isolation policies.

Use the disposable test Compose stack described in README to include E2E runner
checks. Never set `INTEGRATION_DATABASE_URL` to a database containing user data;
older integration tests reset the public schema.
