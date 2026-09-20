# Python Language Support — Design

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: approved by user (chat, 2026-09-20).

## Problem

The judge currently accepts **C++ only**. `submissions.language` is a
VARCHAR(20) with no validation, the frontend hardcodes a single "C++"
language button (`CodeSubmissionForm.tsx`), and the pipeline compiles with
`g++ -std=c++20`. Adding Python widens the audience (beginners especially)
without a second system.

## Design decisions (from the user conversation)

- **Per-language time/memory multipliers**: C++ is 1×/1×; Python is
  **time ×4, memory ×2**. The problem keeps a single `time_limit_ms` /
  `memory_limit_mb`; the judge multiplies at execution time, so one problem
  serves both languages. The multiplier lives in one constants table, making
  future languages a one-line addition.

## Scope of changes

### Constants — `backend/constants/index.ts`

Add:

```ts
export const SUPPORTED_LANGUAGES = ['cpp', 'python'] as const;
export type SubmissionLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LIMITS: Record<SubmissionLanguage, {
  timeMultiplier: number;   // C++ = 1, Python = 4
  memoryMultiplier: number; // C++ = 1, Python = 2
}> = {
  cpp:   { timeMultiplier: 1, memoryMultiplier: 1 },
  python: { timeMultiplier: 4, memoryMultiplier: 2 },
};
```

Also add the compile command template per language (see below) here, so
`submissionService.ts` stays free of magic strings.

### Validation — `backend/schemas/requestSchemas.ts`

`submitSchema.language` becomes `z.enum(SUPPORTED_LANGUAGES)` instead of a
free `nonEmptyString`. Existing rows store `'cpp'` already, so no data
migration is needed.

### Judge pipeline — `backend/services/submissionService.ts`

Today `runSubmissionPipeline` writes the source to a file, compiles with
g++, then calls `judgeService.judge(problem_id, executablePath)`.

Restructure into a language-agnostic "prepare" step that returns the runnable
command:

- **cpp (unchanged behavior)**: compile
  `g++ -std=c++20 -fsanitize=signed-integer-overflow <src> -o <exe>`, then
  run the compiled binary. Compile failure → `Compilation Error` (keep the
  existing stderr sanitization).
- **python**: no compile step — the "compile" phase is a fast syntax check
  `python3 -m py_compile <src>` (a syntax error maps to `Compilation Error`
  with Python's syntax-error message shown the way g++ stderr is shown
  today). The run command is `python3 <src>` executed via the same
  `time_wrapper` path (see judgeService below). No binary to chmod/unlink.

### Judge execution — `backend/services/judgeService.ts`

`judge()` currently receives `executablePath` and builds
`timeout <s>s ./scripts/time_wrapper <exe> <asLimitMb> <cpuLimitS>`.
Change the signature to accept `(problem_id, runnable: { command: string,
args: string[] })` or equivalent — the C++ case passes the binary path,
Python passes `python3 <src>`.

Apply multipliers **before** computing limits:

```ts
const { timeMultiplier, memoryMultiplier } = LANGUAGE_LIMITS[language];
const effectiveTimeMs   = timeLimitMs * timeMultiplier;
const effectiveMemoryMb = memoryLimitMb * memoryMultiplier;
```

All downstream values — `timeout` seconds, `TIMEOUT_BUFFER_MS`,
`CPU_LIMIT_SLACK_S`, `MEMORY_LIMIT_SLACK_MB`, the wall-clock `timeout` of the
exec call, and the reported `timeMs` used for TLE reporting — use the
effective values. Report `time_limit_ms`/`max_memory_kb` in the results as
the **effective** limits for that language (so a Python TLE shows the
Python-scaled limit, not the C++ one).

The `time_wrapper.c` privilege drop (root → nobody) and rlimits work
identically for an interpreted child — no changes to the C wrapper.

### Dockerfile — `backend/Dockerfile`

Install `python3` (and only the stdlib — no pip packages) in the apt layer:
add `python3` to the `apt-get install` list. `SANDBOX_PATH` stays
`/usr/bin:/bin`; verify `python3` resolves there in the slim image (it lives
in `/usr/bin/python3`). The unprivileged judge user (`nobody`) must be able
to read the source file — the source is written under the same submissions
dir as today, so keep its permissions equivalent to the compiled binary's
(0644 readable).

### Frontend

- `frontend/src/utils/constants.ts` (domain mirror): `SUPPORTED_LANGUAGES`
  and display names `cpp → 'C++'`, `python → 'Python'`.
- `frontend/src/features/problem/submission/CodeSubmissionForm.tsx` — render
  one language button per supported language from the constant (currently
  hardcoded single C++ button); `active` state follows the selected language.
- `frontend/src/hooks/useCodeSubmission.ts` — keep `language` state (default
  `'cpp'`); register the `python` highlight.js language
  (`highlight.js/lib/languages/python`) alongside `cpp`; include language in
  the per-problem code cache key so switching languages doesn't restore C++
  code into the Python editor (e.g. `cache[`${problemId}:${language}`]`).
- `frontend/src/types/` — `SubmitRequest.language` becomes
  `'cpp' | 'python'`.

### Analytics/profiles (display-only)

`userProfileQueryService.language_counts` and the admin analysis language
breakdowns already aggregate the raw `language` column; `'python'` will
simply appear as a new key. Verify display code doesn't hardcode a C++
label list (audit `frontend/src/features/admin/analysis/*` and user profile
language rendering; map unknown keys to the raw string).

## Testing plan

- **Unit (judgeService)**: effective limits are computed from multipliers;
  Python TLE occurs at 4× the problem limit; memory limit scaled ×2.
- **Integration (submissionService)**: a Python submission with a syntax
  error → `Compilation Error`; a correct Python solution → `Accepted`;
  `timeout`/`time_wrapper` path exercised for `python3` command.
- **Schema tests**: `submitSchema` rejects unknown languages, accepts
  `python`.
- **Frontend**: language buttons render and switch; cache is per-language.

## Acceptance criteria

1. A user can submit Python 3 (stdlib only) to any problem and receive
   normal verdicts (AC/WA/TLE/MLE/RE/CE) per testcase.
2. Python submissions are judged against time ×4 / memory ×2 of the
   problem's limits; C++ behavior is byte-identical to before.
3. A Python syntax error produces `Compilation Error` with the Python
   error message (sanitized of file paths, as with g++ today).
4. Unknown languages are rejected with 400 by the submit endpoint.
5. The submit form offers C++ and Python; code cache is per-language.
6. `backend npm test` and `frontend npm run validate` pass.

## Out of scope

Pip/third-party packages, PyPy, other languages, per-problem language
restrictions, per-language separate limits authored in the problem.
