# Problem Authoring Progress

Updated: 2026-09-15. Branch: `authoring`.

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

## Slice 6 — Complete

Reference-solution execution and atomic output generation are implemented and
verified. Details, limits and API usage are in `AUTHORING_OUTPUTS.md`.

- Admin-only `POST /admin/authoring/drafts/:id/jobs/outputs`, expected-revision
  validation, generator-less support and explicit missing-input/source/limit errors.
- `0004_authoring_job_inputs` migration: durable input bytes separate from bounded
  source/manifest JSON; snapshots survive live testcase edits and backend restart.
- Private checksum-validated delivery; compile-once C++20 solution, sequential
  stdin/stdout execution; per-case wall/address-space/output limits and overall deadline.
- Root-private disk staging prevents retaining the full testcase set in process
  memory or work tmpfs. Exact UTF-8 output bytes are preserved; malformed text fails.
- Whole-output-set replacement in one revision-locked transaction; case identity,
  input provenance and order preserved. Failures, corrupt/incomplete results, stale
  revisions, duplicates and concurrent expiry cannot partly replace old outputs.
- First failed case plus trusted wall duration; successful output hashes/sizes and
  per-case durations. All terminal paths release extra DB input snapshots.
- Solution chroot is read-only; socket/namespace/process-group escape is denied.
  Separate process creation is denied for solutions to prevent multiplying memory
  limits; standard threads and existing generator behavior remain supported.
- Documented runner limit: requested memory at most 736 MiB plus existing 32 MiB
  slack. Larger limits are rejected explicitly. No peak-RSS/MLE classification,
  algorithm proof, Ready transition or contestant-judge changes are claimed.

### Final verification

- `docker compose -p oj-authoring-tests -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests`:
  **54 suites / 409 tests passed, zero skipped, zero failures**, exit 0.
- Includes real HTTP → PostgreSQL → isolated runner output generation without a
  generator, migration/restore regressions and the complete pre-existing backend suite.
- **29 solution/generator runtime tests passed** again under the deployed runner's
  exact network-none/read-only/no-new-privileges/capability/1 GiB/256 PID/1 CPU policy.
- TypeScript build passed on host and both Docker images; sandbox C compiled with
  `-Wall -Wextra -Werror`. Compose local/production configuration tests: **5 passed**.
- `git diff --check`: passed. Tests demonstrated missing endpoint/protocol/snapshot
  behavior before implementation and fork isolation before its security fix.
- Independent read-only review found no critical/important blocker. A requested
  concurrent-expiry-during-last-artifact regression was added, passed, and reviewed.
- Full-suite host testing cannot run the `pg_dump` integration on this host; the
  canonical Node 20/PostgreSQL 16 Docker suite above passed it successfully.
- No existing local/production service or user database was redeployed or changed.

## Slice 7 — Complete

Versioned generic PDF generation, statement sanitization and immutable image
snapshots are implemented. Contract and reproduction details: `AUTHORING_PDF.md`.

- Admin-only PDF enqueue and private inline download APIs. HTML fragments retain
  manual sample tables, Thai text, inline/display KaTeX and explicit page breaks.
- Parser-based allowlist rejects executable HTML, arbitrary CSS, external URLs,
  path traversal, missing assets and excessive nesting/size; worker checks again.
- Extracted `red-gate-v1` shell with captured author metadata/avatar, original
  layout and vendored fonts/KaTeX, including provenance and licenses.
- Migration0005 stores immutable avatar/asset bytes independently of live rows.
  Captured source, metadata and images survive subsequent edits/deletions.
- Network-disabled, unprivileged wkhtmltopdf with bounded wall/CPU/address-space,
  file size and logs. Template/image paths are explicitly allowlisted.
- Revision-locked PDF import and terminal snapshot cleanup are atomic. Failed,
  stale, corrupt, duplicate or concurrently expired jobs preserve the old PDF.
- Success installs PDF and its revision, sets `generated` and clears readiness;
  neither solution/generator nor testcases are required to build a statement.

### Final verification

- Canonical disposable Compose suite: **58 suites / 512 tests passed**, zero
  skipped/failures, exit0. Includes HTTP → PostgreSQL → actual isolated PDF runner,
  existing C++ compile/generator/output flows and database migration/restore tests.
- Actual worker-image PDF runtime test: passed with the deployed network-none,
  read-only, capability, 1 CPU / 1 GiB RAM /256 PID policy. Valid Red Gate succeeds;
  malformed KaTeX and unsafe HTML fail without installing an artifact.
- Poppler comparison: **all3 pages pixel-identical** to approved Red Gate fixture
  at909×1286. Every rendered page visually inspected: Thai/fonts/math, image,
  manual sample tables, spacing and page breaks match. Reproducible visual check
  is `node tests/authoring/pdf-visual.mjs`.
- Real runtime checks exposed root-only copied asset permissions and insufficient
  Qt virtual address space. Template read permissions were fixed; PDF-only virtual
  cap is2 GiB while physical container RAM remains1 GiB. Observed Qt loading RSS
  about89 MiB versus about886 MiB reserved address space explains the old768 MiB failure.
- TypeScript build passed on host and Docker; Compose local/production policy
  tests: **5 passed**. `git diff --check` passed.
- Independent read-only review found no critical/important blocker; runtime and
  visual verification above were performed separately by the primary agent.
- npm audit was not run successfully (registry metadata transmission was denied);
  no dependency-security audit clearance is claimed. Builds use `--no-audit`.
- Existing local/production services and user databases were not redeployed or changed.

## Slice 8 — Complete

Mechanical Verify All and revision-safe readiness are implemented. Contract,
reports and limits: `AUTHORING_VERIFY.md`. No Publish or Admin UI work is included.

- Admin-only `POST /admin/authoring/drafts/:id/jobs/verify`, metadata/source/pair
  validation, immutable PDF/input/expected-output/source snapshots, optional generator.
- Existing snapshot tables reused without migration. Expected outputs are private
  binary job files and survive live testcase edits/deletions or backend restart.
- PDF render, one solution compile, optional compile-only generator, sequential
  bounded solution execution, exact current-judge trim/CRLF output comparison.
- No generator execution, input regeneration or expected-output replacement.
  A wrong answer reports the first failed case instead of overwriting the answer.
- Per-stage checks/logs, per-case wall duration, testcase/artifact sizes, PDF
  status, applied verified revision and explicit memory/reproducibility warnings.
- Accepted re-verification clears previous readiness. Successful current jobs
  atomically install their PDF and become ready. Stale, failed, incomplete,
  corrupted, duplicate and expired jobs preserve existing artifacts and cannot ready a draft.
- Deadline is rechecked with database wall-clock time in the final job transition,
  so expiry during PDF import rolls back pending artifact/readiness writes.
- Peak RSS and exact MLE classification remain unavailable, as in Slice6; memory
  is bounded via address-space/container limits. No algorithm proof is claimed.

### Final verification

- Disposable Compose backend suite (Node20/PostgreSQL16/isolated runner):
  **60 suites /533 tests passed**, zero failures or skips, exit0.
- Includes real HTTP-to-runner success with an optional generator, wrong answer
  rejection without testcase replacement, immutable expected bytes, revision
  invalidation, corrupt/incomplete report handling, duplicate/expiry rollback,
  and the full existing compile/generation/PDF/database restore regressions.
- Standalone actual worker runtime matrix: **1 test covering14 verification
  runs passed**, including normalized CRLF/outer whitespace, significant internal
  spaces, first mismatch, no-generator success, compile-only nonterminating
  generator, compile/include/runtime/timeout/output-limit failures, tampered
  expected files, unsafe HTML, cancellation and both compiler diagnostics.
- Runtime matrix used network-none, read-only, no-new-privileges, deployed
  capabilities and1 CPU/1 GiB RAM/256 PID limits. No isolation settings loosened.
- TypeScript build passed on host and both Docker images. Local/production Compose
  configuration tests: **5 passed**. `git diff --check` passed.
- TDD RED observed missing Verify API/worker/protocol before implementation.
  An independent review found a late-expiry race; the real PostgreSQL regression
  failed before its fix and passed afterward. Reviewer confirmed resolution and
  found no additional blocker. A missing generator warning was also regression-tested.
- Existing local/production services and their databases were not redeployed or
  changed. Verification used disposable test resources only.

## Slice 9 — Complete

Transactional Publish is implemented. API, transaction boundaries, legacy mapping
and retry behavior: `AUTHORING_PUBLISH.md`. No Admin UI or deployment is included.

- Admin-only synchronous Publish API with strict expected revision and existing
  authentication/authorization. Requires ready status and successful current
  Verify All provenance, matching PDF hash/template and complete bounded pairs.
- Locks the draft, inserts a new hidden legacy problem, copies exact testcase
  bytes inside PostgreSQL and marks the draft published in one transaction.
- Preserves testcase numbering gaps and empty expected outputs; maps the author
  display name to the existing legacy author field. Contest association stays NULL.
- Duplicate IDs never overwrite another problem. Same-draft/different-draft
  concurrent publication, legacy insertion races and concurrent Save are covered.
- Failures roll back all writes. Published drafts remain read-only; private C++
  sources, raw HTML, source assets and job logs are not copied into legacy records
  or included in the existing grader ZIP export.
- No migration, dependency addition or runner availability requirement for Publish.

### Final verification

- Canonical disposable Compose suite (Node20/PostgreSQL16/isolated runner):
  **61 suites /553 tests passed**, zero failures or skips, exit0.
- Includes **20 Publish integration tests**, real Verify-to-Publish through the
  worker, hidden/public access boundaries, exact ZIP contents and source privacy,
  stale/missing/corrupt artifacts, observed database lock contention and rollback
  after both partial testcase insertion and final draft-status update failure.
- Host Publish tests: **19 passed /1 runner-only skipped**; that runner test passed
  in the full Docker suite. TDD RED was observed before implementation.
- TypeScript build passed on host and both Docker images. Local/production Compose
  configuration tests: **5 passed**. `git diff --check` passed.
- Primary-agent code/diff review completed. Independent reviewer hit its usage
  limit before returning findings; no independent-review clearance is claimed.
- Existing local/production services and user databases were not redeployed or
  changed. Tests published disposable fixtures only, not user drafts.

## Next slices

The remaining planned slice is the Admin UI, Slice 10. Output generation trusts the reference algorithm supplied
by the author; it does not prove algorithm correctness or generator reproducibility.
