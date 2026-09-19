# Author Profile Auto-Sync — Design

Date: 2026-09-19. Branch: `worktree-authoring-ux` (post-refactor).
Status: approved by user (chat, 2026-09-19).

## Problem

Today author profiles and problem drafts are deliberately decoupled: a draft
stores an immutable author snapshot; editing a profile does NOT propagate
anywhere until an admin manually refreshes each draft (which bumps its
revision, and is rejected for published drafts). The user wants the opposite
default: a profile edit must automatically update every draft's author
metadata and re-render its PDF — and published problems must get the new
metadata/PDF republished immediately, even while a contest is running.

User decisions (from the design conversation):
- Immediate update in all cases, including problems assigned to running
  contests (author metadata is not considered fairness-relevant).
- A confirmation page/dialog before saving: "this profile will update
  N published problems".
- Active jobs on a draft do not block the sync: sync immediately, but write
  fallbacks for contention/failure.
- Statement source is untouched by sync — therefore no re-Verify needed
  before republish.

## Design (chosen approach: async cascade on the existing durable job queue)

### Confirmation gate on profile update

`PUT /admin/authoring/profiles/:id` (admin-only) gains a two-phase behavior:

1. Request without `confirmed: true` and the profile data actually changes
   the author-relevant fields (aka name, real name, image) → respond
   `200 { confirmation_required: true, affected_drafts: N,
   affected_published_problems: M, profile: {...unchamed current...} }`
   and DO NOT save.
2. Request with `confirmed: true` → save the profile, then enqueue a
   `profile_sync` job for that profile, and respond with the job reference.

Impact calculation: drafts whose `author_profile_snapshot` was taken from
this profile (by profile id, recorded at draft creation/refresh), plus the
published problems originating from those drafts
(`authoring_published_problems` family maps draft → problem).

Frontend: the profile edit dialog fetches impact counts when opened (badge
"linked to N drafts / M published problems"); on save, if impact > 0 show a
confirm step with the counts ("การแก้ไขนี้จะอัปเดต M published problems —
ยืนยัน?"), then re-submit with `confirmed: true`.

### Job mechanics

New job kind `profile_sync` on the existing authoring job infrastructure
(durable reservations, unique active-job-per-draft, boot reconciliation):

- Job input: profile id + the new snapshot bytes.
- Per affected draft, in order:
  1. Update the draft's author snapshot fields (NOT statement source) and
     bump its revision atomically (same transaction).
  2. Submit the PDF render to the runner (existing protocol).
  3. On success: if the draft is published (`published_at` set), republish
     immediately — update the legacy `problems` row metadata + `problem_pdf`
     in one transaction (reuse the post-Slice10 publish path that updates an
     already-published problem; visibility and contest association untouched,
     NO verify requirement because statement source is unchanged).
  4. On failure of any step for a draft: keep that draft's old snapshot/PDF
     (no window where a problem is empty), record the failure reason in the
     job result, continue with the next draft.
- Progress is reported per draft so the existing Jobs tab can show
  "syncing 5/12".

### Fallbacks (three layers)

1. Draft has another active job (e.g. running verify): the
   unique-active-job-per-draft constraint means profile_sync cannot grab that
   draft concurrently. Within the profile_sync job, retry that draft with
   bounded backoff (e.g. up to 5 attempts / 60s); if still contended, record
   it as `deferred` in the result and leave the old snapshot — an admin can
   re-run sync later. The job as a whole still completes.
2. Render/republish failure per draft: old snapshot + old published PDF stay
   live; failure listed in the job result (visible in Jobs tab).
3. Job crash/restart mid-run: existing boot reconciliation (timeout/restart
   recovery from Slice 4) resumes or fails the job cleanly; re-running
   profile_sync is idempotent (same snapshot → same result).

### Revision-conflict UX

A sync bumping a draft's revision can conflict with an admin editing that
draft in the workspace. The existing editor already detects revision
conflicts (Back/Forward recovery work); profile_sync's revision bump must
produce the same conflict signal so the editor offers reload. Fallback if
the editor was mid-unsaved-edit: keep local edits, show a notice that author
metadata changed server-side.

## Testing plan

- Unit (mocked db): impact calculation; confirmation gate (unconfirmed
  changes → no save; no-op changes → save without confirmation); revision
  bump on snapshot update; job result mapping (ok/deferred/failed per draft).
- Integration (disposable Compose stack): real profile edit → job runs
  through the real runner → PDF bytes change (new author name) → published
  problem row updated (metadata + problem_pdf) in one observable state;
  fallback case A (draft busy with another job → deferred); fallback case B
  (runner failure for one draft → others still sync); idempotent re-run.
- Frontend (jest): edit dialog impact badge + confirm step; Jobs tab renders
  profile_sync kind; editor conflict notice on revision bump.
- Visual: no new baselines needed (dialog changes only add a confirm step
  text; if pixels of the authoring shell change, regenerate).

## Out of scope

- Syncing statement source (never — profile sync touches author metadata only).
- Special judge / alternate checkers (separate feature).
- Live-reference architecture (drafts referencing profiles directly) —
  explicitly rejected in favor of snapshot + sync.
