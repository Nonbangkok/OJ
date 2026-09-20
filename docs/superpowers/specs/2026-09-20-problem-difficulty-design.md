# Problem Difficulty — Design

Date: 2026-09-20. Branch: `worktree-new-feature`.
Status: approved by user (chat, 2026-09-20).

## Problem

The `problems` table carries `categories` (closed enum `PROBLEM_CATEGORIES`
in `backend/constants/index.ts`) but has no difficulty field at all. The
target audience spans from children just learning to program to real
competitive programmers. The field will later power (1) difficulty display on
problem pages, (2) filtering/sorting the problem list, and (3) possibly
recommendations / user ratings — so the stored value must be numeric.

## Design decisions (from the user conversation)

1. **Store `difficulty INT NULL`** on a Codeforces-like scale of
   **800–3500, step 100**. Numbers only in the DB — any future tier label
   can be derived with a one-line mapping, and recommendation/rating systems
   need numbers, not tiers.

2. **UI shows only the number, no tier labels** (no Beginner/Medium/…) —
   difficulty is communicated by color, 5 heat-map bands:

   | Range | Color |
   |-------|-------|
   | 800–1100 | green |
   | 1200–1600 | yellow |
   | 1700–2100 | orange |
   | 2200–2700 | red |
   | 2800–3500 | purple |
   | NULL | grey / hidden (Unrated) |

   Color names and hex values must pass WCAG AA contrast in both light and
   dark themes (the system has a `ThemeContext` with `[data-theme='dark']`
   tokens in `frontend/src/index.css`). Band boundaries are declared once as
   shared data — a backend constant (band boundaries) plus mirrored frontend
   CSS custom properties (e.g. `--difficulty-band-1` … `--difficulty-band-5`,
   defined in both `:root` and `[data-theme='dark']` blocks alongside the
   existing `--heatmap-*` tokens), so card and modal use the same tokens.

3. **Validation**: Zod schema in `backend/schemas/requestSchemas.ts` — accepts
   only integers 800–3500 divisible by 100, or null/undefined.

## Scope of changes

- **Migration `backend/migrations/0013ProblemDifficulty.ts`** (numbered after
  the current latest `0012ProblemCategories.ts`) — `ALTER TABLE problems ADD
  COLUMN difficulty INT` (nullable; existing problems keep NULL = Unrated),
  plus the same column on `problem_drafts` and
  `authoring_published_problems` so the authoring publish flow can carry the
  value end-to-end, following the three-table pattern of
  `0012ProblemCategories.ts`. Add a CHECK constraint
  (`difficulty IS NULL OR (difficulty BETWEEN 800 AND 3500 AND difficulty % 100 = 0)`).
  Non-destructive; registered in `backend/migrations/index.ts`.

- **`backend/constants/index.ts`** — add
  `PROBLEM_DIFFICULTY_MIN = 800`, `PROBLEM_DIFFICULTY_MAX = 3500`,
  `PROBLEM_DIFFICULTY_STEP = 100`, and `PROBLEM_DIFFICULTY_BANDS` — an array
  of `{ max: number, band: number }` boundaries expressed as data, plus a
  pure helper `difficultyBand(difficulty: number | null): number | null`
  (null → null). Boundaries as data, not a long if-else chain.

- **`backend/schemas/requestSchemas.ts`** — difficulty field on problem
  create/update schemas and authoring draft schemas: `z.number().int().min(800)
  .max(3500).refine(v => v % 100 === 0).nullable().optional()`.

- **Backend types** (`backend/types/models.ts`, `backend/types/service.ts`)
  — `difficulty: number | null` on problem rows, draft payloads, publish
  payloads, and problem list responses.

- **Backend query/CRUD**: `backend/services/problemQueryService.ts` — include
  `difficulty` in every SELECT/INSERT/UPDATE listed there
  (`getProblemsWithStatsForUser`, `getProblemById`, `createProblem`,
  `updateProblem`, `getAllProblemsAdmin`); support `difficultyMin` /
  `difficultyMax` query filtering and `difficulty` sort (asc/desc) on the
  user-facing problem list, following the existing category filter pattern
  (commit `d98656c`).

- **Authoring publish flow** — `authoringDraftQueryService.ts` (field list
  `categories, time_limit_ms, …` gains `difficulty`),
  `authoringPublishService.ts` (INSERT/UPDATE of `problems` and
  `authoring_published_problems` carry `difficulty`, and the
  "nothing changed" provenance comparison includes it). Follow exactly how
  `categories` flows through these files today.

- **Controllers** — `problemController.ts` / `adminController.ts` /
  authoring controllers: pass the new field through validation and responses
  unchanged.

- **Frontend types** (`frontend/src/types/models.ts`, `service.ts`,
  `api.ts`): `difficulty?: number | null`.

- **Frontend display**:
  - `frontend/src/features/problem/ProblemCard.tsx` — colored difficulty
    number chip next to the categories (uses the shared CSS tokens; null →
    render nothing).
  - `frontend/src/pages/problem/Problems.tsx` — difficulty filter
    (min/max dropdowns or a range control) and sort option. **The filter
    must not exclude Unrated problems while no difficulty filter is
    selected** — the default view stays identical to today.
  - `frontend/src/features/admin/problems/ProblemModal.tsx` — editable
    difficulty field: number dropdown (800…3500 step 100, plus "Unrated")
    or number input with live color preview.
  - `frontend/src/features/admin/authoring/MetadataFields.tsx` — same
    difficulty input for authoring drafts, mirroring how `categories`
    checkboxes are wired (`useAuthoringDraft.ts` editable fields).

## API shape

- Problem responses gain `"difficulty": 1200` or `"difficulty": null`.
- Problem list query params: `difficultyMin`, `difficultyMax` (inclusive,
  optional), `sort=difficulty&order=asc|desc`. When no difficulty params are
  given, Unrated problems appear exactly as before.
- Sort with NULLs: ascending order puts NULL last (use
  `ORDER BY difficulty ASC NULLS LAST`); descending puts NULL last as well
  (`ORDER BY difficulty DESC NULLS LAST`) — rated problems always sort
  before Unrated in both directions.

## Unrated handling (all touchpoints)

- Display: card/modal show nothing (or a muted "Unrated" in admin forms only).
- Filter: `difficultyMin/Max` filter excludes NULL; when no filter selected,
  NULL problems are included (default view unchanged).
- Sort: NULLs last in both directions (see above).

## Testing plan

- **Schema tests**: difficulty validation (valid, out-of-range, non-step-100,
  null, undefined) on problem CRUD and authoring draft schemas, following the
  existing schema test patterns.
- **Migration test**: if migration tests exist, extend; otherwise verify
  manually against a dev DB that existing rows get NULL and the CHECK
  rejects bad values.
- **Backend integration**: problem list filter/sort including NULLS LAST
  behavior and the "no filter → Unrated included" rule; authoring publish
  propagates difficulty draft → problem.
- **Frontend**: extend existing component tests for ProblemCard (chip color
  bands, null hidden) and the admin modal (field saves); update Playwright
  visual baselines only if the problems list appearance changes
  (`npm run test:visual:update`).

## Acceptance criteria

1. `difficulty` column exists on `problems`, `problem_drafts`,
   `authoring_published_problems` with CHECK 800–3500 step 100 (or NULL).
2. API accepts/returns difficulty per the Zod rules above; invalid values
   are rejected with 400.
3. Problems page can filter and sort by difficulty; with no filter selected
   the list is byte-identical to the pre-feature list.
4. ProblemCard shows a colored number chip with 5 color bands passing WCAG
   AA in light and dark themes; Unrated renders no chip.
5. Admin ProblemModal and authoring MetadataFields can set/clear difficulty,
   and publishing a draft propagates it to the published problem.
6. All existing tests plus new ones pass (`backend npm test`,
   `frontend npm run validate`).

## Out of scope

Recommendations, user ratings, auto-calibrating difficulty from submission
statistics, per-contest difficulty overrides.
