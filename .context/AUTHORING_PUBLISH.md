# Transactional Publish — Slice 9

## API

`POST /admin/authoring/drafts/:id/publish` requires an authenticated **admin** and
a strict JSON body `{ "expectedRevision": 3 }`. No visibility, source or artifact
overrides are accepted. This is a synchronous database transaction, not a runner
job; a previously verified draft can be published while the runner is offline.

First publication returns 201; a verified revision of an already published task
returns 200. Both return only `draftId`, `problemId`, `revision`, `caseCount`,
`publishedAt`, `status: "published"` and the current `isVisible` value. First
publication is hidden. A revision update preserves the existing visibility and
contest association rather than changing either authoring-external setting. Its
legacy metadata must still match the last successful authoring publication,
otherwise nothing is overwritten.

Errors:

- 401 unauthenticated; 403 user/staff; 400 invalid UUID/body/revision.
- 404 `draft_not_found`.
- 409 `draft_published`, `revision_conflict`, `job_active`, `draft_not_ready`,
  `pdf_not_verified`, `invalid_testcases`, `problem_id_conflict`, or
  `published_problem_missing`/`published_problem_mismatch`/
  `published_problem_provenance_missing`.
- Unexpected database errors return the existing generic 500 response; all writes
  roll back. Only the targeted Problem ID conflict is classified as a duplicate.

Existing drafts include their current revision in conflict responses. A repeated
Publish without a new Save/Verify returns409 `draft_published`. A published draft
may start a new cycle only by saving a statement-only revision; that demotes it to
`draft`, retains its original `published_at`, and invalidates readiness. Once that
revision verifies, Publish updates its original legacy problem in place. If a
response is lost, the client can reread the draft to discover publication status.
An ID conflict leaves a first-publication draft ready and the existing grader
problem untouched. A missing legacy row for a revision update also rolls back.

## Transaction and provenance

`backend/services/authoringPublishService.ts` owns one transaction:

1. Lock and reread `problem_drafts` with `FOR UPDATE`.
2. Reject published/stale revisions or any active authoring job.
3. Require `ready`, `verified_revision=revision` and valid stored metadata.
4. Require the latest Verify All job to have succeeded on this revision, with
   `result_summary.verifiedRevision` matching, every required check passed, and
   optional-generator status consistent with the draft.
5. Require the current PDF revision/template/size/SHA-256 to match that verification.
6. Recheck complete pairs, count/size caps, safe filenames, ordered case IDs/numbers
   and total stored bytes against the verification report. Empty expected output
   is valid; NULL output is incomplete. Case-number gaps remain unchanged.
7. For first publication, insert a **new hidden** `problems` row using
   `ON CONFLICT (id) DO NOTHING`. The primary key arbitrates races with other
   drafts and the legacy upload path; no upsert is used.
8. For a statement revision (`published_at` already set), require the original
   legacy metadata snapshot to match before updating that row in place. Retain
   `is_visible` and `contest_id`, delete only its old testcases, then copy the
   verified replacement pairs using
   `INSERT INTO testcases ... SELECT ... ORDER BY case_number`.
   Large testcase strings remain inside PostgreSQL, not a full-set JS allocation.
9. Mark the draft `published`; first publication sets `published_at`, whereas a
   revision update retains that original timestamp. Then commit.

Any failure rolls back the problem, testcase rows and draft state together. A
concurrent Save/testcase edit/queue operation uses the same draft row lock; Publish
therefore either sees the changed revision or wins and leaves a read-only draft.
Concurrent Publish requests on the same draft create exactly one problem. Different
drafts with the same Problem ID have one winner; the other remains ready.

Migration `0006_authoring_published_problem_provenance` records the legacy ID and
metadata snapshot at first publication, and backfills existing published drafts
whose legacy row still exists. It allows an authoring revision to update title,
author and limits while preventing an unrelated legacy edit from being silently
overwritten. The legacy Problem ID itself is permanently locked after first
publication, so the provenance key cannot be redirected.

## Legacy mapping and privacy

| Draft field | Existing grader field |
| --- | --- |
| `problem_id` | `problems.id` |
| `title` | `problems.title` |
| `author_aka_name` | `problems.author` (existing100-character display field) |
| `latest_pdf` | `problems.problem_pdf`, exact verified bytes |
| `time_limit_ms`, `memory_limit_mb` | Same legacy limit fields |
| Draft case number/input/output | Same fields in `testcases`, exact bytes |

First publication explicitly sets `is_visible` false and leaves contest association
NULL. Revision updates preserve both values already managed by the legacy grader.
Neither `solution_cpp` nor `generator_cpp`, raw HTML, source assets, author profile
bytes or job logs are copied to legacy records. The rendered PDF naturally contains
the author header and images. Private sources remain on the published draft for
admin inspection. Existing public/admin problem detail and legacy ZIP export
continue to use only the legacy tables and never include reference/generator code.

Published workspace fields remain read-only. The dedicated statement editor is the
only exception: its statement-only Save begins a revision cycle and leaves the
current legacy problem live until a new Verify and Publish succeed. Ready/Publish
certifies mechanical artifact checks, not algorithm correctness.

## Verification

`backend/tests/integration/authoringPublish.test.ts` runs against a unique disposable
PostgreSQL schema. Tests cover auth/body errors, exact hidden publication and ZIP
privacy, incomplete/stale/missing/corrupt artifacts, repeated/competing publications,
an uncommitted legacy ID insertion, observed Save-lock contention, rollback during
testcase insert and final status update, and real Verify→Publish with the worker.

Run the complete disposable Compose suite from README. Never point integration
tests at user data. This slice does not redeploy or publish any user draft on an
existing local/production stack; all execution tests use temporary fixture data.
The remaining planned slice is Slice10, the Admin UI and full user-facing workflow.
