# Lessons (Learn) MVP — design

Status: draft for owner review (2026-11-20). Figma: `https://www.figma.com/design/ey0aqI2WZDWPuOODm2k6at/Grader-Design`, page "Lessons MVP · Review" — local Color variables (Light/Dark from `index.css`), components (Icon/*, StatusMark, StripSegment, Button, NavItem, LessonRow, Sidebar Student/Staff), screens (Learn home, Track, Lesson, Lesson mobile, Manage › Lessons) and spec frames (Architecture & flows, Database, API, Files & tests).

## 1. Intent

A USACO-Guide-style learning section inside the grader: ordered tracks → modules → lessons, each lesson a written explanation (Thai, math, C++/Python code) that ends in practice problems judged by our own grader. A student always sees where they are and what is left.

## 2. Goals, non-goals

Goals (MVP)
- Read lessons on `/learn` in PUBLIC mode as a guest, like problem statements.
- Each lesson links to problems in our grader with the user's live status (solved / attempted / not tried) and best testcase strip.
- "Mark as complete" per lesson; per-track and per-module progress.
- Content is authored as Markdown in git, reviewed by PR, imported as one ZIP bundle by staff.

Non-goals (later)
- Run code with custom input, quizzes, interactive visualizations, in-browser lesson editor, prerequisite locking, comments, lesson search in ⌘K (cheap follow-up), external-judge problems.

Anti-goals
- No XP for reading (XP stays "solve problems" only; reading is trivially farmable).
- No copying or translating USACO Guide text; content is our own.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Content lives in the public `Nonbangkok/CP-Author` repo under `lessons/`, built into `lessons-bundle.zip` | Same model as `header-problems/`: versioned, PR review, CI can check links. No authoring UI to build. |
| D2 | Import is all-or-nothing in one transaction, upsert by **slug** | Slugs are the stable identity, so progress survives re-imports. |
| D3 | Markdown → HTML at **import** time with `@oj/statement-renderer` (compile + sanitize + math), HTML stored | Reuses the sanitizer the statements already trust; reads are a single row fetch. |
| D4 | Lesson directives are preprocessed into whitelisted `data-*` markup before compile | Keeps the sanitizer the boundary; no inline script (CSP). |
| D5 | Problem status is **derived** (rewards + submissions), only lesson completion is stored | Single source of truth, like XP. |
| D6 | Lesson problems that are hidden or sit in a running contest render as "unavailable" | `GET /problems/:id` 404s those for non-staff; a lesson must not leak or break. |
| D7 | Code highlight uses the existing `highlight.js` + `styles/codeHighlight.css` | Already themed for light/dark. |
| D8 | UI in English, lesson content in casual Thai | Owner decision 2026-11-20 (§10). |

## 4. Content format (CP-Author `lessons/`, bundle format 1)

Lesson metadata lives in JSON next to the Markdown (no YAML front matter, so the backend needs no YAML parser and every field is validated by one Zod schema). Array order is display order.

```
manifest.json                       { "format": 1, "sourceCommit": "a1b2c3d", "tracks": ["foundations", ...] }
foundations/track.json              { "slug": "foundations", "title": "Foundations", "description": "...", "modules": ["01-complexity", ...] }
foundations/01-complexity/module.json
  { "slug": "complexity", "title": "Complexity", "summary": "...",
    "lessons": [ { "slug": "prefix-sums", "title": "Prefix Sums", "summary": "...", "minutes": 12,
                   "file": "prefix-sums.md",
                   "problems": [ { "id": "P0142", "role": "example" }, { "id": "P0150", "role": "practice" } ],
                   "assets": ["figure-1.png"] } ] }
foundations/01-complexity/prefix-sums.md
foundations/01-complexity/assets/figure-1.png
```

Rules (enforced by `services/lessonBundleReader.ts`): a track folder equals its slug; slugs are lowercase kebab-case ≤ 64; lesson slugs are unique across the whole bundle; strict JSON (unknown keys are errors); assets are .png/.jpg/.jpeg/.webp/.gif checked by magic bytes; every file in the ZIP must be referenced (macOS junk ignored); limits in `constants/lessons.ts` (25 MiB upload, 64 MiB inflated, 200 KB per lesson, 2 MiB per asset, 500 lessons). All content problems are collected with their path so a dry run lists them together.

Markdown body: GFM + `$…$` / `$$…$$` math (KaTeX at import), images as `![alt](assets/figure-1.png)` (must be listed in `assets`). Directives start at column 0, nest up to 3 deep, and are ignored inside fenced code:

| Source | Stored HTML |
|---|---|
| `:::hint [title]` … `:::` | `<details data-lesson="hint"><summary>Hint</summary><div data-lesson="body">` |
| `:::solution [problemId]` … `:::` | `<details data-lesson="solution" data-problem="…"><summary>Solution</summary>…` (collapsed, no gate) |
| `:::note [title]` / `:::warning [title]` … `:::` | `<aside data-lesson="callout" data-tone="note|warning">` |
| `:::tabs` with fenced `cpp` / `python` blocks … `:::` | `<div data-lesson="code-tabs">` |
| `:::problem P0150` (one line) | `<div data-lesson="problem" data-problem="P0150"></div>` — hydrated into a problem card |

Directive lines become placeholder paragraphs before the statement compiler/sanitizer runs and are swapped for the fixed markup above afterwards, so author text never reaches an attribute except a pattern-checked problem id or an escaped title. `h2`/`h3` get `id="section-N"` and form the stored TOC. Images keep the `{{ASSET_BASE}}` placeholder; the client replaces it with `/api/learn/lessons/<slug>/assets`. Problem ids named in `problems` or in directives must exist in the target grader (checked at import).

## 5. Database (migration `0030LessonsSchema.ts`)

```sql
CREATE TABLE lesson_tracks (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  position INT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lesson_modules (
  id SERIAL PRIMARY KEY,
  track_id INT NOT NULL REFERENCES lesson_tracks(id) ON DELETE CASCADE,
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary TEXT,
  position INT NOT NULL,
  UNIQUE (track_id, slug)
);

CREATE TABLE lessons (
  id SERIAL PRIMARY KEY,
  module_id INT NOT NULL REFERENCES lesson_modules(id) ON DELETE CASCADE,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  summary TEXT,
  position INT NOT NULL,
  reading_minutes INT NOT NULL DEFAULT 5 CHECK (reading_minutes > 0),
  source_md TEXT NOT NULL,
  content_html TEXT NOT NULL,
  toc JSONB NOT NULL DEFAULT '[]',     -- [{ id, text, level }]
  content_hash CHAR(64) NOT NULL,       -- sha256 of source + assets, drives "changed" in dry run
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lessons_module ON lessons(module_id, position);

CREATE TABLE lesson_assets (
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  data BYTEA NOT NULL,
  PRIMARY KEY (lesson_id, name)
);

CREATE TABLE lesson_problems (
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  problem_id VARCHAR(50) NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  position INT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('example', 'practice', 'challenge')),
  PRIMARY KEY (lesson_id, problem_id)
);
CREATE INDEX idx_lesson_problems_problem ON lesson_problems(problem_id);

CREATE TABLE lesson_progress (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE lesson_imports (
  id SERIAL PRIMARY KEY,
  imported_by INT REFERENCES users(id) ON DELETE SET NULL,
  bundle_sha256 CHAR(64) NOT NULL,
  source_commit VARCHAR(64),            -- from the bundle manifest
  added INT NOT NULL, changed INT NOT NULL, removed INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Notes
- Removing a lesson from the bundle deletes it (and its progress, by cascade). The dry run lists removals with the number of users whose progress goes with them; the import needs `confirmRemovals=true` when that number is > 0.
- `problems(id)` FK: an import that references a missing problem fails validation (400) before any write.
- Derived per-user problem status: solved = row in `user_problem_rewards`; attempted = any row in `submissions`; best strip = existing best-submission query used by the Problems list.

## 6. Backend

Files
- `migrations/0030LessonsSchema.ts` (+ `migrations/index.ts`)
- `constants/lessons.ts` — `LESSON_LIMITS` (bundle 25 MiB, ≤ 500 lessons, ≤ 200 KB markdown per lesson, ≤ 2 MiB per asset, slug regex), `LESSON_PROBLEM_ROLES`
- `schemas/requestSchemas.ts` — `lessonSlugParams`, `trackSlugParams`, `lessonProgressBody`, `lessonImportQuery`
- `services/lessonMarkdown.ts` — directive preprocessing, `compileStatementSource` + `renderStatementMath`, TOC extraction (pure, unit-tested)
- `services/lessonBundleReader.ts` — ZIP read via `utils/zipEntryReader.ts` (real inflated bytes), manifest/track/module JSON (Zod), asset sniffing, rendering, content hash
- `services/lessonImportService.ts` — validate → diff (dry run) → `db.withTransaction` upsert by slug, delete missing, write `lesson_imports`
- `services/lessonQueryService.ts` — tracks overview (+ next lesson to continue), track detail, lesson detail with problem statuses, assets, and mark / unmark complete (idempotent)
- `controllers/lessonController.ts`, `controllers/adminLessonController.ts`, registered in `app.ts`

API (behind nginx `/api`)

| Method | Route | Auth | Returns |
|---|---|---|---|
| GET | `/learn/tracks` | `requirePublicAccess` | tracks with modules count, lessons count, user's completed count |
| GET | `/learn/tracks/:trackSlug` | `requirePublicAccess` | track + modules + lessons (title, minutes, completed, problems solved/total) |
| GET | `/learn/lessons/:lessonSlug` | `requirePublicAccess` | lesson html, toc, breadcrumb, prev/next, problems `[{ id, title, difficulty, role, status, bestStrip, available }]`, completed |
| GET | `/learn/lessons/:lessonSlug/assets/:name` | `requirePublicAccess` | asset bytes (`Cache-Control`, `X-Content-Type-Options: nosniff`) |
| PUT | `/learn/lessons/:lessonSlug/progress` | `requireAuth` | `{ completed: boolean }` → `{ completed, completedAt }` |
| GET | `/admin/lessons` | `requireStaffOrAdmin` | tracks/lessons table + last 20 imports |
| POST | `/admin/lessons/import?dryRun=1` | `requireStaffOrAdmin` | multipart `bundle` (memory, 25 MiB) → diff `{ added[], changed[], removed[{slug, usersWithProgress}], errors[] }` |
| POST | `/admin/lessons/import` | `requireStaffOrAdmin` | same body (+ `confirmRemovals`) → applies, returns import id + counts |
| PATCH | `/admin/lessons/tracks/:id` | `requireStaffOrAdmin` | `{ isVisible }` |

Rules
- Hidden tracks 404 for non-staff on every `/learn` route (like hidden contests).
- `available=false` for a problem that is hidden or attached to a running/scheduled contest; the row shows no title for non-staff (no leak of contest problem names).
- Import refused (409) while maintenance mode or a database import runs.
- Guests get `status: null` and `completed: null`.

## 7. Frontend

Routes (`App.tsx`, AppShell)
- `/learn` → `pages/learn/LearnHome.tsx`
- `/learn/:trackSlug` → `pages/learn/TrackPage.tsx`
- `/learn/:trackSlug/:lessonSlug` → `pages/learn/LessonPage.tsx`
- `/admin/lessons` → `features/admin/lessons/LessonsAdminPage.tsx`

Sidebar: "Learn" item in Practice (between Home and Problems); Manage → "Lessons" for staff. Mobile tab bar: Learn replaces nothing — it goes under More in MVP.

Components (`features/learn/`)
- `TrackCard` (title, description, ProgressBar, `8 / 14 lessons`, Continue link)
- `ContinueLesson` (first incomplete lesson of the most recently touched track)
- `ModuleSection` → `LessonRow` (StatusMark done / not started, title, minutes, `2/4 solved`)
- `LessonContent` — renders server HTML; a small effect hydrates `data-lesson` nodes: code tabs (highlight.js), problem cards, spoiler `details` analytics-free
- `LessonToc` (on this page, sticky right rail ≥ 1200px, collapsible at top on mobile)
- `LessonProblemTable` (StatusMark, id mono, title, role chip, difficulty, TestcaseStrip; unavailable rows greyed)
- `LessonFooter` (Mark as complete toggle, prev / next)
- `services/learnService.ts` (typed client, covered by the 85/90 coverage gate), `hooks/useLesson.ts`
- Admin: `LessonImportPanel` (FileDrop → dry-run diff table → Confirm import), `LessonImportHistory`

Reused: PageHeader, ProgressBar, StatusMark, TestcaseStrip, DataTable, FileDrop, ConfirmDialog, EmptyState, InlineError, tokens in `index.css`.

## 8. Tests

- Backend: `lessonMarkdown` unit tests (directives, sanitizer keeps only whitelisted `data-*`, TOC), bundle reader limits (zip bomb, path traversal, oversize), import integration (dry run diff, transaction rollback on missing problem, removal confirmation, progress survives re-import), query visibility (hidden track 404, contest problem unavailable, guest nulls), progress idempotency.
- Frontend: learnService tests (coverage gate), LessonPage render (hydrated tabs, spoiler closed by default, unavailable row), visual baselines for `/learn` and a lesson (desktop/mobile).

## 9. Phases

1. Schema + import + read API + seed bundle with 3 lessons. **Status (2026-11-20): built on `feat/lessons-phase1`** — migration 0030, bundle reader, import (dry run / confirm removals), `/learn/*` and `/admin/lessons*` routes; the 3-lesson bundle exists as the test fixture `backend/tests/fixtures/lessonBundle.ts` (the real content and `run.sh build-lessons` belong to CP-Author, phase 3).
2. `/learn` pages + sidebar entry + admin import panel.
3. First real track in CP-Author (5–8 lessons on existing problems), then owner review.

## 10. Owner decisions (2026-11-20)

- **Track names:** our own (Foundations / Data Structures / Graphs …), not the XP tier names.
- **Solutions:** no gate — anyone may open a solution at any time (collapsed by default).
- **Contests:** lesson problems may be added to contests; while attached to a scheduled/running contest the lesson shows the row as "Problem unavailable" (no title for non-staff).
- **Mobile:** Learn sits under More in the tab bar.
- **Language:** every piece of UI chrome (navigation, headings, buttons, labels, statuses, admin import messages, API error messages) is **English**. Only lesson content (the Markdown body, titles and summaries authored in CP-Author) is **Thai**, written in a friendly, casual register (ภาษาเป็นกันเอง) so learners feel at ease. The Figma review page still shows Thai UI labels and needs one pass to switch them to English before Phase 2.
