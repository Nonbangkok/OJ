# Cloudflare-Safe Chunked Batch Problem Upload — Design

## Goal

Allow admins and staff to upload batch problem ZIPs up to the existing 2 GiB
transport limit through the normal Cloudflare Tunnel endpoint without sending
any individual HTTP request near Cloudflare's 100 MB body limit.

## Current behavior and constraints

- `POST /admin/problems/batch-upload` accepts one multipart ZIP through Multer
  disk storage and starts the existing asynchronous `processBatchUpload` flow.
- The backend Multer limit is 2 GiB. The archive processor separately enforces
  its existing uncompressed-size and entry-count limits; those rules are not
  changed by this feature.
- The frontend blocks files over 100 MiB unless a separate upload URL is
  configured, and otherwise sends the whole ZIP in one request.
- Batch progress is delivered through the existing authenticated SSE route.
  Progress events currently emitted before the browser opens SSE are dropped,
  so a small/fast import can finish before the client subscribes.

## Chosen approach

Use authenticated multipart chunks stored temporarily on the backend, then
stream-concatenate them to the ZIP path consumed by the existing processor.
Uploads use the current batch-upload API base URL, so the same flow works with
Cloudflare Tunnel and with the optional configured upload origin. Files at or
below 50 MiB keep the current single-request endpoint; files larger than 50 MiB
use chunking. Each client chunk is 25 MiB, while the server rejects an
individual chunk over 35 MiB.

The other approaches considered were retaining a monolithic request via a
DNS-only upload host (does not meet the no-network-reconfiguration requirement)
and introducing object storage/multipart infrastructure (more operational
dependencies than needed for the existing single-backend deployment).

## API and data flow

All three new endpoints require `requireAuth` and `requireStaffOrAdmin`.

1. `POST /admin/problems/batch-upload/init` accepts a strict Zod-validated
   `{ fileName, fileSize, totalChunks }` body. The file size must be positive
   and at most 2 GiB; `totalChunks` must equal the ceiling of file size divided
   by 25 MiB. The server generates a UUID `uploadId` and creates a private
   `/tmp/oj-chunk-uploads/{uploadId}` session directory with metadata including
   the initiating user ID, declared file size, chunk count, and creation time.
   It returns `{ uploadId }`.
2. `POST /admin/problems/batch-upload/chunk` accepts multipart fields
   `uploadId`, `chunkIndex`, and `chunk`. Multer enforces the 35 MiB per-file
   cap. Each part is stored as
   `/tmp/oj-chunk-uploads/{uploadId}/{chunkIndex}.part`. The server validates
   session ownership and index range, and requires the exact expected byte
   length (25 MiB except for the final chunk). Chunk writes are atomic;
   repeating the same chunk is idempotent, while replacing an existing index
   with different content is rejected. The response is
   `{ success: true, chunkIndex }`.
3. `POST /admin/problems/batch-upload/complete` accepts a strict Zod-validated
   `{ uploadId }` body. It verifies all expected chunks, streams them in order
   into `/tmp/oj-batch-{uploadId}.zip`, checks the assembled byte count against
   the declared file size, and removes the chunk session only after assembly
   succeeds. It then removes `/tmp/oj-chunk-uploads/{uploadId}`, generates
   `progressId` as `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
   and returns HTTP 202 with the existing response
   `{ message: 'Batch upload initiated.', progressId }`. It starts the existing
   `streamBatchUpload(progressId, onProgress =>
   processBatchUpload(assembledZipPath, onProgress))` pipeline asynchronously.
   The assembled ZIP is removed in `finally`, including processing failures.

Missing sessions/chunks, invalid indexes, ownership mismatches, and size
mismatches return an appropriate client error (400/404/409/413) without
starting the processor. Filesystem/assembly failures return a server error,
clean up partial assembled output, and do not start processing. The existing
one-request route and its 202/SSE contract remain backward compatible.

## Storage, authorization, and cleanup

- Session IDs are cryptographically generated UUIDs; request values are never
  used directly as filesystem paths.
- Session metadata is bound to the authenticated user who initialized it, and
  every subsequent chunk/complete operation must come from that same user.
- A chunk session's modification time is refreshed as chunks arrive. On init,
  a housekeeping pass removes chunk directories older than two hours and
  assembled `/tmp/oj-batch-*.zip` files older than two hours (the latter covers
  process/container termination before normal cleanup).
- Temporary sessions live on the backend instance's local `/tmp`, as required.
  This assumes the current single-backend deployment; a backend restart loses
  in-progress uploads, which expire through cleanup.
- Existing archive validation, extraction limits, and import semantics remain
  unchanged.

## Progress and frontend behavior

- The frontend uses the normal multipart endpoint for files up to 50 MiB.
- Larger files are sliced into sequential 25 MiB parts. Sequential upload keeps
  memory use and progress ordering predictable. The feedback reports uploaded
  parts/percentage; after `complete`, the existing SSE processing progress
  takes over. Upload failure stops the sequence, does not call `complete`,
  keeps a retryable error, and lets the two-hour server cleanup remove the
  incomplete session.
- Existing completion/error behavior continues to refresh the problem list and
  release the UI loading state.
- To remove the existing fast-completion race, the SSE service retains the
  latest non-terminal progress event and terminal complete/error event for up
  to 10 minutes. A late subscriber receives the retained progress (if any)
  followed by the terminal event; normal connected clients continue receiving
  live events. Expired entries are pruned during progress updates and
  subscriptions so the in-memory map remains bounded by active/recent uploads.
  This is in-memory and is not durable across backend restart.

## Limits and non-goals

- Maximum original ZIP size remains 2 GiB; chunks are 25 MiB from the client,
  with a server-side maximum of 35 MiB per multipart file.
- The feature does not add DNS changes, a new storage provider, database
  migrations, archive-format changes, or changes to archive safety limits.
- Aggregate temporary-disk quotas and multi-backend shared storage are not
  included; the deployment currently runs one backend instance. Operators must
  retain sufficient temporary disk for concurrent uploads and ZIP assembly.

## Verification requirements

Backend unit/controller tests cover schema constraints, authentication and
ownership, valid/missing/repeated/out-of-range/wrong-sized chunks, assembly
ordering and byte-count verification, cleanup, the 202/SSE handoff, and late
SSE subscribers receiving terminal results. Frontend tests cover the 50 MiB
threshold, standard upload for smaller files, 25 MiB chunk count/order for
larger files, upload progress, completion-to-SSE transition, error handling,
and input reset. Run the backend and frontend full test suites and both build
checks after integration.
