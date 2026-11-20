# Java Language Support — Design

Date: 2026-11-20.
Status: approved 2026-11-20. The user made decisions 0–8 in chat and answered the builder-check questions: keep `MAX_CONCURRENT_JUDGES = 1` (practice is the main use), clamp the Java heap at 512 MB, use Java 25. Work happens on branch `feat/java-support` (worktree `../OJ-java`, cut from `origin/main`). Items marked **(builder's call)** or **(Claude's call)** are open to review.

## Intent

Let students who are **learning Java** submit Java solutions to ordinary problems. This audience shapes the trade-offs:

- Compile errors and verdicts have to be understandable to a beginner.
- The usual classroom style (a `Scanner`, a `public class Main`) has to just work.
- Raw performance parity with C++ is a non-goal. We do not promise that every problem is solvable in Java within its time limit.

## Goals

- `java` becomes a third submission language next to `cpp` and `python`. It works for standard (`problem_type = 'standard'`) problems in practice mode and in contests.
- The sandbox guarantees stay the same as for C++/Python. These are listed in `SANDBOX.md`:
  - uid drop;
  - seccomp: no sockets, thread-only `clone`;
  - stripped env;
  - private workspace;
  - evidence-based verdicts;
  - a kernel memory backstop.
- Out of memory shows up as **Memory Limit Exceeded**. Too slow shows up as **TLE**. A crash shows up as **Runtime Error** with the Java stack trace.

## Non-goals

- **Header problems.** They stay C++ only. The existing `assertHeaderSubmitAllowed` (`backend/services/submissionQueryService.ts:23`) already 400s non-C++. The grader-scrub model (delete sources before the assembler runs) does not translate to Java.
- **Authoring.** Java reference solutions in the authoring sandbox (`authoring-runner`) are out of scope. So is Java support in the CP-Author `header-problems` harness. `harness.py` needs no change.
- **Per-problem Java limits.** Limits are derived from the problem's single limits (below).
- **cgroup-based memory accounting.** Deferred. The container runs `cap_drop: ALL` + SETUID/SETGID only, so per-run cgroups would mean a new judge container.

## Anti-goals (a failure even if it "works")

- A Java run can push the backend container past `mem_limit: 1g` and get the Node process OOM-killed.
- A Java run can escape the uid/seccomp sandbox, read another submission's workspace, or reach the network.
- An over-limit program is reported as Accepted, because Java needs a looser `RLIMIT_AS`.
- The JVM fails to start under normal limits, so every submission becomes a Runtime Error or System Error.

## Current state (what the change touches)

**Languages**
- `SUPPORTED_LANGUAGES = ['cpp', 'python']`, `LANGUAGE_LIMITS` (multipliers only) and `LANGUAGE_PREPARE` (source extension, check command, run command, artifact path) are in `backend/constants/index.ts:338-420`.
- The frontend mirrors these in `frontend/src/utils/constants.ts:48-122` and `frontend/src/types/service.ts:27`.
- `submissions.language` is `VARCHAR(20)` with no CHECK constraint (migrations 0001/0002), so **no migration is needed**.
- `submitSchema.language` is `z.enum(SUPPORTED_LANGUAGES)` (`backend/schemas/requestSchemas.ts:611`).

**Prepare and judge**
- `standardPreparePlan` (`backend/services/submissionService.ts:214`) writes `solution<ext>`, runs one compile step and hands `runCommand` the artifact or source path.
- Compiles run through `prlimitWrap` (`backend/utils/sandboxProcess.ts:278`) with:
  - `--as=768 MiB` (`COMPILE_AS_LIMIT_BYTES`);
  - `--nproc=128`;
  - `--cpu = ceil(COMPILE_TIMEOUT_MS/1000)+1`, where `COMPILE_TIMEOUT_MS` is 10 s.
- `judgeService.judge` computes the effective limits:
  - `effectiveTimeMs = time_limit_ms × timeMultiplier`;
  - `effectiveMemoryMb = memory_limit_mb × memoryMultiplier` (`backend/services/judgeService.ts:431`).
- `runSingleCase` passes `RLIMIT_AS = effectiveMemoryMb + MEMORY_LIMIT_SLACK_MB (32)` to `time_wrapper`. MLE is decided by `peak RSS > effectiveMemoryMb` or a SIGKILL of the program (`judgeService.ts:141, 270-282`).

**`time_wrapper.c`**
- Sets `RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_NPROC = 64` (per uid, and this counts **threads**), `RLIMIT_FSIZE` and `RLIMIT_NOFILE = 64`.
- Installs a seccomp filter that denies `socket`, `socketpair`, `unshare`, `setns`, `ptrace`, `mount`, SysV IPC creation, `fork`, `vfork` and non-thread `clone`. `clone3` returns ENOSYS.

**Container and production**
- Container limits (`docker-compose.yml`): `mem_limit: 1g`, `pids_limit: 256`.
- Production host, measured 2026-11-20:
  - 2 vCPU (i9-9900K), 3.8 GiB RAM, about 2.4 GiB available;
  - the backend container uses about 168 MiB at idle;
  - the disk is an HDD.
- `JUDGE_CONFIG.MAX_CONCURRENT_JUDGES` is **1**. CLAUDE.md says 3, which is stale and should be fixed with this change. So only one JVM judge runs at a time.
- Debian trixie ships `openjdk-21-jdk-headless` (21.0.13) and `openjdk-25-jdk-headless` (25.0.5). Both get security updates. Checked on packages.debian.org on 2026-11-20.

## Decisions

Each decision lists the options considered and the one chosen.

### 0. Audience: students learning Java (user)
This drives decision 7 (keep `Main`, friendly hints) and decision 3: a generous time allowance is preferred over strict parity.

### 1. Memory enforcement: `RLIMIT_AS` = heap + a fixed grace, plus JVM flags (user: option A)
- **Rejected: B, no `RLIMIT_AS`, only `-Xmx`.** Native memory (thread stacks, malloc arenas, direct buffers) would have no ceiling. That threatens the 1 GiB container (anti-goal 1).
- **Rejected: C, cgroup v2 per run.** The most precise option, but it needs capabilities the container deliberately drops.
- **Chosen: A.** Java gets `RLIMIT_AS = heapMb + JAVA_AS_GRACE_MB`.
  - The JVM reserves far more address space than it touches: the heap reservation, the class space, the code cache, the `lib/modules` mmap, a CDS archive, and per-thread stacks and arenas. A plain `limit + 32` makes it fail at startup.
  - The kernel backstop stays. RSS is then bounded by the JVM flags below and judged by the existing peak-RSS MLE check.
  - **`JAVA_AS_GRACE_MB`: start at 1024 (builder's call).** Measure the peak `VmPeak` of (a) hello-world and (b) a program that fills its heap, under the final flag set, then choose the smallest round value with comfortable margin. Document the measurement in a comment.

### 2. OOM verdict: `-XX:+ExitOnOutOfMemoryError` → MLE (user: option A)
- The JVM exits with a fixed status on any `OutOfMemoryError`. HotSpot uses **3**. The builder verifies this on the chosen JDK and puts it in a constant, `JAVA_OOM_EXIT_CODE`.
- For `language === 'java'` only, that exit status counts as MLE evidence, in the same branch as the RSS check. For C++/Python an exit 3 stays a Runtime Error.
- **Accepted consequences.** Document both in `SANDBOX.md`:
  - A program that calls `System.exit(3)` is reported as MLE. The evidence-based policy exists so that nobody can forge a **better** verdict. Forging a worse one only hurts the submitter.
  - "unable to create native thread" is also an `OutOfMemoryError`. It too becomes MLE, which is a fair description of exhausting the thread budget.
- **Rejected: classify OOM as RE.** It confuses beginners.
- **Rejected: match `OutOfMemoryError` in stderr.** It violates the no-stderr-heuristics rule and stderr is forgeable.

### 3. Limits for Java: multiplier + offset (user: as recommended)
- **Time.** `effectiveTimeMs = time_limit_ms × 2 + 500`. It covers JVM startup (about 50–150 ms) and JIT warm-up. A multiplier alone would starve 0.5 s problems.
- **Memory**, three numbers:
  - **heap** (`-Xmx`) = `memory_limit_mb × 1`;
  - **RSS ceiling** for the MLE check = `heap + JAVA_RSS_OVERHEAD_MB`;
  - **RLIMIT_AS** = `heap + JAVA_AS_GRACE_MB` (decision 1).

  The JVM's overhead is roughly constant (about 40–60 MB), so the allowance is a fixed amount, not ×2.
  - **`JAVA_RSS_OVERHEAD_MB`: start at 64 (builder's call).** Validate it: a program that legitimately fills about 95% of its heap must stay under the ceiling. Raise the value if the measurement says so.
- **Heap clamps (Claude's call):**
  - **Floor:** `heap = max(limit, 16)`, so a tiny limit does not stop the JVM from starting.
  - **Ceiling: 512 MB.** Its RSS (about 512 + 64) plus the idle Node process (about 170 MB) and slack stays under the 1 GiB container. A problem with a limit above 512 MB gets a 512 MB Java heap, and the UI shows the effective value.
  - Alternative the user may prefer: raise the backend `mem_limit` (the host has about 2.4 GiB free) and lift the clamp.
- **Shape of `LANGUAGE_LIMITS`.** Generalize it to `{ timeMultiplier, timeOffsetMs, memoryMultiplier, rssOverheadMb, asSlackMb, maxMemoryMb? }`.
  - C++/Python keep their current behaviour: offset 0, overhead 0, AS slack = the existing `MEMORY_LIMIT_SLACK_MB`.
  - Mirror the shape in `frontend/src/utils/constants.ts` so the displayed effective limits stay right.
  - The exact field names are the builder's call.

### 4. Scope: submissions to standard problems only (user: option A)
Covered: submit, judge, rejudge (batch rejudge reuses the same pipeline), contest submissions, the submission views, and the scoreboard.

Not covered: header problems (already rejected at submit), authoring, CP-Author, and Learn lesson content. Highlighting `java` in Learn code tabs (`features/learn/lessonHtml.ts`) is a **follow-up after the lessons PR merges**. Learn is not on `main` yet and its files belong to the lessons work (coordinator agreement, 2026-11-20).

### 5. Concurrency (user: as recommended → revised by finding)
- The recommendation was a weighted queue (Java = 2 slots). **`MAX_CONCURRENT_JUDGES` is 1**, so no weighting is needed now. Only one JVM ever runs.
- The thread-limiting flags (decision 6) stay, because `RLIMIT_NPROC = 64` and `pids_limit = 256` count threads.
- If concurrency is ever raised, revisit the weighting together with the heap ceiling. Leave a comment next to `MAX_CONCURRENT_JUDGES`.

### 6. JIT and GC flags (user: as recommended)
Full tiered compilation (C1 + C2) with a bounded thread count:

```
-XX:+UseSerialGC -XX:ActiveProcessorCount=1 -XX:CICompilerCount=2
-XX:-UsePerfData -XX:+DisableAttachMechanism -XX:+ExitOnOutOfMemoryError
-Xmx<heap>m -Xms<min(heap,32)>m
-XX:MaxMetaspaceSize=64m -XX:CompressedClassSpaceSize=32m
-XX:ReservedCodeCacheSize=48m -XX:MaxDirectMemorySize=16m
-Djava.io.tmpdir=<workspace> -XX:ErrorFile=<workspace>/hs_err.log
```

**Stack size: a big stack for the student's main thread only (Claude's call, from the builder check).**
- **Do not use `-Xss64m`.** `-Xss` applies to every `java.lang.Thread`. That includes the JVM's own Java-level threads (Reference Handler, Finalizer, Signal Dispatcher, Common-Cleaner and others) and every student thread. Each reserves 64 MB of address space against `RLIMIT_AS`, so the AS grace would have to grow by about 64 MB per thread. That weakens the backstop and caps student threads at roughly ten.
- **Instead**, keep the default `-Xss` (1 MB) and start the program through a tiny trusted launcher class, `OjJavaLauncher`.
  - It is compiled at image build time into a root-owned, read-only directory, for example `/opt/oj/java-launcher`, and goes on the classpath before `classes/`.
  - It runs the student's entry point on a new thread named `main` with a 256 MB stack (`new Thread(null, runnable, "main", 256L << 20)`). It joins that thread and exits with the JVM's usual semantics: an uncaught exception prints the stack trace and exits 1, and `System.exit` passes through.
  - It picks the entry point the way the JDK 25 launcher does (JEP 512). That is `static void main(String[])` first, then the other `main` forms, including instance `main()` for compact source files, via reflection.
  - Stack traces gain one or two launcher frames at the bottom, which is acceptable.
  - The exact size (256 MB) is the builder's call. It must make the deep-recursion row in Testing pass.
- **Result.** Address space per extra thread drops to about 1 MB. Threads are then bounded by `RLIMIT_NPROC = 64` (about 15 for the JVM, the rest for the student). A program that starts a 16-thread executor works.

- **`-XX:-UsePerfData`**: `/tmp` is mode 1755, so `hsperfdata` cannot be written there.
- **`-XX:+DisableAttachMechanism`**: no attach listener, so there is never a Unix socket. seccomp would deny it anyway.
- **`-Djava.io.tmpdir`**: Java ignores `TMPDIR`.
- **The launcher's 256 MB main-thread stack** (above) handles deep recursion, which beginners write a lot.
- **The JVM thread count stays at about 15**, so student threads still fit under 64.
- **Run env** = the existing `PATH` + `TMPDIR`, plus `MALLOC_ARENA_MAX=2` to keep glibc arenas from inflating address space. Do not pass `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS` or `JDK_JAVA_OPTIONS`. The env is already allow-list built, so add a test that asserts their absence.
- **Exact values are the builder's call** (for example the code cache size, or `-Xms`). Requirements: every flag is accepted by the chosen JDK (`java -XX:+PrintFlagsFinal -version` under the flags), and the measurements in decisions 1 and 3 pass.
- **CPU time.** `TIME_USED` includes JIT/GC thread CPU. That is acceptable, since it is covered by ×2 + 0.5 s.

**The CPU backstop is reported as MLE: fix it in this change (Claude's call, from the builder check).**
- **The bug.** `time_wrapper.c:183-186` sets `RLIMIT_CPU` with soft = hard, so at the cap the kernel sends **SIGKILL**, not SIGXCPU.
  - `judgeService.ts:258` maps only SIGXCPU to TLE. The SIGKILL falls through to the MLE branch (`judgeService.ts:270`).
  - The cap is `ceil(effectiveTimeMs/1000) + CPU_LIMIT_SLACK_S` (`judgeService.ts:142`). A run whose total CPU across threads reaches it before the wall clock does is reported as **Memory Limit Exceeded**.
  - This already affects multi-threaded C++. The JVM's JIT and GC threads on a second vCPU make it likely for Java.
- **The fix.** Classify the program's SIGKILL as TLE when there is CPU evidence: the wrapper's `TIME_USED` (fd 3) is ≥ the CPU cap minus a small tolerance, and the peak RSS is within the limit. Every other SIGKILL stays MLE.
  - Alternatively, set the soft limit one second below the hard one, so the program gets SIGXCPU first. The builder picks either; both must be covered by a test.
  - This changes C++/Python behaviour only in the mislabelled case.

### 7. Entry point: require class `Main` (user)
- The source is always written as **`Main.java`**, not `solution.java`. The `LANGUAGE_PREPARE` recipe needs a per-language source *file name*, not just an extension.
- **Compile:** `javac -proc:none -encoding UTF-8 -d classes Main.java`, plus JVM flags for javac itself (`-J-Xmx256m -J-XX:+UseSerialGC -J-XX:ActiveProcessorCount=1 -J-XX:TieredStopAtLevel=1 -J-XX:-UsePerfData`).
- **After a successful compile**, if `classes/Main.class` does not exist (for example because of a `package` declaration or no class named `Main`), the result is a **Compilation Error** with a fixed hint:

  > Java submissions must contain a top-level class named `Main` and no `package` declaration.

- **When javac fails with "class X is public, should be declared in a file named X.java"**, the same hint is appended after javac's output. The exact matching is the builder's call. It is a hint only; the verdict is already CE.
- **Java 25 compact source files work for free.** `void main() { IO.println(...); }` in `Main.java` compiles to an implicit class `Main`. This is a reason to pick 25 (decision 8). Include it in a test.
- **Run:** `/usr/lib/jvm/java-25-openjdk-amd64/bin/java <flags> -cp <workspace>/classes Main`. Use an absolute path, because `time_wrapper` uses `execv` with no PATH lookup. The Dockerfile asserts the path, as it does for `/usr/bin/python3`.
  - The artifact is a directory (`Main.class` plus `Main$1.class` and others). The prepare plan's artifact handling (chmod, scrub) must cope with a directory of class files.
  - The run itself must not need write access to `classes/`.
  - The builder decides how, for example a recursive chmod as the sandbox uid or keeping the dir read-only.
- **Sanitize.** `SANITIZED_SOURCE_NAME.java = 'Main.java'`. javac diagnostics carry the workspace path, which must be rewritten as for C++. Runtime stack traces go through the existing workspace-path scrub and the 4 KiB cap.
- **No-`main` case.** A missing `main` method makes the launcher exit 1 with "Main method not found", so the verdict is RE on every case. That is acceptable, because the message explains itself.

### 8. JDK source and version (user: as recommended = Debian apt, LTS)
- **Install** `openjdk-25-jdk-headless` from trixie apt in `backend/Dockerfile`, as its own `RUN` layer. Assert `javac`/`java` at the absolute path and print `java -version` in the build log.
- **Why 25 over 21 (Claude's call):** both are LTS with security updates in trixie, and 25 adds compact source files and `IO.println`, which helps beginners. The UI labels the language **"Java 25"**.
- **Build cost:**
  - The image grows by roughly 200–300 MB.
  - Changing the Dockerfile invalidates every later layer, including `npm ci`, so the first CD deploy after this rebuilds those layers on the HDD.
  - The builder measures the uncached backend build locally and notes it in the PR. The CD job cap is 120 min (#28); the authoring-runner image is unaffected.
- **Do not prune the prod build cache around this deploy** (see the CD runbook).

## Sandbox review checklist (what must stay true)

**seccomp**
- No change to the filter.
- The JVM uses `pthread_create`. glibc tries `clone3`, gets ENOSYS and falls back to `clone` with `CLONE_THREAD`, which the filter allows.
- `ProcessBuilder` and `Runtime.exec` use `posix_spawn`/`vfork` through `jspawnhelper` and must fail (an IOException, so RE).
- No socket is opened at startup (attach is disabled).

**Files**
- The JVM reads `/usr/lib/jvm/**`, `/proc/self/**` and `/sys/fs/cgroup/**` for container detection. All are world-readable, so nothing new is granted.
- Writes go only to the workspace (`java.io.tmpdir`, `ErrorFile`).

**Other**
- **JNI.** `System.load` of a file the program wrote is native code under the same uid and seccomp filter. It is not an escalation, so no Security Manager is needed. The Security Manager is gone in JDK 24+, so do not rely on it.
- **Sweeps** (`--kill-uid`, `removeSandboxStrays`) apply unchanged. The JVM's threads are threads of one process of the identity.
- **The compile** runs as the sandbox identity under `prlimit`.
  - javac is a JVM, so it needs a Java-specific `--as` (about javac heap + `JAVA_AS_GRACE_MB`) and possibly a longer `COMPILE_TIMEOUT_MS` for Java. Measure a cold javac on the 2-vCPU prod-like setup; a cold start on HDD is the worst case.
  - Make the per-language compile limits explicit constants rather than raising the shared ones.

## Frontend

- **Language list and types.** Add `java` to `SUPPORTED_LANGUAGES` / `LANGUAGE_DISPLAY_NAMES` (`'Java 25'`, `frontend/src/utils/constants.ts:53`) / the `LANGUAGE_LIMITS` mirror in `frontend/src/utils/constants.ts`, and to `types/service.ts`. (`LANGUAGE_LABELS` is a separate map in Learn's `lessonHtml.ts`, which is not on `main` and is out of scope here.)
- **Submit form.** Add a Java option. The `LANGUAGES` list in `hooks/useCodeSubmission.ts:25` becomes language-agnostic or includes `java`. File-upload detection gets `.java` (`useCodeSubmission.ts:188`).
- **Default template** for Java when the editor is empty (Claude's call): a `public class Main` with `Scanner` input, which is what classes teach. Add a one-line comment pointing to `BufferedReader` for large input. Follow whatever template mechanism the form already uses; if there is none, the builder decides whether to add a minimal one.
- **Syntax highlighting.** Register highlight.js `java` where `python` is registered: `useCodeSubmission.ts`, `useSubmissionModal.ts`, `SubmissionDetailPage.tsx` (Learn's `lessonHtml.ts` is a follow-up, see Scope). Also add it to the authoring `CodeEditor` if it keys on submission languages (builder checks).
- **Limits display.** Wherever the per-language limits are shown, Java shows its derived values (for example "Time: 2.5 s · Memory: 256 MB heap").

## Docs to update

- **`SANDBOX.md`:** the Java section, covering the AS grace rationale, the exit-3 MLE rule and why forging it is harmless, the flag list, and the reason for each flag.
- **`CLAUDE.md`:** languages are C++, Python and Java. Add the Java compile/run line to "Judging pipeline". Fix `MAX_CONCURRENT_JUDGES` (it is 1). Note that Java is excluded from header problems.
- **`.context/` docs** that enumerate languages (`API_SCHEMA.md`, `ARCHITECTURE.md`): the builder greps for `python` and updates them.

## Testing

**Unit (backend `npm test`)**
- The `LANGUAGE_PREPARE.java` recipe: file name `Main.java`, the javac argv, the run argv and its flags.
- The effective-limit math, including the floor and the ceiling clamp. C++/Python are unchanged; assert their old values.
- Verdict mapping:
  - exit 3 → MLE for `java`, but RE for `cpp`/`python`;
  - RSS over the Java ceiling → MLE.
- Missing `Main.class` → CE with the hint. The "should be declared in a file named" output gets the hint appended.
- `submitSchema` accepts `java`, and a header problem rejects `java` with 400.
- The sandbox env for Java contains no `*JAVA*OPTIONS`.

**Container-level (Linux, real `time_wrapper`: seccomp and rlimits are skipped on macOS, so these must run in the backend image)**

| Program | Expected |
|---|---|
| hello world, plain `Scanner` A+B | AC |
| a compact source file (`void main()`) | AC |
| allocate past the heap | MLE |
| infinite loop | TLE (also when the CPU cap fires first) |
| a CPU-bound loop that spawns 4 busy threads | TLE, not MLE |
| a 16-thread executor | AC |
| deep recursion (about 10⁵ frames) | AC on the launcher's main thread |
| unbounded recursion | RE (StackOverflowError trace) |
| `new ProcessBuilder("ls").start()` | RE |
| `new Socket(...)` | RE |
| create 200 threads | MLE (native-thread OOM) or RE, deterministic and documented |
| write to `/tmp/x` | fails |
| write to `java.io.tmpdir` | succeeds |
| `System.exit(3)` | MLE (documented) |
| `public class Solution` | CE with the hint |
| `package foo;` | CE with the hint |

- The `JAVA_AS_GRACE_MB` / `JAVA_RSS_OVERHEAD_MB` measurements from decisions 1 and 3, recorded in the constants' comments.

**Frontend (`npm run validate`)**
- The language selector and the `.java` upload detection.
- The limits display for Java.

## Left to the builder

- Final values of `JAVA_AS_GRACE_MB`, `JAVA_RSS_OVERHEAD_MB`, the Java compile AS/timeout, and the code-cache size, all from measurement.
- Field names of the generalized `LANGUAGE_LIMITS`, and how the prepare plan handles a directory artifact.
- The exact matching for the javac public-class hint.
- Whether `similarityService` needs language-awareness. Today it is language-agnostic, and comparing a Java source with a C++ source is harmless noise.
- Splitting into PRs. Suggested order:
  1. Backend judge and Dockerfile, with container tests.
  2. Frontend.
  3. Docs.

## Calls made without the user (check these)

1. **Java 25** rather than 21.
2. **Heap ceiling of 512 MB** rather than raising the backend `mem_limit`.
3. **Heap floor of 16 MB.**
4. **`MALLOC_ARENA_MAX=2`** in the Java run env.
5. **A `Scanner`-based default template.**
6. **Learn highlight.js registration** for `java` is moved to a follow-up after the lessons PR merges.
7. **No queue weighting**, because concurrency is 1.
8. **A trusted `OjJavaLauncher`** with a 256 MB main-thread stack instead of `-Xss64m`.
9. **The CPU-backstop SIGKILL fix** (TLE instead of MLE) is part of this change.
