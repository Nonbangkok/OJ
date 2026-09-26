# Data Model — OJ Grader System

> The memory. Anchors AI in the real database schema to prevent hallucinated relationships.

## Schema Overview

The database contains **24 tables**. The 11 legacy application tables are bootstrapped by `backend/scripts/init_db.ts` (and `migrations/0001CoreSchema.ts`); `schema_migrations` and the remaining tables are managed by the non-destructive migration runner in `backend/migrations/`. There is no ORM — all schema is defined as raw SQL DDL.

Schema status for this revision (migrations 0001–0020):
- Migration `0002_problem_authoring_foundation` adds `author_profiles`, `problem_drafts`, `problem_draft_assets`, `problem_draft_testcases`, and `authoring_jobs`.
- Migration `0003_authoring_job_delivery` adds durable request JSON and the partial unique active-job-per-draft index.
- Migration `0004_authoring_job_inputs` adds immutable input snapshots for output-generation jobs.
- Migration `0005_authoring_job_files` adds immutable avatar/asset bytes for PDF jobs.
- Migration `0006_authoring_published_problem_provenance` records the original
  legacy problem key and metadata snapshot for safe revision publication.
- Migration `0007` adds `problems.category` (single VARCHAR); `0011` adds the
  same to `problem_drafts`/`authoring_published_problems`; `0012` replaces all
  three with the `categories TEXT[]` array (closed set, CHECK-constrained).
- Migration `0008_user_profile` adds `users.avatar_png` / `avatar_updated_at`.
- Migration `0009_profile_sync` adds `authoring_profile_syncs` / `authoring_profile_sync_items` and the `sync_pdf` job type.
- Migration `0010_submission_indexes` adds user/problem/submitted_at indexes on both submission pools.
- Migration `0013_problem_difficulty` adds nullable `difficulty INT` (800–3500, step 100) to `problems`, `problem_drafts`, `authoring_published_problems`.
- Migration `0014_problem_collections` adds the `collections` table and `problems.collection_id` (0015 later drops the unused `collections.description`).
- Migration `0016_user_problem_rewards` adds the XP progression reward table.
- Migration `0017_site_access_mode` inserts `system_settings.site_access_mode` (default `'public'`).
- Migration `0018_integrity_fixes` adds `problems.is_visible_before_contest`, the case-insensitive unique index `users_username_lower_unique` on `LOWER(username)`, converts `user_sessions.expire` to `timestamptz`, and repairs a NULL `published_at` on published drafts.
- Migration `0019_password_change_enabled` inserts `system_settings.password_change_enabled` (default `'true'`).
- Migration `0020_contest_visibility` adds `contests.is_visible BOOLEAN NOT NULL DEFAULT TRUE`.
- `schema_migrations` serializes and records applied migrations.
- Backend typing around the schema includes:
  - DB row interfaces remain in `backend/types/models.ts`.
  - API DTO contracts were expanded in `backend/types/api.ts`.
  - Runtime request validation schemas were centralized in `backend/schemas/requestSchemas.ts` and reused across all controllers.
  - Reusable projection types (for frequent `SELECT` subsets) were standardized to reduce ad-hoc `Pick<>` usage.
  - Service return/query helper types were centralized in `backend/types/service.ts`.

```mermaid
erDiagram
    users ||--o{ submissions : "submits"
    users ||--o{ contest_participants : "joins"
    users ||--o{ contest_submissions : "submits in contest"
    users ||--o{ contest_scoreboards : "has score in"
    users ||--o{ contests : "creates"
    users ||--o| author_profiles : "optionally owns"
    users ||--o{ problem_drafts : "creates"
    users ||--o{ user_problem_rewards : "earns XP on"

    collections ||--o{ problems : "groups (nullable)"
    problems ||--o{ testcases : "has"
    problems ||--o{ submissions : "receives"
    problems }o--o| contests : "assigned to (nullable)"
    problems ||--o{ user_problem_rewards : "referenced by (no FK)"

    contests ||--o{ contest_participants : "has"
    contests ||--o{ contest_submissions : "receives"
    contests ||--o{ contest_scoreboards : "has"
    contests ||--o{ contest_problems : "snapshots"
    author_profiles ||--o{ problem_drafts : "snapshotted into"
    problem_drafts ||--o{ problem_draft_assets : "contains"
    problem_drafts ||--o{ problem_draft_testcases : "contains"
    problem_drafts ||--o{ authoring_jobs : "runs"
    authoring_jobs ||--o{ authoring_job_inputs : "captures"
    authoring_jobs ||--o{ authoring_job_files : "captures images"
    author_profiles ||--o{ authoring_profile_syncs : "triggers cascade"

    users {
        SERIAL id PK
        VARCHAR50 username UK "case-insensitive unique (0018)"
        VARCHAR255 password_hash
        VARCHAR10 role "CHECK (user, staff, admin)"
        BYTEA avatar_png "nullable (0008)"
        TIMESTAMPTZ avatar_updated_at
        TIMESTAMPTZ created_at
    }

    system_settings {
        VARCHAR50 setting_key PK
        VARCHAR255 setting_value
    }

    user_sessions {
        VARCHAR sid PK
        JSON sess
        TIMESTAMPTZ expire "converted from timestamp (0018)"
    }

    collections {
        SERIAL id PK
        VARCHAR100 name UK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    problems {
        VARCHAR50 id PK
        VARCHAR255 title
        VARCHAR100 author
        BYTEA problem_pdf
        INT time_limit_ms "DEFAULT 2000"
        INT memory_limit_mb "DEFAULT 256"
        BOOLEAN is_visible "DEFAULT false"
        INT contest_id FK "NULLABLE"
        TEXT_ARRAY categories "DEFAULT {} (0012)"
        INT difficulty "NULLABLE 800-3500 (0013)"
        INT collection_id FK "NULLABLE (0014)"
        BOOLEAN is_visible_before_contest "NULLABLE snapshot (0018)"
    }

    testcases {
        SERIAL id PK
        VARCHAR50 problem_id FK
        INT case_number
        TEXT input_data
        TEXT output_data
    }

    submissions {
        SERIAL id PK
        INT user_id FK "ON DELETE SET NULL"
        VARCHAR50 problem_id FK "ON DELETE CASCADE"
        TEXT code
        VARCHAR20 language "cpp | python"
        VARCHAR50 overall_status
        INT score
        JSONB results
        INT max_time_ms
        INT max_memory_kb
        TIMESTAMPTZ submitted_at
    }

    user_problem_rewards {
        SERIAL id PK
        INT user_id FK "ON DELETE CASCADE"
        VARCHAR50 problem_id "NO FK by design"
        INT xp_awarded
        INT difficulty_snapshot
        TIMESTAMPTZ awarded_at
    }

    contests {
        SERIAL id PK
        VARCHAR255 title
        TEXT description
        TIMESTAMPTZ start_time
        TIMESTAMPTZ end_time
        VARCHAR20 status "DEFAULT scheduled"
        BOOLEAN is_visible "DEFAULT TRUE (0020)"
        TIMESTAMPTZ created_at
        INT created_by FK "ON DELETE SET NULL"
    }

    contest_participants {
        INT contest_id PK_FK
        INT user_id PK_FK
        TIMESTAMPTZ joined_at
    }

    contest_submissions {
        SERIAL id PK
        INT contest_id FK
        INT user_id FK "ON DELETE SET NULL"
        VARCHAR50 problem_id
        TEXT code
        VARCHAR20 language
        VARCHAR50 overall_status
        INT score
        JSONB results
        INT max_time_ms
        INT max_memory_kb
        TIMESTAMPTZ submitted_at
    }

    contest_scoreboards {
        INT contest_id PK_FK
        INT user_id PK_FK
        INT total_score
        JSONB detailed_scores
        TIMESTAMPTZ last_score_improvement_time
    }

    contest_problems {
        INT contest_id PK_FK
        VARCHAR50 problem_id PK
        VARCHAR255 title
        VARCHAR100 author
        INT time_limit_ms "DEFAULT 2000"
        INT memory_limit_mb "DEFAULT 256"
        TIMESTAMPTZ created_at
    }
```

---

## Table Details

### `users`
Core user accounts. Three roles enforced via `CHECK` constraint: `user`, `staff`, `admin`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `username` | `VARCHAR(50)` | NOT NULL; unique via `users_username_lower_unique` on `LOWER(username)` (migration 0018 — usernames are unique case-insensitively) |
| `password_hash` | `VARCHAR(255)` | NOT NULL (bcrypt) |
| `role` | `VARCHAR(10)` | NOT NULL, DEFAULT `'user'`, CHECK `IN ('user', 'staff', 'admin')` |
| `avatar_png` | `BYTEA` | NULLABLE (normalized 256×256 PNG, migration 0008) |
| `avatar_updated_at` | `TIMESTAMPTZ` | NULLABLE |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

Deleting a user is transactional and deletes their `user_sessions` rows (so sessions die at the source); submissions are removed explicitly before the account row.

### `system_settings`
Key-value store for system configuration. Current keys: `registration_enabled`, `site_access_mode` (`'public'` | `'private'`, default `'public'`), `password_change_enabled` (`'true'` | `'false'`, default `'true'`). Read through `services/siteSettingsService.ts`.

| Column | Type | Constraints |
|---|---|---|
| `setting_key` | `VARCHAR(50)` | PK |
| `setting_value` | `VARCHAR(255)` | NOT NULL |

### `user_sessions`
PostgreSQL-backed session store (used by `connect-pg-simple`). Managed automatically; excluded from database exports (`pg_dump --exclude-table=user_sessions`).

| Column | Type | Constraints |
|---|---|---|
| `sid` | `VARCHAR` | PK |
| `sess` | `JSON` | NOT NULL |
| `expire` | `TIMESTAMPTZ` | NOT NULL (converted from `timestamp(6)` in migration 0018) |

Application mapping notes:
- Session fields (`userId`, `username`, `role`, `hasAvatar`) are re-synced from the live `users` row on every authenticated request by `revalidateSessionUser`, then mapped to a typed `req.user` object by `backend/middleware/requestContext.ts`. Controllers read `req.user` only, never `req.session`.
- A deleted user's session fields are stripped mid-request; the request proceeds unauthenticated.

### `collections`
Organizational/teaching groups (e.g. "Chapter 1"), distinct from categories (algorithm topics). A problem belongs to at most one collection; deleting a collection detaches its problems (`ON DELETE SET NULL`) rather than deleting them. Collection-wide visibility toggles write the same `problems.is_visible` column the individual toggles use.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `name` | `VARCHAR(100)` | NOT NULL, UNIQUE |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

(A `description` column existed briefly via migration 0014 and was dropped by 0015.)

### `problems`
Programming problems. The PDF is stored as `BYTEA` directly in the database.

| Column | Type | Constraints |
|---|---|---|
| `id` | `VARCHAR(50)` | PK (user-defined slug, e.g., `"plus"`) |
| `title` | `VARCHAR(255)` | NOT NULL |
| `author` | `VARCHAR(100)` | NULLABLE |
| `problem_pdf` | `BYTEA` | NULLABLE |
| `time_limit_ms` | `INT` | DEFAULT `2000` |
| `memory_limit_mb` | `INT` | DEFAULT `256` |
| `is_visible` | `BOOLEAN` | NOT NULL, DEFAULT `false` |
| `contest_id` | `INT` | FK → `contests(id)` ON DELETE SET NULL, NULLABLE |
| `categories` | `TEXT[]` | NOT NULL, DEFAULT `'{}'`, CHECK ⊆ closed 16-value list (migration 0012; replaces the 0007 single `category` VARCHAR) |
| `difficulty` | `INT` | NULLABLE (= Unrated); CHECK `800–3500` in steps of 100 (migration 0013) |
| `collection_id` | `INT` | FK → `collections(id)` ON DELETE SET NULL, NULLABLE (migration 0014) |
| `is_visible_before_contest` | `BOOLEAN` | NULLABLE; snapshot written when a problem is attached to a contest and restored on every contest exit path (migration 0018) |

Renaming a problem id cascades to the non-FK references in `user_problem_rewards`, `authoring_published_problems`, and `problem_drafts` (the service updates them explicitly).

### `testcases`
Input/output pairs for judging.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `problem_id` | `VARCHAR(50)` | FK → `problems(id)` ON DELETE CASCADE ON UPDATE CASCADE |
| `case_number` | `INT` | NOT NULL |
| `input_data` | `TEXT` | NOT NULL |
| `output_data` | `TEXT` | NOT NULL |
| | | UNIQUE(`problem_id`, `case_number`) |

Submissions to a problem with zero testcases are rejected with 400 at submit time.

### `submissions`
Global (non-contest) code submissions.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `user_id` | `INT` | FK → `users(id)` ON DELETE SET NULL |
| `problem_id` | `VARCHAR(50)` | FK → `problems(id)` ON DELETE CASCADE ON UPDATE CASCADE |
| `code` | `TEXT` | NOT NULL |
| `language` | `VARCHAR(20)` | NOT NULL (`"cpp"` or `"python"`) |
| `overall_status` | `VARCHAR(50)` | NOT NULL |
| `score` | `INT` | NOT NULL (0–100) |
| `results` | `JSONB` | Per-test-case results array |
| `max_time_ms` | `INT` | Maximum time across all test cases |
| `max_memory_kb` | `INT` | Maximum memory across all test cases |
| `submitted_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

Indexed on `user_id`, `problem_id`, `submitted_at DESC` (migration 0010).

### `user_problem_rewards`
XP progression: one reward row per unique (user, problem) first solve. The `UNIQUE (user_id, problem_id)` constraint is the double-award guard — concurrent judge completions, rejudges, or replayed pipelines can never create a second reward for the same pair.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `user_id` | `INT` | NOT NULL, FK → `users(id)` ON DELETE CASCADE ON UPDATE CASCADE |
| `problem_id` | `VARCHAR(50)` | NOT NULL — **deliberately NOT a foreign key**: problem deletion must not silently strip earned XP (the reward keeps its snapshot data) |
| `xp_awarded` | `INT` | NOT NULL, CHECK `>= 0` |
| `difficulty_snapshot` | `INT` | NULLABLE (problem difficulty at award time) |
| `awarded_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

Indexes: `idx_user_problem_rewards_user` (award lookup / backfill scan), `idx_user_problem_rewards_user_awarded` (`user_id, awarded_at DESC` — recent-rewards ordering).

Level, tier and global rank are always derived from these rows (`services/progressionService.ts`), never stored. `backend/scripts/backfill_xp.ts` backfills rewards from historical Accepted submissions.

### `contests`
Programming contests with scheduled lifecycle.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `title` | `VARCHAR(255)` | NOT NULL |
| `description` | `TEXT` | NULLABLE |
| `start_time` | `TIMESTAMPTZ` | NOT NULL |
| `end_time` | `TIMESTAMPTZ` | NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL, DEFAULT `'scheduled'` (`scheduled` → `running` → `finishing` → `finished`) |
| `is_visible` | `BOOLEAN` | NOT NULL, DEFAULT `TRUE` (migration 0020 — admin publishing gate, independent from status; hidden contests 404 for non-staff on every public surface) |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `created_by` | `INT` | FK → `users(id)` ON DELETE SET NULL |

### `contest_participants`
Join table: which users have joined which contests.

| Column | Type | Constraints |
|---|---|---|
| `contest_id` | `INT` | PK, FK → `contests(id)` ON DELETE CASCADE |
| `user_id` | `INT` | PK, FK → `users(id)` ON DELETE CASCADE |
| `joined_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### `contest_submissions`
Submissions made within a contest (separate from global `submissions`).

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `contest_id` | `INT` | FK → `contests(id)` ON DELETE CASCADE |
| `user_id` | `INT` | FK → `users(id)` ON DELETE SET NULL |
| `problem_id` | `VARCHAR(50)` | NOT NULL (no FK — references `contest_problems` snapshot) |
| `code` | `TEXT` | NOT NULL |
| `language` | `VARCHAR(20)` | NOT NULL |
| `overall_status` | `VARCHAR(50)` | NOT NULL |
| `score` | `INT` | NOT NULL |
| `results` | `JSONB` | Per-test-case results array |
| `max_time_ms` | `INT` | NULLABLE |
| `max_memory_kb` | `INT` | NULLABLE |
| `submitted_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

Indexed on `user_id`, `problem_id`, `submitted_at DESC`, `contest_id` (migration 0010).

### `contest_scoreboards`
Aggregated scores per user per contest. Written at contest end by the post-contest migration (which drains in-flight judges first and includes zero-submission participants with live-shaped `detailed_scores`).

| Column | Type | Constraints |
|---|---|---|
| `contest_id` | `INT` | PK, FK → `contests(id)` ON DELETE CASCADE |
| `user_id` | `INT` | PK, FK → `users(id)` ON DELETE SET NULL |
| `total_score` | `INT` | NOT NULL |
| `detailed_scores` | `JSONB` | Per-problem score breakdown |
| `last_score_improvement_time` | `TIMESTAMPTZ` | NULLABLE (used for tiebreaking) |

### `contest_problems`
**Snapshot** of problem data at contest creation time. This makes contest problems immutable even if the original problem is edited later.

| Column | Type | Constraints |
|---|---|---|
| `contest_id` | `INT` | PK, FK → `contests(id)` ON DELETE CASCADE |
| `problem_id` | `VARCHAR(50)` | PK (not FK — intentionally decoupled) |
| `title` | `VARCHAR(255)` | NOT NULL |
| `author` | `VARCHAR(100)` | NULLABLE |
| `time_limit_ms` | `INT` | DEFAULT `2000` |
| `memory_limit_mb` | `INT` | DEFAULT `256` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### `schema_migrations`

Tracks non-destructive migrations that have completed. Migration execution is protected by a PostgreSQL advisory lock. Migrations run on a dedicated pool without the 60s statement timeout that the API pool carries.

| Column | Type | Constraints |
|---|---|---|
| `name` | `TEXT` | PK |
| `applied_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

### `author_profiles`

Reusable author identity, independent from login accounts. Profile image bytes are either NULL or canonical 512×512 PNG data.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, application-generated |
| `user_id` | `INT` | UNIQUE, nullable FK → `users(id)` ON DELETE SET NULL |
| `aka_name` | `VARCHAR(100)` | NOT NULL |
| `real_name` | `VARCHAR(255)` | NOT NULL |
| `default_language` | `VARCHAR(50)` | NOT NULL |
| `country_code` | `VARCHAR(3)` | NOT NULL |
| `profile_image_png` | `BYTEA` | NULLABLE, normalized PNG only |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

### `problem_drafts`

Private authoring workspace state. Author display fields and image are snapshots, so later profile edits do not silently change a draft.

| Column group | Notes |
|---|---|
| Identity | UUID `id`, proposed `problem_id`, `title` |
| Author snapshot | nullable `author_profile_id`; AKA, real name, language, country and nullable PNG snapshot. Selecting/refreshing a profile copies its canonical image or a generated fallback PNG; manual authors receive a generated fallback at creation. |
| Problem content | limits, task-pdf-writer Markdown/HTML/LaTeX source (historical `statement_html` name), private C++ solution, nullable private C++ generator |
| Classification | `categories TEXT[]` (closed set, migration 0012), nullable `difficulty INT` (800–3500 step 100, migration 0013) — both carry end-to-end into the published problem and its provenance snapshot |
| Generated state | nullable PDF and source revision, template version, revision and verified revision |
| Lifecycle | `draft`, `generated`, `ready`, or `published`; creator and timestamps |

### `problem_draft_assets`

Statement assets keyed by UUID, with a filename unique within each draft. Stores MIME type, normalized bytes, SHA-256 checksum, byte size, and timestamps. Deleting a draft cascades to its assets. Each asset is capped at 10 MiB after normalization and each draft at 100 MiB total; the total is checked while the draft row is locked by the same revision-advancing transaction.

### `problem_draft_testcases`

Draft input/output pairs keyed by UUID and unique `(draft_id, case_number)`. Records original input filename, source (`uploaded` or `generated`), source revision, and timestamps. Output may be NULL while authoring is incomplete. Bounded by the shared `TESTCASE_LIMITS`: 1,000 cases, 64 MiB per file, 512 MiB per set.

### `authoring_jobs`

Durable job record for solution/generator compilation, generator execution, output generation, PDF builds, full verification, and profile-sync PDF rebuilds (`sync_pdf`). Each job captures a draft revision and transitions through the constrained authoring job statuses.

`request_snapshot` is private JSONB containing source, identity, deadline and job-specific
seed, input manifest/limits, or sanitized PDF document/image manifests. Terminal import clears it while preserving the bounded
log and result summary. Only one queued/compiling/running job may exist per draft.

### `authoring_job_inputs`

Durable output/verification-job input bytes, keyed by `(job_id, case_id)`, with unique
`(job_id, case_number)`. Columns: job UUID (FK to `authoring_jobs`, cascade delete),
captured case UUID, positive case number, and UTF-8 `input_data` text. No live-case
foreign key: snapshots survive live testcase changes/deletion. Queueing copies
inputs under the draft lock. Every terminal job path releases snapshot rows;
completed history retains only metadata/hashes, not this extra copy of input text.

### `authoring_job_files`

Durable PDF-job images and verification expected-output bytes keyed by `(job_id, name)`. Columns: `job_id` UUID
(FK to `authoring_jobs`, cascade delete), `name` TEXT and `content` BYTEA NOT NULL.
Internal names are `avatar`, `asset:filename`, or `output:<case UUID>`. No link to mutable draft assets/testcases;
queueing captures bytes while holding the draft lock. All terminal paths release
these extra snapshots atomically with job completion. PDF bytes remain in
`problem_drafts.latest_pdf`, with provenance in `latest_pdf_revision`.

### `authoring_published_problems`

One row per successfully published draft. It stores the immutable legacy Problem
ID plus the title, author, limits, categories and difficulty from the last authoring
publication. Revision publication requires the live legacy row to still match this
snapshot before it updates PDF/testcases and refreshes the snapshot. This prevents accidental
overwrite after a legacy Problem Management edit while allowing intended metadata
changes made in a new authoring revision.
A successful current, unexpired verification atomically installs PDF and sets
`status='ready'` plus `verified_revision=revision`. An accepted re-verification
clears old readiness.

### `authoring_profile_syncs` / `authoring_profile_sync_items`

One cascade run per confirmed author-profile edit (migration 0009). The run row
(`authoring_profile_syncs`) records status (`queued`/`running`/`succeeded`/`failed`),
result summary, error message and timestamps; each item row
(`authoring_profile_sync_items`) tracks one draft's PDF rebuild (status, attempts,
error). Both cascade from `author_profiles`.

### Publication (Slice9)

Publish itself needs no schema change beyond provenance. The Publish service locks
a current ready draft, validates its latest successful verification/PDF/case
metadata and absence of active jobs, then inserts a new hidden `problems` row plus
exact `testcases` in one transaction.
`author_aka_name` maps to legacy `author`; private C++ source stays in the draft.
Problem ID primary-key conflicts never overwrite existing rows (409
`problem_id_conflict`). On success the draft becomes `published` with
`published_at`, retaining its revision/provenance. Migrated Accepted solves earn
XP inside the same migration transaction. All failures roll back the
three-table write. See `AUTHORING_PUBLISH.md`.

---

## Key Relationships

| Relationship | Cardinality | Notes |
|---|---|---|
| User → Submissions | 1 : N | `ON DELETE SET NULL` at the FK; admin delete removes submissions explicitly in the same transaction |
| User → Contest Participation | M : N | Via `contest_participants` join table |
| User → Problem Rewards | 1 : N | `ON DELETE CASCADE`; XP history |
| Problem → Testcases | 1 : N | `ON DELETE CASCADE` (delete testcases with problem) |
| Problem → Submissions | 1 : N | `ON DELETE CASCADE` |
| Problem → User Rewards | 1 : N | **No FK** — rewards survive problem deletion |
| Problem → Contest | N : 1 (nullable) | `problems.contest_id` — marks problem as part of active contest |
| Problem → Collection | N : 0..1 | `problems.collection_id` — organizational grouping only |
| Contest → Contest Problems | 1 : N | **Snapshot** — data is copied, not referenced |
| Contest → Contest Submissions | 1 : N | Separate from global submissions |
| Contest → Contest Scoreboards | 1 : N | One row per (contest, user) pair; frozen at contest end |
| Contest → Contest Participants | 1 : N | Tracks join time |
| User → Author Profile | 1 : 0..1 | Optional account link; profile may exist without an account |
| Author Profile → Problem Drafts | 1 : N | Draft stores a point-in-time author snapshot |
| Author Profile → Profile Syncs | 1 : N | Confirmed profile edits cascade PDF rebuilds |
| Problem Draft → Assets | 1 : N | `ON DELETE CASCADE` |
| Problem Draft → Draft Testcases | 1 : N | `ON DELETE CASCADE` |
| Problem Draft → Authoring Jobs | 1 : N | Each job captures one draft revision |
| Authoring Job → Captured Inputs | 1 : N | `ON DELETE CASCADE`; no link back to mutable testcase rows |
| Authoring Job → Captured Images | 1 : N | `ON DELETE CASCADE`; no link back to mutable avatar/assets |

---

## JSONB Structures

### `submissions.results` / `contest_submissions.results`

```json
[
  { "testCase": 1, "status": "Accepted", "timeMs": 12.5, "memoryKb": 3400 },
  { "testCase": 2, "status": "Wrong Answer", "timeMs": 8.2, "memoryKb": 3100 },
  { "testCase": 3, "status": "Skipped" }
]
```

Possible `status` values: `Accepted`, `Wrong Answer`, `Time Limit Exceeded`, `Memory Limit Exceeded`, `Runtime Error`, `System Error`, `Skipped`.

### `contest_scoreboards.detailed_scores`

Two shapes exist and readers must accept both:

```json
{ "problem_a": 100, "problem_b": 75 }
```

or the live-shaped form written by post-contest migration and live aggregation:

```json
{ "problem_a": { "score": 100, "attempts": 1, "solved": true } }
```

Maps `problem_id` to the user's best score for that problem in the contest (the frontend normalizes both via `getProblemScore`).

---

## Database Indexes

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `users_username_lower_unique` | `users` | `LOWER(username)` | Case-insensitive username uniqueness (migration 0018) |
| `idx_submissions_user` / `idx_submissions_problem` / `idx_submissions_submitted_at` | `submissions` | `user_id` / `problem_id` / `submitted_at DESC` | Analytics/profile/scoreboard queries (migration 0010) |
| `idx_contest_submissions_user` / `_problem` / `_submitted_at` / `_contest` | `contest_submissions` | same pattern | Same, contest pool |
| `idx_problems_contest_id` | `problems` | `contest_id` | Fast lookup of contest-assigned problems |
| `idx_problems_collection_id` | `problems` | `collection_id` | Collection grouping (migration 0014) |
| `idx_contest_submissions_contest_user` | `contest_submissions` | `contest_id, user_id` | Efficient per-user contest submission queries |
| `idx_contest_participants_contest` | `contest_participants` | `contest_id` | Fast participant lookup |
| `idx_contests_status` | `contests` | `status` | Scheduler queries by status |
| `idx_contests_time` | `contests` | `start_time, end_time` | Time-range queries |
| `idx_contest_problems_contest` | `contest_problems` | `contest_id` | Fast problem lookup per contest |
| `idx_contest_scoreboards_score_time` | `contest_scoreboards` | `total_score DESC, last_score_improvement_time ASC` | Scoreboard ranking |
| `idx_user_problem_rewards_user` | `user_problem_rewards` | `user_id` | Award lookup / backfill scan |
| `idx_user_problem_rewards_user_awarded` | `user_problem_rewards` | `user_id, awarded_at DESC` | Recent-rewards ordering |

---

## Database Import / Export Notes

- Export uses `pg_dump` with `--exclude-table=user_sessions` — sessions are runtime state, never shipped in a backup.
- Import performs `DROP SCHEMA public CASCADE` (complete, not a hand-listed set of tables), runs inside maintenance mode (every other request 503s; the scheduler skips ticks), and is single-flight (a second concurrent import gets 409).

## Migration Instructions

Legacy initialization remains destructive, but normal backend startup now uses a **non-destructive migration registry**:

1. `backend/scripts/init_db.ts` is only for explicitly rebuilding a development database and still drops legacy tables.
2. `backend/scripts/migrate.ts` creates `schema_migrations`, takes an advisory lock, and applies pending entries from `backend/migrations/index.ts` in order. Migrations run on a dedicated pool (`db.createMigrationsPool`) without the API pool's statement timeout.
3. Backend `start` runs compiled migrations before starting the HTTP server; the Compose stack additionally runs a one-shot `migrate` service that the backend waits on.
4. Every production schema change must be a new immutable migration. Never edit an already-applied migration.
5. Migrations must be idempotent at the registry level and must preserve existing production data.

> ⚠️ **CAUTION:** Running `init_db` on a populated database will irreversibly delete data. Use the migration runner for normal local and production upgrades.
