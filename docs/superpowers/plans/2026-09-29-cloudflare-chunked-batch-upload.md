# Cloudflare-Safe Chunked Batch Problem Upload — Implementation Plan

> **For implementation agents:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan one task at a time. Each task follows test-driven development: add/run a failing test first, implement the smallest change, then rerun focused tests. The parent reviews each task before continuing.

**Goal:** Let staff/admin upload batch problem ZIPs through Cloudflare Tunnel up to the existing 2 GiB cap by sending files larger than 50 MiB in authenticated 25 MiB chunks, while preserving existing archive processing and progress UX.

**Architecture:** Add authenticated init/chunk/complete endpoints with per-user temporary upload sessions under `/tmp/oj-chunk-uploads`, strict metadata and chunk validation, atomic part storage, ordered streaming assembly, and two-hour cleanup. Reuse `processBatchUpload` and existing SSE route; retain recent progress/terminal SSE events briefly to close the current late-subscriber race. The frontend keeps the current one-request path for files up to 50 MiB and sequentially uploads 25 MiB slices above that threshold before subscribing to SSE.

**Tech Stack:** Express, TypeScript, Zod, Multer, filesystem streams, React, Axios, EventSource, Jest/React Testing Library.

## Task 1: Backend upload session service and request schemas

**Files:**
- Modify: `backend/schemas/requestSchemas.ts`
- Modify or add: `backend/services/chunkedBatchUploadService.ts`
- Add: `backend/tests/services/chunkedBatchUploadService.test.ts`
- Add/update: schema tests under `backend/tests/`

1. Add failing schema tests for init input boundaries (positive file size, <=2 GiB, exact `ceil(fileSize / 25 MiB)` chunk count) and complete input (`uploadId`).
2. Add failing service tests for secure session creation/owner metadata, expected chunk size, out-of-range indexes, atomic same-content retries, conflicting retries, missing chunks, ordered assembly, exact assembled byte count, cleanup of old sessions/archives, and partial-output cleanup on assembly failure.
3. Run the focused backend tests and confirm the new assertions fail for missing behavior.
4. Implement a small session service with UUID-only path construction, private directory permissions where supported, metadata validation, a 35 MiB Multer chunk cap constant, exact part sizes, atomic writes, same-content idempotence, owner checks, ordered streamed assembly, and two-hour housekeeping. Keep filesystem base paths injectable for tests.
5. Rerun focused tests and relevant existing upload/schema tests.

## Task 2: Authenticated controller routes and SSE replay

**Files:**
- Modify: `backend/controllers/problemController.ts`
- Modify: route registration file for admin problem routes (identified during implementation)
- Modify: `backend/services/batchUploadProgress.ts`
- Modify: `backend/tests/problemController.test.ts`
- Add/update: `backend/tests/services/batchUploadProgress.test.ts`

1. Add failing route/controller tests proving all three endpoints require auth/staff-or-admin and bind init/chunk/complete to the same user. Cover valid 202 response, missing and invalid chunks, ownership mismatch, malformed schemas, and that the existing single-request route remains unchanged.
2. Add failing SSE tests for a subscriber arriving after terminal completion/error and for expiry/pruning of retained events.
3. Run focused tests to verify they fail before implementation.
4. Wire init/chunk/complete routes with the existing auth middleware and shared schema validation patterns. Map malformed/missing/conflicting/oversized input to suitable client errors; map filesystem failures to server errors. On complete, assemble first, remove chunk session, return the exact existing 202 message/progressId contract, invoke `streamBatchUpload` asynchronously with `processBatchUpload`, and remove assembled ZIP in `finally`.
5. Retain latest non-terminal progress and terminal event for 10 minutes; replay in order on late SSE subscription and prune expired records on updates/subscriptions. Preserve live SSE behavior.
6. Rerun focused controller/service tests and existing batch upload tests.

## Task 3: Frontend chunk upload service and hook

**Files:**
- Modify: `frontend/src/services/admin/problemsAdminService.ts`
- Modify: `frontend/src/hooks/admin/useBatchUpload.ts`
- Modify: `frontend/src/types/service.ts`
- Modify: `frontend/src/utils/constants.ts` only if an existing constant is suitable for shared thresholds
- Add: `frontend/src/hooks/admin/useBatchUpload.test.ts` (or project-standard neighboring test path)
- Add/update: service tests under `frontend/src/services/`

1. Add failing tests for files <=50 MiB using the existing single-request API, >50 MiB files being sliced into ordered 25 MiB chunks, exact-multiple and remainder chunk counts, per-part progress, calling complete only after all parts succeed, SSE subscription after completion, retryable errors without complete, stale/late SSE completion handling, and file input reset.
2. Run focused frontend tests and confirm the behavior is absent.
3. Add service methods for init, chunk multipart upload, and complete, using the same configured batch-upload API origin as the existing upload and SSE. Remove the 100 MiB blocking guard while preserving the 2 GiB cap.
4. Update the hook to send <=50 MiB files through the existing endpoint and sequentially slice/upload larger files; report chunk progress, then hand off to existing SSE processing UI. On failure, stop and preserve the retryable error state; always release loading state/reset input as current behavior requires.
5. Keep changes scoped to batch-upload flow; do not alter other upload paths or Admin UI behavior.
6. Rerun focused frontend tests and existing service/hook tests.

## Task 4: Progress UI and cross-feature regression verification

**Files:**
- Modify: the Admin Problem Management batch-upload feedback component (located during implementation)
- Add/update: relevant UI tests

1. Add a failing UI test that verifies chunk upload progress is visible and transitions to the existing SSE processing progress without replacing the upload controls or losing selected-file context unexpectedly.
2. Implement the minimal status/message rendering required for an `uploading` phase; preserve existing success/error messages and list refresh behavior.
3. Run focused frontend tests.
4. Run backend full test suite and build, frontend full test suite and production build. Fix only regressions caused by this feature.
5. Review final diff against the design spec and verify no `.codegraph/` files or unrelated product files changed.

## Execution and acceptance

- Execute tasks sequentially through subagent-driven development, with one implementation subagent active at a time; parent inspects changed files and test evidence before moving to the next task.
- Keep implementation isolated on branch `codex/chunked-batch-upload` in `/private/tmp/OJ-worktrees/chunked-batch-upload`.
- Do not merge or push as part of this plan.
- Acceptance requires 2 GiB/max chunk validation, exact owner scope, retry-safe chunk writes, ordered streamed assembly, cleanup, unchanged existing single-upload behavior, 10-minute SSE replay, frontend progress-to-SSE transition, all focused and full tests passing, and clean review confirming `.codegraph/` is untouched.
