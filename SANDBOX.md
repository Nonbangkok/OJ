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
- if running as root, **drops privileges** to `nobody` (uid/gid `65534`) via
  `setgid()` → `setgroups(0, NULL)` → `setuid()` (correct order), and verifies
  the drop is irreversible.

The memory limit (MB) and CPU-seconds are passed as **new positional argv
parameters** by `judgeService.ts`:
`timeout <s>s ./scripts/time_wrapper <exe> <mem_mb> <cpu_s>`.
The wrapper strips those two values from the child's argv before `execv`, and
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
