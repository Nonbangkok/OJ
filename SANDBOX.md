# Sandbox & Code-Execution Hardening (Security item A2)

This document records the hardening applied to the **code-execution path** — the
part of the WOI Grader that compiles and runs **untrusted, user-submitted C++**
— and outlines the recommended next step (an isolated judge container).

## Threat model

A submission is arbitrary attacker-controlled C++ that the backend compiles and
executes. Without isolation it runs **inside the backend container as root** and
therefore could:

- read backend secrets from the environment (`DATABASE_URL`, `PGPASSWORD`,
  `SECRET_KEY`) via `getenv()` and exfiltrate or use them;
- open a TCP connection to the Postgres container (same Docker network) and
  read/modify the database directly;
- exhaust host resources (memory, CPU, fork bombs, disk);
- run with root privileges inside the container.

## What is implemented now (this change)

Defence-in-depth across three layers. None of these require a full architecture
change, so they ship immediately.

### 1. Environment stripping for executed code
`backend/services/judgeService.ts` runs each testcase with
`env: { PATH: JUDGE_CONFIG.SANDBOX_PATH }` (`/usr/bin:/bin`). The compiled
binary no longer inherits `DATABASE_URL` / `PGPASSWORD` / `SECRET_KEY`, so it
cannot read them via `getenv()`. Only a minimal `PATH` is provided (needed for
the shell to locate `timeout`).

### 2. In-process resource limits + privilege drop
`backend/scripts/time_wrapper.c` (the per-run wrapper) now, in the child between
`fork()` and `execv()`:

- applies `setrlimit()` for:
  - `RLIMIT_AS`   — address space ≈ problem memory limit + slack (caps memory);
  - `RLIMIT_CPU`  — CPU-seconds hard backstop to the wall-clock `timeout`;
  - `RLIMIT_NPROC`— blocks fork bombs;
  - `RLIMIT_FSIZE`— caps file write size;
  - `RLIMIT_NOFILE`— caps open file descriptors;
- if running as root, **drops privileges** to the per-submission sandbox uid
  (passed as a fourth argv parameter; `nobody`/65534 remains the default when
  none is supplied) via `setgid()` → `setgroups(0, NULL)` → `setuid()`
  (correct order), and verifies the drop is irreversible.

The memory limit (MB), CPU-seconds and sandbox uid are passed as **positional
argv parameters** by `judgeService.ts`:
`timeout -k <grace>s <limit>s ./scripts/time_wrapper <exe> <mem_mb> <cpu_s> <uid>`.
The wrapper strips those values from the child's argv before `execv`, and
its `TIME_USED:.../MEM_USED:...` stderr line is unchanged so the judge parser
still works. The wrapper remains backwards-compatible with the legacy 1-arg
invocation (no limits applied).

### 3. Compile-step DoS guard
`backend/services/submissionService.ts` (`processSubmission` and
`processContestSubmission`) now pass `{ timeout, maxBuffer }`
(`JUDGE_CONFIG.COMPILE_TIMEOUT_MS` = 10s, `COMPILE_MAX_BUFFER` = 10MB) to the
`g++` invocation, so a compiler bomb cannot hang the judge worker forever or
flood memory with diagnostics. A timeout surfaces as a normal compile failure.

### 4. Container hardening (`docker-compose.yml`, `backend` service)
- `security_opt: ["no-new-privileges:true"]`
- `cap_drop: ["ALL"]`
- `pids_limit: 256` (cgroup-level fork-bomb containment)
- `mem_reservation: 512m`, `mem_limit: 1g`
- `init: true` (zombie/orphan reaping below pid 1 — npm is not an init)

## Phase 0 runner lockdown (security audit RUNNER findings)

The audit pass added the following layers on top of the items above.

### 5. Unprivileged, prlimit-capped, shell-less compile (RUNNER-001 / RUNNER-005)
g++ no longer runs as root or through a shell. The compile is executed via
`runBoundedChildProcess` (`backend/utils/sandboxProcess.ts`, mirroring the
authoring runner's `process.ts`): `spawn()` without a shell, dropped to a
per-submission sandbox uid (pool `60000..60015`, with a matching gid) when the backend
runs as root, wrapped in `prlimit --as --cpu --nproc --fsize --core=0`
(the authoring compiler recipe), env-stripped, with a hard wall-clock timeout
and output cap that SIGKILL the whole process group. A macro-include of
`/proc/1/environ` therefore fails: the sandboxed g++ cannot read root-only
files, and no secrets are in its environment to begin with. The include guard
(`compileGuard.ts`, `findIncludeRejection`) is hardened as a second layer.

- **It lexes like GCC.** The guard runs on preprocessing tokens from a lexer
  written to agree with libcpp (checked against g++ 14, `-std=c++20`):
  splices (a NUL between the backslash and the newline counts as
  whitespace), comments, string / character / raw-string literals, pp-numbers
  with digit separators, `%:` digraphs. An unterminated `'` or `"` makes the
  rest of its line one opaque token, as in GCC, so nothing after it on that
  line opens a comment or a raw string. Every operand of an `#include` /
  `#include_next` / `#import` line is lexed as a header name, as GCC does for
  the whole line. Wherever the two lexers could disagree about where a
  comment or literal starts, a submission could hide a directive from the
  guard that g++ still runs, so the guard rejects the constructs it cannot
  read the way GCC would in every context: a backslash outside literals
  (universal character names), a line splice inside a raw string, a
  malformed raw string (including delimiters g++ rejects, such as `$`), a
  prefix word glued to a literal (`"x"R"y(`, where GCC's reading depends on
  macros), and a `__has_include` operand that lexes differently when GCC
  does not evaluate it (a skipped block, a `#define` body).
- **What it rejects.** Absolute or `..` paths in the include family and in
  `__has_include` operands, in every header name on an include line (a macro
  in front can make any of them the operand), in macro bodies (path strings,
  including concatenated or escaped ones, and `<...>` path spans), on a
  computed include line itself (`#define LT <` + `#include LT/etc/passwd>`:
  any `/`, `..`, path literal or reserved identifier on the line, or a
  macro there whose body, followed through the macros it names, holds one),
  and in `#line` / line markers (g++ prints that file's lines as the caret
  context of later diagnostics). `#embed` is rejected outright.
- **What it does not do.** It is lexical, not a preprocessor, so it stays a
  best-effort layer and the unprivileged compile stays the boundary: a path
  assembled from macros of a system header whose names are not reserved is
  not seen, and `#pragma GCC dependency` can still test whether a path
  exists (it reads no content). Re-check the lexer before a GCC upgrade
  (`#embed` and `\u{...}` / `\N{...}` identifiers in particular).

It stays linear on hostile input. It runs on C++ submissions only: Python
has no preprocessor, and its `#` lines are comments.

### 6. Per-submission workspaces (RUNNER-003 / RUNNER-006) — ownership BY CONSTRUCTION
Every submission gets a private workspace under
`<os.tmpdir()>/oj-submissions/`, owned by its sandbox identity (uid = gid,
pool 60000..60015) with mode **0711** — owner full access, everyone else
traverse-only: a rival submission can *reach* a file by exact name but can
neither list the directory nor read the files (source 0600, binary 0750,
both identity-owned). The workspace is `rm -rf`'d in the pipeline's finally
block.

**Hotfix 2026-09 — why ownership is "by construction":** the lockdown
container runs with `cap_drop: ALL` + only `SETUID`/`SETGID`, so root inside
it has **no `CAP_CHOWN`** (and no `CAP_FOWNER`/`CAP_DAC_OVERRIDE` either).
The original Phase 0 flow — root creates the workspace with `mkdtemp`, writes
the source with `fs.writeFile`, then `chown`s both to the sandbox uid — broke
silently in production: both `chown` calls failed with `EPERM`, the failures
were swallowed by design ("unprivileged dev runs cannot chown"), the source
stayed root-owned at mode 0600, and the uid-dropped g++ died with
`cc1plus: fatal error: solution.cpp: Permission denied`. Every submission
returned Compilation Error. Unit tests never caught it because the dev path
(non-Linux / non-root) skips the uid-drop entirely.

The fix (see `backend/utils/sandboxProcess.ts`): when `canDropPrivileges()`
is true, **every workspace operation runs as a uid-dropped, bounded,
shell-less, env-stripped child** — so the sandbox identity owns its workspace
from the instant anything exists, and `chown` is never called:

| operation | mechanism |
|---|---|
| workspace create | uid-dropped `mktemp -d` (mode 0700), then uid-dropped `chmod 711` |
| source write | content piped on stdin to a uid-dropped `tee`, then uid-dropped `chmod 600` |
| artifact chmod | uid-dropped `chmod 750` (root cannot chmod uid-owned files — no `CAP_FOWNER`) |
| cleanup | uid-dropped `rm -rf` (root cannot remove uid-owned dirs — no `CAP_DAC_OVERRIDE`) |

The parent `<tmpdir>/oj-submissions` is root-owned at mode **1733**
(sticky + group/world write, no world read): sandbox uids can create their
own workspaces inside, cannot list each other's, and the sticky bit (as in
`/tmp` itself) stops one uid renaming another's workspace away.

This deliberately does **not** add `CAP_CHOWN` to the compose service: the
by-construction design needs no extra privilege and works regardless of the
container's capability set. (It was verified live in a production-caps
container via `backend/scripts/verifyHotfix.ts` — `node dist/scripts/verifyHotfix.js`.)

Because RLIMIT_NPROC is enforced **per uid**, concurrent submissions run
under *distinct* pool identities — the compile and all testcase runs of one
submission share one identity (passed from `submissionService` through
`judge()` into `time_wrapper` as a new argv parameter), while a concurrently
judged submission gets a different one. A submission forking toward its
process cap can no longer starve a concurrent legitimate submission (the old
behavior: everything ran as nobody/65534 and shared one NPROC budget of 64).

### 7. TLE SIGKILL escalation (RUNNER-004)
The judge's wall-clock command is now `timeout -k <grace>s <limit>s ...`
(KILL_GRACE_MS = 2s): after the limit GNU timeout sends SIGTERM, then SIGKILLs
a process that ignores it. A Node-side escalation timer
(`JUDGE_CONFIG.TIMEOUT_BUFFER_MS + KILL_GRACE_MS` after the limit) force-kills
the whole process group as a backstop, so a SIGTERM-ignoring sleeper can no
longer hold a judge slot (3 of which would stall all judging).

### 8. seccomp socket-deny in time_wrapper (RUNNER-002, partial)
`time_wrapper.c` now installs a seccomp filter (recipe copied from
`backend/authoring/sandbox.c`) that denies `socket`, `socketpair`, `unshare`,
`setns`, `ptrace`, and `mount` for the untrusted program. A submitted binary
can no longer TCP-connect to the database or any in-stack service from inside
the backend container, and cannot escape its identity through namespaces.
**Container-level follow-up (still open):** the seccomp layer denies socket
creation but not other network-adjacent behaviour (e.g. inherited fds), and it
does not bind the *compile* step. The full fix remains the dedicated
`network_mode: none` judge container sketched below — the minimal seccomp
mitigation was chosen for Phase 0 because moving compile+run into a separate
compose service (queue/transport, results plumbing) is an architectural change
that belongs to its own phase.

### Why the backend container still runs as root
See the long comment in `backend/Dockerfile`. In short: the per-submission
privilege drop in `time_wrapper.c` (root → nobody) only works if the parent
process starts as root, and the judge needs write/chmod access to root-owned
paths. Switching the whole container to `USER node` would neuter the per-run
privilege drop (CAP_SETUID is dropped) and break the compile/chmod chain.
Running each submission as `nobody` via the wrapper gives most of the benefit
without that breakage. Full `USER node` becomes safe once judging is isolated
(below).

## Header problems

A header problem's submission (`student.h`) is compiled in the same
translation unit as the problem's SECRET grader files (`problem_files`, role
`grader`), as the submission's sandbox uid. What is guaranteed, and what is
an accepted limit:

- **Grader sources are never readable by student code at assemble or run
  time.** The build has two steps (`HEADER_CPP_PREPARE`, `headerPreparePlan`
  in `submissionService.ts`): `g++ -S` compiles the grader sources with every
  file present; every grader file and the submitted header are then removed
  (as their owner — a failed removal is a System Error, never a run); only
  then are the `.s` files assembled and linked, and the `.s` files are removed
  before any testcase runs. Whatever a submission smuggles into the assembly
  (`.incbin "main.cpp"`, `.include`, through `asm`, a section attribute or
  anything else) finds no grader source or header and fails as a
  Compilation Error ("file not found"). The compile proper (cc1plus) is the
  only step that reads the grader sources. Re-check this before a GCC 15
  upgrade: `#embed` would read bytes at that step (the source rules below
  reject it).
- **The `.s` files are still there while the assembler runs.** Each source
  is assembled while every `.s` exists, so an injected `.incbin` can embed a
  translation unit's own `.s` or another grader source's. Those hold the
  compiled grader plus the symbol names `-s` strips from the binary (static
  and internal functions and globals, mangled with their parameter types).
  Against an assembler embed, `-s` is therefore best effort; what blocks the
  embed is the asm / section / `incbin` rule below (assembling each `.s` in
  a step of its own, with the others absent, would close it structurally).
- **Source rules, defence in depth** (`findHeaderSourceRejection` in
  `compileGuard.ts`, on the GCC-faithful lexer above): every lexical problem
  is rejected with a neutral message (the include guard's list plus
  undecodable escapes and an unterminated comment or literal at the end of
  the file); includes only as `<header>` (no `..`, `\`, leading `/`) or
  `"name"` naming one of the problem's public starter headers, no computed
  includes, no `#embed`; no
  `#define`/`#undef` of a C++ keyword or alternative token or of any
  identifier the grader uses (a student macro could otherwise stringize the
  grader's own code into a `static_assert` diagnostic); no function-like or
  non-empty `#define` of a reserved name; no `asm`, `section`/`weakref`/
  `symver` attributes, `#ident`/`#sccs`, `##` pasting, or `incbin`/`.include`
  in a string after concatenation and escape decoding. Rejection messages
  quote only the submission's own text.
- **For problem setters: a header students `#include "name"` must be in the
  starter set.** Quoted includes are limited to the starter headers (`.h` /
  `.hpp`, not the submission file) by secure default, even for a grader
  header the grader's own sources include: put every header the statement
  tells students to include into `starter/` (the bundled problems ship their
  `<ds>.h` there). A grader-only header students include by name makes every
  submission a Compilation Error.
- **The compiled grader runs inside the student's process.** Its machine
  code, data and string literals are in memory and in the binary the program
  can read (`/proc/self/exe`); `-s` only strips the symbol table. Graders
  must therefore not embed expected answers or secrets — expected outputs
  never enter the sandbox, which is what keeps verdicts trustworthy.
- **Diagnostics located in grader files may show grader expressions,
  identifiers, types and line numbers — not whole files or source lines**
  (accepted for now). `-fno-diagnostics-show-caret` stops g++ echoing source
  lines and `-fmax-errors=10` bounds the log, and the macro rules close the
  stringizing route (A8-03). But g++ quotes expressions on its own, with no
  macro involved: a submission can give a function the grader calls a type
  that makes the call fail (a `consteval` function, a return type with no
  matching operator), and the error at the grader's call site quotes the
  grader's expression, e.g. `call to consteval function
  'operator!=(solve(n, ((secret_k * 3) + 7)), ...)' is not a constant
  expression` or `no match for 'operator+=' in 'acc += solve(i, ...)'`. That
  is one expression per error and ten errors per submission, but repeatable,
  so a determined student can recover a grader's checks piece by piece.
  Hiding or genericising diagnostics located in grader files is an open
  owner decision; it would also cost students useful messages such as "no
  member named push".
- **Runtime Error output** is currently the program's own stderr (wrapper
  telemetry stripped), so a program can print anything it can read —
  including the compiled grader in its own memory — back through its
  verdict. Replacing it with a neutral crash description for header
  problems is a separate change (the runtime-stderr fix), not part of this
  build.

## Stretch / recommended next step: a dedicated `judge` container

Move all compilation and execution out of the API backend into a separate,
network-isolated container so that even a full in-container compromise yields
**no secrets and no DB reachability**.

### Sketch

```yaml
  judge:
    build:
      context: ./backend
      dockerfile: Dockerfile.judge   # node + g++ + time_wrapper, runs as non-root
    # No DATABASE_URL / PGPASSWORD / SECRET_KEY here — the judge needs none.
    network_mode: none               # cannot reach Postgres or the internet
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    pids_limit: 256
    mem_limit: 1g
    read_only: true                  # only a tmpfs scratch dir is writable
    tmpfs:
      - /work:size=256m,mode=1777
    # no `ports`, no DB network membership
```

### Wiring it up

1. **Queue/transport.** The backend enqueues a job (submission id, source code,
   problem limits, testcases) onto a broker — e.g. Redis (BullMQ), RabbitMQ, or
   a DB-backed `judge_jobs` table polled by the judge. The judge consumes a job,
   compiles + runs it on its tmpfs scratch dir, and returns the verdict (per
   testcase status/time/memory) back via the queue or a results endpoint.
2. **No DB on the judge.** Testcases are passed *in* the job payload (or fetched
   from a signed, scoped object-store URL); verdicts are returned to the backend
   which is the only component that writes to Postgres. The judge holds no DB
   credentials, so leaking its environment is harmless.
3. **`network_mode: none`.** With no network namespace connectivity, submitted
   code cannot reach the Postgres container or the internet even if it bypasses
   the in-process sandbox. This is the single biggest win.
4. **Non-root user in `Dockerfile.judge`.** Because the judge container is the
   isolation boundary (not the privilege drop), it can run entirely as an
   unprivileged user and own its scratch dir; the `time_wrapper` rlimits still
   apply as an inner layer.
5. **Horizontal scaling.** Multiple judge replicas can consume from the same
   queue for throughput; the API backend stays stateless w.r.t. judging.

### Migration notes
- `judgeService.ts` / `submissionService.ts` would split: the backend keeps the
  orchestration (status updates, result persistence) and ships the
  compile+execute logic to the judge worker image.
- Keep `time_wrapper.c` and its rlimits as the inner sandbox layer inside the
  judge container — isolation should be layered, not a single barrier.

Until that container exists, the layered mitigations above (env stripping,
rlimits, per-run privilege drop, compile guard, capability drop) substantially
reduce the blast radius of a malicious submission.
