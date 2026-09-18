# Published Statement Revision and Editor Controls

## Purpose

Allow an admin to revise a statement after its problem has been published,
without changing the live grader problem until the replacement has a current PDF
and passes Verify All. Improve the statement editor with a user-resizable split
and zoom controls for the realtime preview.

## Scope

This change is intentionally limited to statement revisions initiated from the
full-screen authoring editor. The existing task-pdf-writer hybrid source remains
the realtime preview input. The preview remains HTML rather than a newly-built
PDF; runner-built PDF and Verify All remain authoritative.

The change does not add arbitrary post-publication edits to metadata, reference
solution, generator, testcases, author profiles or assets. Those surfaces remain
read-only for a published draft until a later, separately-designed revision
workflow extends them.

## Published Revision Lifecycle

```
published legacy problem (live, unchanged)
  -> Save a changed statement in the editor
  -> draft status becomes draft; published_at remains non-null
  -> Build PDF + Verify All for this revision
  -> Update published problem
  -> same legacy problem updated transactionally; draft returns to published
```

The first statement save after publication is the only post-publication draft
mutation accepted by the API. It increments `revision`, clears readiness and
demotes the draft to `draft`, but deliberately retains `published_at` as the
signal that the legacy problem already exists. The previous live PDF/testcases
remain visible to contestants until a successful update.

`Update published problem` uses the same current-ready and immutable-artifact
requirements as first-time Publish. It locks the draft, validates the current
PDF/Verify report/cases, updates the existing legacy `problems` row in place and
replaces its testcase set in the same transaction. It preserves `is_visible` and
the problem's contest association. It rejects an absent or mismatched legacy
problem rather than inserting a replacement. Any failure rolls the whole update
back, leaving the live problem unchanged.

First-time Publish remains insert-only and creates a hidden problem. A draft with
non-null `published_at` uses the update path once it becomes ready again.

## API and UI

- `PATCH /admin/authoring/drafts/:id` accepts a published draft only when the
  sole editable field is `statement_html`; all other published-draft updates
  continue to return `draft_published`.
- The detail response continues to expose `publishedAt`; no database migration
  is needed because it already records the original publication.
- `POST /admin/authoring/drafts/:id/publish` returns either a first publish or
  an in-place update result. The Admin UI labels the latter `Update published
  problem` and its confirmation says the existing live problem will be replaced
  only after the verified revision is current.
- In the full-screen editor, a published statement textarea is editable. The
  first saved change returns a normal draft state with a notice that the live
  grader version is still unchanged pending verification/update.
- Other workspace tabs remain read-only while the draft is published. After the
  statement save demotes it to draft, existing authoring permissions and locks
  apply normally.

## Resizable and Zoomable Preview

- Use the already-installed `react-resizable-panels` package for a horizontal
  desktop `PanelGroup`: source, accessible resize handle, preview.
- Default split is 50/50; each side has a 25% minimum. Double-clicking the
  handle resets to 50/50. The chosen split is stored in localStorage per browser
  (not sent to the server). At the existing narrow breakpoint, panes stack and
  the horizontal handle is hidden.
- The preview toolbar exposes zoom out, a percentage indicator, zoom in and
  reset. Zoom is constrained to 50–200% in 10% increments and stored locally.
- The preview's outer viewport scrolls; the sandboxed iframe is scaled from its
  top-left corner at matching inverse dimensions. This preserves its opaque
  origin and avoids access to the compiled document.

## Safety and Failure Handling

- Existing optimistic revision and dirty-source conflict behavior continues to
  protect concurrent edits.
- Save conflicts retain source; Update failures retain the last live problem.
- Preview, panel sizing and zoom failures must never block source editing or
  alter stored task content.
- No preview script permissions are added; `sandbox=""` remains mandatory.

## Verification

Backend tests cover: published statement-only save/demotion; rejection of other
published-field updates; update-vs-create publishing; transaction rollback;
preserved visibility/contest relation; stale/busy/revision failures; and legacy
problem mismatch rejection.

Frontend tests cover: published editor textarea/save status; other published
workspace fields remain locked; update label/confirmation; resize defaults,
minimums/reset and persistence; zoom bounds/reset/persistence; sandbox remains
present; and mobile stacked fallback. Browser validation checks an actual
published fixture through edit, build/verify/update and confirms its existing
grader URL remains the updated in-place problem.
