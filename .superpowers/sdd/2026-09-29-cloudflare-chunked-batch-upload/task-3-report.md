# Task 3 Report: Frontend chunk upload service and hook

Status: complete

Implementation commit: `1e83c989592580859f8fc57767b6f9b9b2aff54a` (`feat: add chunked batch problem uploads`)

## Implementation summary

- Files at or below 50 MiB continue to use the existing `/admin/problems/batch-upload` multipart endpoint.
- Files above 50 MiB are initialized through the configured `largeUploadApi`, split into sequential 25 MiB `File.slice` parts, and uploaded with `uploadId`, `chunkIndex`, and `chunk` multipart fields.
- Completion is called after all chunks succeed. Its returned `progressId` is handed to the existing SSE subscription, which uses the same configured API origin.
- Upload feedback reports completed parts and percentage. Chunk failures stop the sequence, skip completion/SSE, show an error, and release loading. The existing 2 GiB maximum is enforced, and the input is reset after success, error, or an oversized-file rejection.
- Duplicate late terminal SSE events are ignored after the first complete/error event, preserving the completed state and avoiding duplicate list refresh/loading release.

## Files changed

- `frontend/src/hooks/admin/useBatchUpload.ts`
- `frontend/src/services/admin/problemsAdminService.ts`
- `frontend/src/types/service.ts`
- `frontend/src/tests/hooks/admin/useBatchUpload.test.tsx`
- `frontend/src/tests/services/adminService.test.ts`

## TDD red evidence

CodeGraph was attempted first as required. Output: `CodeGraph isn't available here — no .codegraph/ index exists in /private/tmp/OJ-worktrees/chunked-batch-upload. If you are an AI agent: continue with your usual tools; indexing is the user's decision, do not run it yourself.`

The first test invocation could not start because dependencies were absent:

```text
> frontend@0.1.0 test
> react-scripts test --watchAll=false --runInBand src/tests/hooks/admin/useBatchUpload.test.tsx src/tests/services/adminService.test.ts

sh: react-scripts: command not found
```

After `npm ci --no-audit --no-fund`, the focused suite was run before production edits. The first draft had test-harness issues (detached DOM input and threshold fixtures); these were corrected before implementation. The corrected red run exited 1 with `Test Suites: 2 failed, 2 total` and `Tests: 8 failed, 26 passed, 34 total`. Its expected feature-missing failures included:

```text
Expected: not to have been called
Received: 1: {}
```

for the existing monolithic endpoint still receiving an over-50-MiB file;

```text
Expected: {"fileName":"problems.zip","fileSize":52428810,"totalChunks":3}
Number of calls: 0
```

for the absent init/chunk path; and service failures such as:

```text
TypeError: _adminService.default.initBatchUpload is not a function
TypeError: _adminService.default.uploadBatchUploadChunk is not a function
TypeError: _adminService.default.completeBatchUpload is not a function
```

The remaining hook failures showed that chunk errors were not stopping before completion, late terminal events could overwrite success, and a file above 2 GiB did not produce the expected cap error. The production feature was then implemented.

## Commands and outputs

Environment: Node `v25.9.0`, npm `11.12.1`; frontend package declares Node `20.x`.

`npm ci --no-audit --no-fund` (run in `frontend/`): exit 0; `added 1560 packages in 7s`. npm emitted `EBADENGINE` for the Node 20 requirement and dependency deprecation warnings.

Final focused test command:

```text
CI=true npm test -- --watchAll=false --runInBand src/tests/hooks/admin/useBatchUpload.test.tsx src/tests/services/adminService.test.ts
```

Output:

```text
PASS src/tests/hooks/admin/useBatchUpload.test.tsx
PASS src/tests/services/adminService.test.ts
Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
Snapshots:   0 total
```

Full frontend suite:

```text
CI=true npm test -- --watchAll=false --runInBand
```

Output summary:

```text
Test Suites: 130 passed, 130 total
Tests:       987 passed, 987 total
Snapshots:   0 total
Time:        53.58 s, estimated 65 s
Ran all test suites.
```

The suite emitted an existing FakeTimers warning: `clearTimeout was invoked to clear a native timer instead of one created by this library.` No test failed.

`npm run type-check`:

```text
> tsc --noEmit
```

Exit 0.

`npm run type-check:tests:services`:

```text
> tsc -p tsconfig.tests.services.json --noEmit
```

Exit 0.

`npm run type-check:tests:hooks` exited 2 with five existing errors in `src/tests/hooks/useNavSlider.test.tsx`:

```text
Property 'toHaveStyle' does not exist on type 'JestMatchers<HTMLElement>'.
```

The errors are at lines 52, 58, 87, 115, and 126 and are outside this change.

`npm run lint:check`:

```text
> eslint src --ext .ts,.tsx
```

Exit 0.

`npm run build`:

```text
Creating an optimized production build...
Compiled successfully.
461.64 kB  build/static/js/main.42454d4e.js
37.29 kB   build/static/css/main.145600f5.css
1.76 kB    build/static/js/453.03346f77.chunk.js
The build folder is ready to be deployed.
```

Exit 0.

`git diff --check`: exit 0, no output. Final worktree status was clean on branch `codex/chunked-batch-upload`.

## Concerns

- Verification ran successfully on Node 25.9.0 despite the package's declared Node 20.x engine; npm reported the engine mismatch.
- The hook-test TypeScript command remains red because of the five unrelated `toHaveStyle` matcher typing errors described above. Production type-check, service-test type-check, focused tests, full tests, lint, and build pass.
