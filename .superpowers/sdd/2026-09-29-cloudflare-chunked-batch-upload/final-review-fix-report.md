# Final review fix report

## Finding and root cause

`createSession()` awaits `cleanupExpired()` before creating each upload session. Cleanup lists directory entries and then calls `fs.stat()` on each candidate. A concurrent completion can remove a listed session directory after `readdir()` returns and before its `stat()`. That `ENOENT` previously rejected `Promise.all`, causing a valid init request to fail.

## Regression test and RED result

Added a coordinated regression test in `backend/tests/services/chunkedBatchUploadService.test.ts`. It creates an old session candidate and wraps the real `readdir()` so the candidate is removed immediately after its listing is read. The test then calls `createSession()` and checks that the new session was created.

Before the production fix:

```text
$ npm test -- --runInBand tests/services/chunkedBatchUploadService.test.ts
FAIL tests/services/chunkedBatchUploadService.test.ts
  ● ChunkedBatchUploadService › continues creating a session when a listed stale session disappears before stat

    ENOENT: no such file or directory, stat '.../sessions/a0f53660-04ea-4ae9-9b78-80646a9bf115'
      at services/chunkedBatchUploadService.ts:244:21
      at ChunkedBatchUploadService.removeOldEntries
      at ChunkedBatchUploadService.cleanupExpired
      at ChunkedBatchUploadService.createSession

Test Suites: 1 failed, 1 total
Tests:       1 failed, 11 passed, 12 total
```

## Fix and GREEN verification

`removeOldEntries()` now treats `ENOENT` from the per-entry `stat()` as already cleaned and returns for that entry. Other stat errors are rethrown unchanged.

After the fix:

```text
$ npm test -- --runInBand tests/services/chunkedBatchUploadService.test.ts
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

Backend build:

```text
$ npm run build
> tsc && node scripts/copyAuthoringTemplates.cjs
EXIT_CODE=0
```

## Files changed

- `backend/services/chunkedBatchUploadService.ts`
- `backend/tests/services/chunkedBatchUploadService.test.ts`
- `.superpowers/sdd/2026-09-29-cloudflare-chunked-batch-upload/final-review-fix-report.md`

## Commit

Implementation and regression test commit: `93b8aaf2d9ee5afac07586f030a5d0e37f68968a` (`fix: tolerate concurrent chunk upload cleanup`).

## Concerns

The focused service test and backend build passed. The full backend test suite was not run. No other cleanup behavior was changed.
