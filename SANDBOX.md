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
`env: { PATH: JUDGE_CONFIG.SANDBOX_PATH, TMPDIR: <workspace> }` (`PATH` is
`/usr/bin:/bin`). The compiled binary no longer inherits `DATABASE_URL` /
`PGPASSWORD` / `SECRET_KEY`, so it cannot read them via `getenv()`. Only a
minimal `PATH` (to locate `timeout`) and `TMPDIR` (the submission's own
workspace, see section 6) are provided.

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
`timeout -k <grace>s <limit>s ./scripts/time_wrapper <exe> <mem_mb> <cpu_s> <uid>`,
spawned without a shell. The wrapper strips those values from the child's
argv before `execv`. The wrapper remains backwards-compatible with the legacy
1-arg invocation (no limits applied).

**Telemetry on its own fd (A4-04).** The wrapper reports
`TIME_USED:<user>+<sys> MEM_USED:<kb>` on fd 3, a fourth pipe the judge opens
for it. The fd is close-on-exec and closed in the child before `execv`, so
the program never has it, and the judge parses time and memory from fd 3
only. Stderr is shared with the program: when the figures came from there, a
program could print `MEM_USED:1` first and turn a Memory Limit Exceeded into
an Accepted. A missing report still means the wrapper was killed (timeout
evidence). Without fd 3 (a manual run) the line goes to stderr as before.

**Runtime Error output (A9-04).** The judge keeps at most 64 KiB of a run's
stderr in memory and drains the rest. The stored Runtime Error text has
telemetry look-alikes, NUL bytes and the workspace path removed (a Python
traceback names `solution.py`, not `/tmp/oj-submissions/<id>/solution.py`) and
is capped at 4 KiB with a `[truncated N bytes]` marker
(`formatRuntimeErrorOutput`). On **header problems** the grader is compiled
into the student's process, which can read the grader's code and string
literals from its own memory or `/proc/self/exe`. Program stderr is therefore
never stored for them, only a neutral description such as
`Program terminated by signal SIGABRT` (this also drops the UBSan line there).
Narrow channels remain (per-case verdict, time, memory), so a grader must
still never embed answers or other secrets.

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
(`compileGuard.ts`) is hardened as a second layer — it now rejects macro
includes (`#define E "/proc/1/environ"` + `#include E`), string-concatenated
paths, and backslash-newline-continuation-hidden paths.

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

**Judged code writes only inside its workspace (A9-05, A9-02 pre-claim).**
The backend image sets `/tmp`, `/var/tmp` and `/run/lock` to **1755** (root,
their owner, still writes there; sandbox uids cannot) and creates
`/tmp/oj-submissions` root-owned at 1733 at build time. A judged program can
therefore neither fill the disk outside its workspace nor create a path the
backend later trusts (such as `/tmp/oj_uploads`). The compile and every run
get `TMPDIR=<workspace>` (g++, `py_compile` and Python's `tempfile` honour it;
glibc `tmpfile()` ignores `TMPDIR` and now fails for judged programs).
`ensureSandboxSubmissionsRoot` refuses a submissions root it does not own.
What a uid can still write outside its workspace (siblings in the 1733 root,
`/dev/shm`, `/dev/mqueue`, which are runtime mounts) is removed after each
submission: root lists those directories and a uid-dropped `rm -rf` deletes
every top-level entry the uid owns (`removeSandboxStrays`). Disk use inside
the workspace is still bounded only per file (`RLIMIT_FSIZE`) and by the time
limit, until the workspace is removed.

Because RLIMIT_NPROC is enforced **per uid**, concurrent submissions run
under *distinct* pool identities — the compile and all testcase runs of one
submission share one identity (passed from `submissionService` through
`judge()` into `time_wrapper` as a new argv parameter), while a concurrently
judged submission gets a different one. A submission forking toward its
process cap can no longer starve a concurrent legitimate submission (the old
behavior: everything ran as nobody/65534 and shared one NPROC budget of 64).

### 7. TLE SIGKILL escalation (RUNNER-004) and the per-uid sweep (A4-02)
The judge's wall-clock command is now `timeout -k <grace>s <limit>s ...`
(KILL_GRACE_MS = 2s): after the limit GNU timeout sends SIGTERM, then SIGKILLs
a process that ignores it. A Node-side escalation timer
(`JUDGE_CONFIG.TIMEOUT_BUFFER_MS + KILL_GRACE_MS` after the limit) force-kills
the whole process group as a backstop, so a SIGTERM-ignoring sleeper can no
longer hold a judge slot (3 of which would stall all judging).

Those kills only reach root's own processes. In production root has no
`CAP_KILL`, so neither `timeout` nor Node can signal the sandbox uid: a
sleeping TLE program, or a `setsid`'d daemon with its stdio closed, outlived
its submission, came back with the same uid 16 pipelines later, and could read
or tamper with that later submission's workspace (including a header
problem's grader during the compile). Now `time_wrapper --kill-uid <uid>`
drops to the uid and calls `kill(-1, SIGKILL)`, which from uid X reaches
exactly X's processes and needs no capability, and repeats until
`/proc/<pid>/status` shows no live process with that uid (bounded, about a
second; a "zombie" whose `Threads:` count is above 1 still has running
threads and counts as live). It runs (`killSandboxProcesses`) before an identity is handed out,
after the compile, after every testcase (which also releases stdio pipes an
orphan still holds) and in the pipeline's `finally` before the workspace is
removed. It fails closed: a sweep that cannot run or leaves processes makes
the submission a System Error, and the uid is quarantined until a later sweep
passes. `acquireSandboxIdentity` also never hands an identity to a second live
pipeline. The helper refuses to run unless started as root, so a dev run
cannot kill the developer's own processes. Memory is still accounted per
process (`RLIMIT_AS`, `wait4` peak RSS), so forked workers can together use
more than the limit (A9-06, open by owner decision).

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
