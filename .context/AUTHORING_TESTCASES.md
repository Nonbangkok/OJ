# Authoring testcases — Slice 5

The backend supports legacy multi-file C++ generators and manual input/output
uploads. The Admin frontend remains Slice 10; reference-solution output generation
is documented in `AUTHORING_OUTPUTS.md` (Slice 6). Existing public problem uploads and contestant judging are unchanged.

## Generate inputs

`POST /admin/authoring/drafts/:id/jobs/generate`

```json
{ "expectedRevision": 2, "seed": "12345" }
```

An explicit unsigned 64-bit decimal **string** avoids JavaScript precision loss.
The immutable job records the source, seed, revision and deadline. A missing
generator returns `source_missing`; it does not prevent manual testcase editing.
Only one active compile/generate job is permitted per draft.

The runner compiles C++20 with static linking and invokes the generator once in a
fresh filesystem containing `/generator` and an empty writable `/input`:

```text
OJ_SEED=12345 ./generator 12345
```

Working directory is the jail root, so old `./input/input01.txt` writers work
unchanged. Standard-library `random_device` generators are supported. There are
no external runtime libraries, host paths, shell executables or network in the
generator filesystem. Runtime children are uid/gid 65534, without supplementary
groups or retained capabilities. Seccomp prevents changing process groups or
creating/joining namespaces; timeout/shutdown kills the complete process group.

All generated files must be flat, regular, singly linked UTF-8 files with safe
ASCII filenames (up to 255 characters; no path traversal). Symlinks, FIFOs,
devices, subdirectories, NUL and invalid UTF-8 are rejected. Natural filename
sorting with an explicit tie-break determines 1-based case numbers. Whitespace,
CRLF and BOM are preserved, and empty files are valid.

Limits: 1,000 cases, 64 MiB per input/output, 512 MiB per complete testcase set,
60 seconds generator wall time, 30 seconds compilation, 15 minutes per job,
10 MiB live diagnostics and 64 KiB retained logs. CPU/address-space/process/file
limits and the container's 1 GiB memory/256 process limits also apply.

Validated files are copied into a private staged artifact directory and hashed.
The complete artifact set is renamed before result JSON is published. The backend
revalidates filenames, sizes, hashes, job identity and revision, reads one input at
a time, and replaces **all** prior testcase inputs/outputs in the same DB transaction
as job completion. Outputs start as null. Successful generation keeps the captured
revision, clears verified readiness, and sets `generated`. Failure, stale results,
or incomplete/corrupt artifacts preserve the entire previous testcase set.

`resultSummary` records `seed`, `caseCount`, input names/sizes/hashes,
`reproducibility: "unverified"`, and a warning. Merely providing a seed does not
prove a generator uses it. No claim of reproducibility or algorithmic correctness
is made; a two-run reproducibility check is not implemented in this slice.

## Manual input/output workflow

All routes below require an authenticated staff or admin, including reads.

| Method/path relative to `/admin/authoring/drafts/:id` | Behavior |
| --- | --- |
| `GET /testcases` | Current revision and sorted metadata; no input/output text loaded |
| `GET /testcases/:caseId` | One private testcase's exact input/output content and metadata |
| `POST /testcases` | Multipart `expectedRevision`, `input`, optional `output`: append one case |
| `POST /testcases` | Multipart `expectedRevision`, `archive`: replace the entire set from ZIP |
| `PATCH /testcases/:caseId` | Multipart revision plus input and/or output: update one case |
| `DELETE /testcases/:caseId` | JSON `{ "expectedRevision": 3 }`: delete one case |

Every successful manual mutation increments revision and clears readiness. Replacing
an input without a new output clears the previous output. Output-only PATCH is valid;
an output without an input on POST is rejected. Empty output is different from missing
output. Published drafts are read-only. Concurrent edits with the same revision allow
one winner; edits while generation runs cause that job's result to become stale.
Deletion preserves the remaining case numbers; ZIP/generator replacement renumbers.

ZIP conventions match the existing grader's implemented pairing rules:

- Flat numbered `.in`/`.out`/`.sol` files or `inputN.txt`/`outputN.txt`, in one directory.
  Leading zero variants represent the same number and duplicate sides are rejected.
- One `input/` and `output/` directory pair, optionally under a common folder. Complete
  sets are naturally sorted independently and paired by position, as in the old grader.
- Input-only sets are valid. Partial directory outputs require identical input basenames;
  ambiguous pairing, mixed layouts, output-only cases and duplicate filenames are rejected.
- Finder metadata is ignored after path/type/size checks. Traversal, links, encrypted,
  split/ZIP64 archives, malformed directories and excessive counts/sizes are rejected.

Uploads stream to a per-request private temporary directory with per-file and aggregate
byte limits. ZIP extraction never writes archive paths. The exact validated ZIP end
record and every bounded central-directory record are checked before opening entries.
Input/output pairs are decoded lazily and inserted one at a time within a transaction,
so the whole 512 MiB set is never retained as decoded strings. A late decoding/DB/limit
failure rolls back all changes. Temporary uploads are removed on success, failure and
client disconnect during transfer.

## Operations and tests

No schema migration is needed beyond Slice 4: existing testcase/job types cover this
flow. Deploy backend and runner images together because the version-1 protocol now
also permits `run_generator` and input artifact manifests.

The runner's `/work` tmpfs explicitly enables `exec` (Docker otherwise defaults to
`noexec`), remains `nosuid,nodev`, and is bounded to 768 MiB. `/tmp` remains noexec.
Only the root supervisor gains SYS_CHROOT and DAC_OVERRIDE in addition to Slice 4's
SETUID/SETGID/KILL: chroot setup and cleanup of generator-owned unreadable directories
require them. Compiler/generator children retain none of these capabilities.

Run the disposable integration stack in README. Important suites are
`authoringGeneratorRuntime`, `authoringJobs`, `authoringManualTestcases`,
`authoringTestcaseFiles`, `authoringTestcaseUploadService`, and Compose policy tests.
The existing local and production stacks are not automatically redeployed by tests.
