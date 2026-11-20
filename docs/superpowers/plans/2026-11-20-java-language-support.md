# Java Language Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Goal:** Add `java` (Java 25) as a third submission language for standard problems.
- **Architecture:** The new language plugs into the existing per-language tables (`LANGUAGE_LIMITS`, `LANGUAGE_PREPARE`). Effective limits come from one function. Those tables gain:
  - a run-command factory, so the JVM heap flags can follow the problem's limit;
  - an optional extra run env;
  - a per-language compile cap;
  - a post-compile "require file" step;
  - a per-language OOM exit code.

  The JVM starts through a trusted launcher (`OjJavaLauncher`), compiled into the image.
- **Tech stack:** TypeScript (Express backend, React frontend), C wrapper (unchanged), OpenJDK 25 from Debian trixie apt, Jest, Docker Compose.
- **Spec:** `docs/superpowers/specs/2026-11-20-java-language-support-design.md`
- **Execution:** native (the user is asleep; the coordinator relayed "finish everything"). Branch `feat/java-support` in worktree `../OJ-java`.

## Global Constraints

- **Java limits:**
  - time = `limit × 2 + 500 ms`;
  - heap = `clamp(limit × 1, 16, 512)` MB;
  - RSS ceiling = heap + `JAVA_RSS_OVERHEAD_MB`;
  - RLIMIT_AS = heap + `JAVA_AS_GRACE_MB`;
  - OOM exit code 3 → MLE (Java only).
- **C++ and Python effective limits are unchanged:** time/memory multipliers 1/1 and 4/2, AS slack 32 MB.
- **Run paths:** run with `/usr/bin/java`. The source is `Main.java`, the output is `classes/`, and the launcher lives in `/opt/oj/java-launcher`.
- **Run env** is exactly `PATH`, `TMPDIR`, plus `MALLOC_ARENA_MAX=2` for Java. No `*JAVA*OPTIONS`.
- **Out of scope:**
  - no migration, no new npm dependency;
  - no Learn files;
  - no edits in the main `OJ` checkout or in CP-Author;
  - nothing outside the `oj-java*` compose projects; no prune; no `down -v` on shared stacks.
- **Commits:** the user is the sole author, with no `Co-Authored-By` trailer.

## Review Focus

1. **A program that busy-waits on several threads** must be TLE, not MLE: the CPU-cap SIGKILL fix. Covered by a unit test plus a container row.
2. **A C++ program that exits 3** must stay a Runtime Error: the OOM rule is Java-only. Unit test.
3. **A problem with a memory limit above 512 MB:** Java's heap is clamped to 512, and the UI shows the clamp. Unit test plus a frontend test.
4. **A file named `Solution`, or a `package` line,** gives a Compilation Error with the hint, never an RE on every case. Container rows.
5. **A Java source containing a C-style `#include` line** must not be rejected by the C++ include guard, because the guard is C++-only. Unit test.

---

### Task 1: Limits and prepare tables (backend constants)

**Files:**
- Modify: `backend/constants/index.ts`
- Test: `backend/tests/constants/languageLimits.test.ts`

**Interfaces (produces):**
- `SUPPORTED_LANGUAGES = ['cpp','python','java']`.
- `LANGUAGE_LIMITS[lang]: { timeMultiplier, timeOffsetMs, memoryMultiplier, rssOverheadMb, asSlackMb, memoryFloorMb?, memoryCeilingMb?, oomExitCode? }`.
- `effectiveLimits(language, timeLimitMs, memoryLimitMb): EffectiveLimits`, where `EffectiveLimits = { timeMs, memoryMb, rssLimitMb, asLimitMb }`.
- `RunnableCommand` gains `env?: Record<string,string>`.
- `LANGUAGE_PREPARE[lang]` gains `sourceName?`, `outputName?`, `compileLimits?: { asBytes, timeoutMs }`, `requiredArtifact?: { path, message }`, and `runCommand(path, limits: EffectiveLimits)`.
- `JAVA_MAIN_CLASS_HINT`, `JAVA_CONFIG` (paths, grace/overhead constants).

Steps:
- [ ] Tests:
  - cpp/python `effectiveLimits` equal the old values: cpp (1000 ms, 256 MB) gives `{timeMs:1000, memoryMb:256, rssLimitMb:256, asLimitMb:288}`; python gives `{4000, 512, 512, 544}`.
  - java (1000, 256) gives `{2500, 256, 256+overhead, 256+grace}`.
  - java (1000, 1024) gives memoryMb 512; java (1000, 4) gives memoryMb 16.
  - The java prepare entry: javac argv contains `-proc:none`, `-encoding UTF-8`, `-d classes`, `Main.java`.
  - The java run argv starts with the JVM flags, then `-cp /opt/oj/java-launcher:<dir>/classes OjJavaLauncher`, with `-Xmx256m` and `-Djava.io.tmpdir=<dir>`, and env `{MALLOC_ARENA_MAX:'2'}`.
- [ ] Run (fails), implement, run (passes), commit.

### Task 2: Judge verdict rules and limits plumbing

**Files:**
- Modify: `backend/services/judgeService.ts`
- Test: `backend/tests/services/judgeService.test.ts`

**Interfaces (consumes):** Task 1.
- `judge(problemId, runnable: RunnableCommand | ((limits: EffectiveLimits) => RunnableCommand), language, options)`.

Steps:
- [ ] Tests (mocked spawn, the existing harness style):
  - java exit 3 → MLE; cpp exit 3 → RE;
  - program SIGKILL with TIME_USED ≥ the CPU cap → TLE;
  - program SIGKILL with TIME_USED below the cap → MLE (unchanged);
  - the wrapper receives `asLimitMb`, and the RSS check uses `rssLimitMb`;
  - `runnable.env` is merged into the run env.
- [ ] Implement, run, commit.

### Task 3: Prepare plan (Main.java, classes/, require step, compile caps, CE hint)

**Files:**
- Modify: `backend/services/submissionService.ts`, `backend/utils/sandboxProcess.ts` (`prlimitWrap(command, args, caps?)`)
- Test: `backend/tests/services/submissionService.test.ts`, `backend/tests/utils/sandboxProcess.test.ts`

Steps:
- [ ] Tests:
  - the java plan writes `Main.java` and compiles with the Java compile caps;
  - the `require` step failing → CE with `JAVA_MAIN_CLASS_HINT`;
  - javac output containing "should be declared in a file named" → CE output ends with the hint;
  - `sanitizeCompilerStderr(..., 'java')` maps workspace paths to `Main.java`;
  - `prlimitWrap` with caps uses them.
- [ ] Implement, run, commit.

### Task 4: Launcher and Dockerfile

**Files:**
- Create: `backend/scripts/java/OjJavaLauncher.java`
- Modify: `backend/Dockerfile`

Steps:
- [ ] The launcher:
  - picks the entry point in JEP 512 order;
  - runs it on a thread `main` with a 256 MB stack;
  - on an uncaught exception prints `Exception in thread "main" ` plus the trace, then `System.exit(1)`;
  - a normal return falls through, so non-daemon threads keep the JVM alive;
  - prints the launcher's standard errors for a missing class or method.
- [ ] Dockerfile: a separate `RUN` installs `openjdk-25-jdk-headless`, then asserts `readlink -f /usr/bin/java` contains `java-25` and the same for `javac`. After `COPY backend/.`, compile the launcher into `/opt/oj/java-launcher` (root-owned, 0755 dir, 0644 files).
- [ ] Build the image: `docker compose -p oj-java-judge -f tests/authoring/compose.yml build judge-tests`.

### Task 5: Container test matrix + measurements

**Files:**
- Create: `backend/tests/integration/judgeJava.test.ts` (matches the `judge-tests` regex and is gated like `judgeRuntime.test.ts`)

Steps:
- [ ] One `it` per row of the spec's Testing table, asserting the verdict.
- [ ] Measure `VmPeak` and RSS for hello-world and for heap-full (a temporary test that logs telemetry). Set `JAVA_AS_GRACE_MB` / `JAVA_RSS_OVERHEAD_MB` and the Java compile AS/timeout. Record the numbers in comments.
- [ ] Run `docker compose -p oj-java-judge -f tests/authoring/compose.yml --profile judge run --rm judge-tests` until it is green. Also run the full `tests` service suite (`up --abort-on-container-exit --exit-code-from tests`). Commit.

### Task 6: Frontend

**Files:**
- Modify: `frontend/src/utils/constants.ts`, `types/service.ts`, `hooks/useCodeSubmission.ts`, `hooks/useSubmissionModal.ts`, `pages/submission/SubmissionDetailPage.tsx`, the submission form and limit display (wherever `LANGUAGE_LIMITS` is read), plus tests next to the existing ones.

Steps:
- [ ] Tests:
  - the java label is "Java 25";
  - effective limits show 2.5 s / 256 MB for a 1 s / 256 MB problem, and a 512 MB clamp;
  - `.java` upload detection;
  - the Java template appears when switching to Java with an empty editor.
- [ ] Implement, `npm run validate`, `npm run build`, commit.

### Task 7: Docs

- [ ] Docs: `SANDBOX.md` Java section; `CLAUDE.md` Overview plus Judging pipeline (including `MAX_CONCURRENT_JUDGES: 1`); `.context/*` language mentions. Commit.

### Task 8: Review, push, PR

- [ ] Run `code-review` at high on the branch diff, fix the findings, then re-run the backend `npm test` + `npm run build`, the frontend `npm run validate` + `npm run build`, and the judge container suite.
- [ ] Push `feat/java-support` and open a PR whose description has the matrix, the builder calls and the deploy note. Watch CI until green.
