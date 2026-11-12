# Upgrade Step 2 — Judge Toolchain on Debian trixie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the backend/judge image from Debian bookworm to trixie so submissions compile with g++ 14 and run on Python 3.13, with the judge's verdict semantics proven unchanged by a real end-to-end test.

**Architecture:** First add an integration test that drives the real pipeline (`processSubmission` → sandboxed compile → `time_wrapper` run → verdict) inside the backend image, and prove it passes on today's bookworm image. Then switch the base image to `node:26-trixie-slim`, derive the Postgres apt codename from the image, and require the same test to pass on trixie, plus a toolchain-version assertion that turns red→green with the switch.

**Tech Stack:** Docker (`node:26-trixie-slim`), g++ 14.2 / Python 3.13.5 (Debian trixie), Jest integration suite in `tests/authoring/compose.yml`, `node:test` guard.

**Spec:** `docs/superpowers/specs/2026-11-12-toolchain-upgrade-design.md` (Step 2)

**Probe already done (2026-11-12), `node:26-bookworm-slim` vs `node:26-trixie-slim`:** g++ 12.2.0 → 14.2.0; Python 3.11.2 → 3.13.5 at `/usr/bin/python3`; `apt.postgresql.org` has `trixie-pgdg`; `fonts-tlwg-garuda` + `fonts-dejavu-core` install and Garuda is in `fc-list`; `bits/stdc++.h` compiles under the 768MB compile RLIMIT_AS on both; Python starts under RLIMIT_AS 16MB on both and fails at 8MB on both (no memory-floor change); `uint64_t` without `<cstdint>` compiles on g++ 12 but is a Compilation Error on g++ 14 (the accepted user-visible change).

## Global Constraints

- Backend image: `node:26-trixie-slim`. Authoring runner stays exactly as is (`node:26-bookworm-slim` build stage, `ubuntu:24.04` runtime, `wkhtmltopdf=0.12.6-2build2`) — PDF output is frozen.
- Postgres apt repo line uses the image's own codename (from `/etc/os-release` `VERSION_CODENAME`), never a hard-coded name. `postgresql-client-16` unchanged (Postgres is spec Step 9).
- Compile flags unchanged: `-std=c++20 -fsanitize=signed-integer-overflow`. `LANGUAGE_LIMITS` unchanged (Python time ×4, memory ×2). `JUDGE_CONFIG` unchanged.
- Sandbox unchanged in behaviour: `scripts/time_wrapper.c` seccomp denylist (`socket`, `socketpair`, `unshare`, `setns`, `ptrace`, `mount`), prlimit caps, per-submission uid. If gcc 14 emits a new warning under `-Wall -Wextra -Werror` for `backend/authoring/sandbox.c`, fix the C source minimally with no behaviour change and say so in the PR; never drop `-Werror` or add `-Wno-*`.
- Existing submissions are not re-judged or compared (user decision).
- No dependency version changes.
- Commits: user is sole author — no `Co-Authored-By` trailer. Branch `build/judge-trixie` from latest `main`. Builder opens the PR and stops; the user merges.

## Review Focus

1. Verdict semantics drift with the new toolchain (TLE/MLE/RE detection is evidence-based on exit codes, signals and measured memory) → Task 1's end-to-end test pins every verdict class and must pass on both images.
2. UBSan signed-overflow still produces Runtime Error under g++ 14's runtime → Task 1 case `cpp-signed-overflow`.
3. Seccomp still blocks networking under trixie's glibc → Task 1 case `cpp-socket-blocked`.
4. Compile errors still sanitize server paths → Task 1 case `cpp-compile-error` asserts no `oj-submissions` in the stored output.
5. Fallback avatar glyphs (Thai) still render → `tests/integration/authorAvatarFonts.test.ts` runs in the integration stack in Task 2/4.

---

### Task 1: End-to-end judge runtime test (characterises today's judge)

**Files:**
- Create: `backend/tests/integration/judgeRuntime.test.ts`

**Interfaces:**
- Consumes: `processSubmission(submissionId: number): Promise<void>` (`backend/services/submissionService.ts`), `runMigrationsFromPool` (`backend/scripts/migrate.ts`), `SUBMISSION_STATUS` (`backend/constants`).
- Produces: a suite later tasks rely on to prove the toolchain switch keeps verdicts.

- [ ] **Step 1: Write the suite.** Gate: `(process.env.INTEGRATION_DATABASE_URL && process.platform === 'linux' && process.getuid?.() === 0 && fs.existsSync('scripts/time_wrapper')) ? describe : describe.skip` — same gating idea as `authoringOutputRuntime.test.ts`. Setup mirrors `authoringVerify.test.ts`: per-suite schema `judge_<uuid>`, `jest.mock('../../db')` delegating `query` and `pool.connect` to a schema-scoped `pg.Pool`, and `withTransaction(body)` to a client from that pool wrapped in `BEGIN`/`COMMIT` (`ROLLBACK` on throw) — these are the three `db.ts` exports the pipeline uses, `runMigrationsFromPool`, drop schema in `afterAll`. Seed one user, problem `double` (time 1000 ms, memory 256 MB, testcases `3→6`, `21→42`) and problem `small-mem` (time 1000 ms, memory 32 MB, testcase `1→1`). Helper `judgeOnce(problemId, language, code) → { overall_status, results }`: INSERT a `Pending` submission, `await processSubmission(id)`, SELECT the row.
  `it.each` cases (`name`, problem, language, code → expected `overall_status`):
  - `cpp-accepted`: doubles input → `Accepted`, score 100
  - `cpp-wrong-answer`: echoes input → `Wrong Answer`
  - `cpp-tle`: `int main(){for(;;);}` → `Time Limit Exceeded`
  - `cpp-mle` (`small-mem`, 32 MB): allocate and touch 40 MB (`std::vector<char> v(40<<20, 1); std::cout << (int)v[12345] << "\n";`) → `Memory Limit Exceeded`. Why 40 MB: the wrapper's RLIMIT_AS is limit + `JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB` (32) = 64 MB, and MLE is decided from measured peak RSS > limit (`judgeService.ts:156`); an allocation beyond 64 MB would fail in malloc and be judged Runtime Error instead.
  - `cpp-segfault`: write through a null `volatile int*` → `Runtime Error`
  - `cpp-signed-overflow`: `volatile int x = INT_MAX; x = x + 1;` then print → `Runtime Error`
  - `cpp-socket-blocked`: `#include <sys/socket.h>`; print `blocked` if `socket(AF_INET, SOCK_STREAM, 0) < 0` else `open`; on a third seeded problem `sock` (time 1000 ms, memory 256 MB, one testcase: input `x`, output `blocked`) → `Accepted`
  - `cpp-compile-error`: `int main( {` → `Compilation Error`, and `JSON.stringify(results)` does not contain `oj-submissions`
  - `py-accepted`: `print(int(input())*2)` → `Accepted`
  - `py-wrong-answer`: `print(input())` → `Wrong Answer`
  - `py-runtime-error`: `raise ValueError("boom")` → `Runtime Error`
  - `py-syntax-error`: `print(` → `Compilation Error`
  - `py-tle`: `while True: pass` → `Time Limit Exceeded`
  Use a per-test timeout of 30 s.

- [ ] **Step 2: Prove it passes on today's (bookworm) judge.** From repo root: `COMPOSE_PROJECT_NAME=oj-judge-t1 docker compose -f tests/authoring/compose.yml run --rm --build tests npm test -- --runInBand tests/integration/judgeRuntime.test.ts` → 13 passed, 0 skipped; then `down -v`. If any case's verdict differs from the expectation above on bookworm, the test is wrong (it must characterise today's behaviour) — report the actual verdict as NEEDS_CONTEXT rather than editing the expectation silently.

- [ ] **Step 3: Prove it is not vacuous.** Temporarily change `cpp-accepted`'s expectation to `Wrong Answer`, rerun the single test, confirm it fails, restore.

- [ ] **Step 4: Host run skips cleanly.** `cd backend && npm test -- tests/integration/judgeRuntime.test.ts` on macOS → suite skipped, exit 0.

- [ ] **Step 5: Commit** — `git commit -m "test: end-to-end judge runtime verdicts in the backend image"`

### Task 2: Backend image on trixie

**Files:**
- Modify: `backend/Dockerfile:1-14` (FROM, pgdg line, comment), `tests/nodeVersion.test.mjs` (backend bookworm assertion → trixie; runner assertion unchanged), `backend/tests/integration/judgeRuntime.test.ts` (add toolchain test)

**Interfaces:**
- Consumes: Task 1 suite.

- [ ] **Step 1: Write the failing toolchain assertions.**
  - In `judgeRuntime.test.ts`, add `it('judge toolchain is g++ 14 and Python 3.13')`: `execFileSync('g++', ['-dumpversion'])` trimmed starts with `'14'`; `execFileSync('/usr/bin/python3', ['-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")'])` trimmed equals `'3.13'`.
  - In `tests/nodeVersion.test.mjs`, the backend assertion becomes `FROM node:${major}-trixie-slim` (literal check for `backend/Dockerfile`); the runner assertion stays `FROM node:${major}-bookworm-slim AS build`. Rename that test to "judge image is on trixie; runner build stage stays on bookworm".

- [ ] **Step 2: Run, expect failures.** `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs` → the trixie assertion FAILS. Integration run of `judgeRuntime.test.ts` (as Task 1 Step 2, project `oj-judge-t2`) → toolchain test FAILS (`12`, `3.11`), the 13 verdict cases pass.

- [ ] **Step 3: Switch the image.** `FROM node:26-trixie-slim`. Replace the hard-coded `bookworm-pgdg` with `$(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg`. Update the top comment to say the judge toolchain comes from Debian trixie (g++ 14, Python 3.13). Keep every other line, including the `/usr/bin/python3` assertion and both `gcc` compiles (`time_wrapper.c`, `authoring/sandbox.c -Wall -Wextra -Werror`).

- [ ] **Step 4: Build and check the image.** `COMPOSE_PROJECT_NAME=oj-judge-t2 docker compose -f tests/authoring/compose.yml build` succeeds (in particular the two `gcc` lines). In the built `tests` image: `g++ --version` → `14.2`, `python3 --version` → `3.13`, `fc-list | grep -ci garuda` ≥ 1, `psql --version` → `16.`, `node -e "require('bcrypt');require('sharp');console.log('ok')"` → `ok`.

- [ ] **Step 5: Run green.** Guard: `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs` → all pass. Integration: `judgeRuntime.test.ts` → 14 passed. Also run `tests/integration/authorAvatarFonts.test.ts`, `tests/utils/sandboxProcess.test.ts`, `tests/integration/authoringCompiler.test.ts` in the same stack → pass. `down -v`.

- [ ] **Step 6: Commit** — `git commit -m "build: run the judge on Debian trixie (g++ 14, Python 3.13)"`

### Task 3: Docs

**Files:**
- Modify: `.context/ARCHITECTURE.md:361`, `SANDBOX.md` (only if it names a Debian release or compiler version)

- [ ] **Step 1:** On the Languages line in `.context/ARCHITECTURE.md`, add that the judge image is Debian trixie (g++ 14, Python 3.13). Check `git grep -n -i -E "bookworm|g\+\+ ?12|python 3\.11" -- SANDBOX.md .context CLAUDE.md README.md CONTRIBUTING.md ':!.context/AUTHORING_PROGRESS.md'` → only intended remaining mentions (the authoring runner's `bookworm` build stage is correct).
- [ ] **Step 2: Commit** — `git commit -m "docs: judge toolchain is g++ 14 / Python 3.13"`

### Task 4: Full verification and PR

- [ ] **Step 1: Full integration stack** — `COMPOSE_PROJECT_NAME=oj-judge-full docker compose -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests` → 0 failed (baseline 124 suites / 1475 tests, plus the new suite's 14), then `down -v`.
- [ ] **Step 2: Backend unit suite** (host-independent, unchanged code paths) — `cd backend && npm run build && npm test -- --ci` on Node 26 → 0 failed.
- [ ] **Step 3: Guard + compose config** — `node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs` → all pass; `docker compose --env-file .env.example build` succeeds.
- [ ] **Step 4: Local app smoke test** (separate project `oj-judge-smoke`, `HTTP_PORT=8088`, `--env-file .env.example`): log in as a throwaway local admin, create a problem, submit C++ and Python solutions → Accepted; submit the `uint64_t`-without-`<cstdint>` program → Compilation Error with a readable, path-free message. Tear down with `down -v`.
- [ ] **Step 5: Push and open the PR** — branch `build/judge-trixie`, base `main`, title `build: judge on Debian trixie — g++ 14, Python 3.13 (step 2/9)`. Body: before/after `g++` and `python3` versions; the end-to-end verdict table; the known user-visible change (missing standard includes now fail to compile, e.g. `uint64_t` without `<cstdint>`); existing submissions keep their old verdicts and are not re-judged; what was not verified. No Claude attribution footer. Stop for user review.
