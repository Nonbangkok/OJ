# Problem Authoring Progress

Updated: 2026-09-14. Branch: `authoring`.

Scope authority: `docs/superpowers/specs/2026-09-12-problem-authoring-workspace-design.md`, section 17.

## Slice 3 — Complete

Author profiles, image normalization, draft author snapshots, and statement asset
persistence/API are implemented and verified. There is no remaining work within
the backend scope of Slice 3.

| Requirement | Implementation and verification |
| --- | --- |
| Reusable author profiles with optional account link | Admin create/list/update APIs; unique account-link conflict tested against PostgreSQL |
| JPEG/PNG/WebP author images | Real decoding, canonical 512×512 PNG, MIME matching, EXIF orientation, metadata removal, animation/pixel-limit rejection |
| Fallback avatar | Deterministic initial-based PNG within the same renderer/font environment; Docker includes Latin/Thai fonts; Thai rendering visually verified |
| Immutable draft author snapshot | Profile-backed and manual creation; profile changes preserve draft bytes; explicit refresh advances revision; stale refresh and published drafts rejected |
| Statement assets | Safe filenames, normalized images, SHA-256, metadata-only list, admin multipart upload/delete |
| Transaction integrity | Concurrent uploads allow one winner; duplicate filename, cross-draft deletion, and 100 MiB aggregate cap preserve revision/readiness on failure |
| Image limits | Raw upload and normalized file caps of 10 MiB; 25 million input pixels; 100 MiB total per draft |

### Final verification

- Backend image built with `backend/Dockerfile`: Node 20, native sharp, PostgreSQL 16 client tools, Fontconfig, DejaVu, and Garuda.
- `npm test -- --runInBand --verbose=false` inside that image with a disposable PostgreSQL 16 database: **41 suites / 299 tests passed, zero skipped, zero failures**.
- TypeScript `npm run build`: passed as part of the image build.
- `git diff --check`: passed.
- Visual inspection reproduced the old Thai missing-glyph box and verified the corrected `ก` avatar after installing Garuda.
- Tests used a separate disposable container, not the local stack database.

The completion checkpoint adds:

- `backend/tests/integration/authoringProfilesAndAssets.test.ts`: eight HTTP → image decoder → service → PostgreSQL scenarios; only DB transport is redirected.
- `backend/tests/services/authoringImageSafety.test.ts`: seven real-decoder cases for animated WebP, excessive pixels, EXIF/ICC removal, and orientation.
- `backend/tests/integration/authorAvatarFonts.test.ts`: Linux font coverage regression; skipped on macOS because its font registry differs.

Reproduction commands are in `README.md`, under Authoring integration tests. The
new profile/asset suite owns a unique schema and removes it afterward. Older
integration suites reset `public`, so the full suite requires a disposable database.

## Slice 4 — Complete

The asynchronous runner protocol is implemented with minimal C++20 compile
fixtures for both solution and generator sources. Full protocol details are in
`AUTHORING_RUNNER.md`; new endpoints are listed in `API_SCHEMA.md`.

- `backend/authoring/`: strict versioned request/result schemas, atomic spool,
  bounded compiler process, isolated runner image and single-consumer entrypoint.
- `backend/services/authoringJob*`: durable queue reservations, revision-safe
  result import, idempotency, timeout/restart reconciliation, and file cleanup.
- `backend/migrations/0003AuthoringJobDelivery.ts`: durable source snapshots and
  a unique active-job-per-draft constraint; pre-protocol active jobs fail explicitly.
- `backend/controllers/authoringJobController.ts`: admin-only enqueue/status APIs;
  authentication, revision conflicts, queue limits, and metadata-only responses.
- `docker-compose.yml`: network-disabled runner with resource limits and a private
  shared spool. Backend startup enables reconciliation through `AUTHORING_JOBS_DIR`.
- `tests/authoring/compose.yml`: disposable database + isolated runner + complete
  backend test suite, independent of the existing local/production stack.
- The contestant judge's include guard was extracted without changing its behavior.

### Final verification

- `docker compose -p oj-authoring-tests -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests`:
  **46 suites / 330 tests passed, zero skipped, zero failures**, exit 0.
  Includes real PostgreSQL, Linux C++ compilation, and HTTP-to-runner success/failure fixtures.
- `npm run build` in backend: passed on host and both Docker image builds.
- `node --test tests/composeConfig.test.mjs`: **5 tests passed**, including local
  and production worker isolation configuration.
- `git diff --check`: passed.
- Regression tests demonstrated failures before fixing canonical UUID snapshot
  identity and connection cleanup after advisory-unlock failure.
- Code review: primary-agent review completed. A separate reviewer was requested
  but could not run because its usage limit was exhausted; no independent-review
  approval is claimed.
- Existing localhost/production services and their databases were not redeployed
  or modified by this verification. Disposable test resources were removed afterward.

## Slice 5 — Complete

Legacy multi-file generator execution and generator-less testcase workflows are
implemented. There is no remaining backend work in the approved Slice 5 scope.
Details and API usage are in `AUTHORING_TESTCASES.md`.

- `backend/authoring/generator.ts`, `sandbox.c`, compiler/process changes: compile
  and run C++20 once in a fresh jail, seed via argv/environment, bounded resources,
  privilege drop, process-group containment and cleanup. Old random_device code works.
- Protocol/spool changes: bounded input manifests, natural sort, exact UTF-8 data,
  root-private atomic artifact delivery and checksum validation before import.
- Job query/coordinator/router changes: generate endpoint, immutable seed/source,
  transactional whole-set replacement, stale/duplicate rejection, readiness invalidation,
  and durable unverified-reproducibility warnings. No algorithm-correctness claims.
- `authoringTestcaseController` and upload/query services: admin-only list/detail,
  individual input/output append/update/delete, ZIP whole-set replacement, optimistic
  revisions, generator-less drafts, private streaming uploads and late-failure rollback.
- ZIP guards: exact EOCD selection, bounded verified central records, safe pairing,
  paths/types/counts/sizes, and lazy per-pair decoding rather than retaining the full set.
- Compose and image changes: static generator runtime helper; executable bounded
  work tmpfs; root-only jail/cleanup capabilities. Contestant judging is unchanged.
- No new database migration is required; existing Slice 1/4 tables support this flow.

### Final verification

- `docker compose -p oj-authoring-tests -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests`:
  **50 suites / 374 tests passed, zero skipped, zero failures**, exit 0.
- Includes real PostgreSQL rollback/concurrency/size-cap tests, real HTTP-to-runner
  seeded generation, and legacy random_device, filesystem and process-limit fixtures.
- The 10 generator runtime tests also passed separately with the deployed runner's
  network-none/read-only/no-new-privileges/capability/1 GiB/256 PID/1 CPU limits.
- `npm run build`: passed locally and in both Docker image builds; native sandbox
  helper compiled with `-Wall -Wextra -Werror`.
- `node --test tests/composeConfig.test.mjs`: **5 tests passed**, local + production policy.
- `git diff --check`: passed.
- Independent review found two ZIP blockers (EOCD parser disagreement and eager memory
  retention). Both were reproduced, fixed, regression-tested, and re-reviewed as resolved;
  the reviewer independently passed 19 testcase unit tests and found no further blocker.
- Runtime tests exposed Docker's default noexec work mount and cleanup permission
  failures. Explicit work `exec` and supervisor-only DAC_OVERRIDE resolved them.
- The original local/production stacks and databases were not redeployed or changed.
  Disposable verification containers/data were removed after testing.

## Next slices

Slice 6 adds reference-solution execution and output generation. Slice 5 does not
generate answers automatically, prove reproducibility, verify algorithms, or make
drafts Ready. PDF/sanitization belongs to Slice 7, mechanical verification to Slice 8,
Publish to Slice 9, and the Admin UI to Slice 10.
