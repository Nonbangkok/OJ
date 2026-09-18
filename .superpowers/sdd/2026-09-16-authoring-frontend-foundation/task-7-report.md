# Task 7 Report: Stabilize the Current Authoring Surface

## Status

Complete and committed as `797869d fix: stabilize authoring layouts and actions`.

## Implementation

- Migrated the current draft-list and author-profile actions to the shared `Button` primitive with explicit primary, secondary, compact, and destructive hierarchy.
- Added a local secondary-action `actionLink` style to the existing Problem Management React Router link without changing its route.
- Kept the New draft form inline and preserved its fields, endpoint, busy handling, labels, and navigation behavior.
- Wrapped the unchanged saved-drafts table in `<OverflowTable label="Saved drafts">`, providing a keyboard-focusable named region while retaining the table caption and row content.
- Added a dedicated profile identity wrapper with the stable `data-profile-identity` measurement hook required by Task 8.
- Added responsive page padding and `width: min(100%, 1200px)`, bounded direct children, stacked top actions with 44 px minimum height at 600 px and below, and a three-column mobile profile-row grid (`2.5rem minmax(0, 1fr) auto`).
- Kept Edit content-sized, allowed editor actions to wrap, and ensured draft cells, profile identity content, IDs, and alert text can wrap instead of forcing page overflow.
- Scoped the legacy Authoring native-button CSS to unclassed buttons so it does not override the shared Button variants.
- Left all routes, API endpoints, labels, tabs, revision behavior, and full-screen statement-editor layout behavior unchanged.
- Applied the repository's Prettier formatting to all six changed files.

## TDD Evidence

### RED

Tests were extended before production code to cover the shared action hierarchy, named overflow region, compact Edit action, profile identity hook, and retry/remove/save/cancel hierarchy.

Command:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: expected failure, exit 1. Two suites ran; 3 tests failed and 19 passed. The failures showed:

- no `region` named `Saved drafts`;
- no `[data-profile-identity]` wrapper; and
- raw Retry profiles action without the required secondary variant.

The Problem Authoring failure output also showed that the existing top actions were raw controls without the new primitive/action styling contract.

### GREEN

After the minimal component migration, the identical command was rerun:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: PASS, 2 suites and 22 tests passed, 0 failures.

The broader Authoring gate was then run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: PASS, 4 suites and 42 tests passed, 0 failures.

## Verification

### Type-check

Command:

```bash
cd frontend && npm run type-check
```

Result: PASS, `tsc --noEmit` exited 0 with no errors. This was rerun after final formatting.

### Changed-file lint

Command:

```bash
cd frontend && npx eslint src/features/admin/authoring/ProblemAuthoring.tsx src/features/admin/authoring/AuthorProfiles.tsx src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: PASS, exit 0 with no output. This was rerun after final formatting. The three repository-wide lint findings ledgered from earlier tasks are outside these changed files and were intentionally not modified.

### Changed-file formatting

Formatting command:

```bash
cd frontend && npx prettier --write src/features/admin/authoring/ProblemAuthoring.tsx src/features/admin/authoring/Authoring.module.css src/features/admin/authoring/AuthorProfiles.tsx src/features/admin/authoring/AuthorProfiles.module.css src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Final check:

```bash
cd frontend && npx prettier --check src/features/admin/authoring/ProblemAuthoring.tsx src/features/admin/authoring/Authoring.module.css src/features/admin/authoring/AuthorProfiles.tsx src/features/admin/authoring/AuthorProfiles.module.css src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: PASS, all matched files use Prettier code style.

### Full frontend suite

Command, run once after final formatting:

```bash
cd frontend && CI=true npm test -- --watchAll=false
```

Result: PASS, 75 suites and 392 tests passed, 0 failures, 0 snapshots.

### Diff integrity

Commands:

```bash
git diff --check
git diff --cached --check
```

Result: both passed with exit 0 and no output.

### Commit

Command:

```bash
git add frontend/src/features/admin/authoring/ProblemAuthoring.tsx frontend/src/features/admin/authoring/Authoring.module.css frontend/src/features/admin/authoring/AuthorProfiles.tsx frontend/src/features/admin/authoring/AuthorProfiles.module.css frontend/src/features/admin/authoring/AuthorProfiles.test.tsx frontend/src/tests/features/admin/ProblemAuthoring.test.tsx && git diff --cached --check && git diff --cached --stat && git commit -m "fix: stabilize authoring layouts and actions"
```

The sandboxed attempt could not create the shared worktree `index.lock`. The identical operation was retried with repository-write approval and succeeded:

```text
[authoring 797869d] fix: stabilize authoring layouts and actions
6 files changed, 1287 insertions(+), 285 deletions(-)
```

## Files Changed

- `frontend/src/features/admin/authoring/ProblemAuthoring.tsx` — shared top/form actions and named `OverflowTable` region.
- `frontend/src/features/admin/authoring/Authoring.module.css` — bounded page, secondary action link, legacy-button scoping, and mobile top-action layout.
- `frontend/src/features/admin/authoring/AuthorProfiles.tsx` — shared profile actions and stable identity measurement hook.
- `frontend/src/features/admin/authoring/AuthorProfiles.module.css` — shrinkable identity content, wrapping, and mobile three-column profile layout.
- `frontend/src/features/admin/authoring/AuthorProfiles.test.tsx` — identity-hook, compact Edit, and action-hierarchy regressions.
- `frontend/src/tests/features/admin/ProblemAuthoring.test.tsx` — named region and draft-list action-hierarchy regressions.

## Self-Review

- Confirmed the New draft UI remains inline; no dialog or later dashboard/workspace redesign was introduced.
- Confirmed `/admin/problems`, `/admin/authoring/drafts`, `/admin/author-profiles`, and `/admin/author-profiles/:id` behavior remains unchanged.
- Confirmed all existing labels used by tests and users remain unchanged.
- Confirmed the shared Button default `type="button"` preserves non-submit behavior, while Create draft and profile save actions explicitly remain submit buttons.
- Confirmed the existing profile saving label remains `Saving profile…` and interaction remains disabled while saving or image processing is pending.
- Confirmed the named overflow region contains the original table, caption, headings, draft links, status, and revision data.
- Confirmed the identity wrapper uses `data-profile-identity` for Task 8 measurement, and no CSS-module class assertion was added to Jest.
- Confirmed the 600 px rule gives the profile row exactly three grid tracks and keeps Edit on the auto track at content width.
- Confirmed the Authoring page does not add document-level horizontal overflow suppression; overflow containment belongs to `OverflowTable`.
- Confirmed no statement-editor component logic, routes, or API/revision behavior changed. Formatting changed CSS presentation only; editor declarations retain their existing values.
- Mutation review: removing `OverflowTable`, replacing the migrated actions with raw buttons, changing their variants/sizing, or removing the measurement hook makes the new focused tests fail.

## Concerns

No blocking concerns. JSDOM cannot validate media-query geometry, so actual mobile row width, identity width, Edit width, and page overflow remain intentionally assigned to Task 8's real-browser tests. The three pre-existing repository-wide lint errors recorded in the task ledger remain outside this task and unchanged.

## Fix Round 1

### Findings addressed

- Restored the scoped `.scroll` rule used by both existing `JobHistory.tsx` tables. It constrains the wrapper to its parent width and provides horizontal overflow containment without changing the component, table markup, or behavior.
- Replaced CSS-module class-name assertions in `AuthorProfiles.test.tsx` and `ProblemAuthoring.test.tsx` with observable role, accessible-name, type, enabled-state, link-target, and cancel/close behavior assertions. The Task 8 `data-profile-identity` hook remains the only identity measurement hook.

### TDD evidence

RED review reproduction (before this fix):

```bash
rg -n "scroll|toHaveClass" frontend/src/features/admin/authoring frontend/src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: `JobHistory.tsx` had two `styles.scroll` consumers while `Authoring.module.css` had no `.scroll` declaration, and both focused test files contained CSS-module `toHaveClass` assertions.

GREEN after the test-first rewrite and minimal CSS fix:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Result: PASS, 2 suites and 22 tests passed, 0 failures.

### Verification

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring src/tests/features/admin/ProblemAuthoring.test.tsx
```

PASS, 4 suites and 42 tests passed.

```bash
cd frontend && npm run type-check
```

PASS, `tsc --noEmit` exited 0.

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/styles/cssModuleIsolation.test.ts
```

PASS, 1 suite and 1 test passed.

```bash
cd frontend && npx eslint src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
cd frontend && npx prettier --check src/features/admin/authoring/Authoring.module.css src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
cd .. && git diff --check
```

PASS, all commands exited 0; Prettier reported all files matched.
