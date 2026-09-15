# Data Model — OJ Grader System

> The memory. Anchors AI in the real database schema to prevent hallucinated relationships.

## Schema Overview

The database contains **19 tables**. The 11 legacy application tables are bootstrapped by `backend/scripts/init_db.js`; `schema_migrations` and the 7 authoring tables are managed by the non-destructive migration runner in `backend/migrations/`. There is no ORM — all schema is defined as raw SQL DDL.

Schema status for this revision:
- Migration `0002_problem_authoring_foundation` adds `author_profiles`, `problem_drafts`, `problem_draft_assets`, `problem_draft_testcases`, and `authoring_jobs`.
- Migration `0003_authoring_job_delivery` adds durable request JSON and the partial unique active-job-per-draft index.
- Migration `0004_authoring_job_inputs` adds immutable input snapshots for output-generation jobs.
- Migration `0005_authoring_job_files` adds immutable avatar/asset bytes for PDF jobs.
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

    problems ||--o{ testcases : "has"
    problems ||--o{ submissions : "receives"
    problems }o--o| contests : "assigned to (nullable)"

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

    users {
        SERIAL id PK
        VARCHAR50 username UK
        VARCHAR255 password_hash
        VARCHAR10 role "CHECK (user, staff, admin)"
        TIMESTAMPTZ created_at
    }

    system_settings {
        VARCHAR50 setting_key PK
        VARCHAR255 setting_value
    }

    user_sessions {
        VARCHAR sid PK
        JSON sess
        TIMESTAMP expire
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
        VARCHAR20 language
        VARCHAR50 overall_status
        INT score
        JSONB results
        INT max_time_ms
        INT max_memory_kb
        TIMESTAMPTZ submitted_at
    }

    contests {
        SERIAL id PK
        VARCHAR255 title
        TEXT description
        TIMESTAMPTZ start_time
        TIMESTAMPTZ end_time
        VARCHAR20 status "DEFAULT scheduled"
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
| `username` | `VARCHAR(50)` | UNIQUE, NOT NULL |
| `password_hash` | `VARCHAR(255)` | NOT NULL (bcrypt) |
| `role` | `VARCHAR(10)` | NOT NULL, DEFAULT `'user'`, CHECK `IN ('user', 'staff', 'admin')` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### `system_settings`
Key-value store for system configuration. Currently stores `registration_enabled`.

| Column | Type | Constraints |
|---|---|---|
| `setting_key` | `VARCHAR(50)` | PK |
| `setting_value` | `VARCHAR(255)` | NOT NULL |

### `user_sessions`
PostgreSQL-backed session store (used by `connect-pg-simple`). Managed automatically.

| Column | Type | Constraints |
|---|---|---|
| `sid` | `VARCHAR` | PK |
| `sess` | `JSON` | NOT NULL |
| `expire` | `TIMESTAMP(6)` | NOT NULL |

Application mapping notes:
- Session fields (`userId`, `username`, `role`) are mapped to a typed `req.user` object by `backend/middleware/requestContext.ts`.
- Authentication middleware accepts `req.user` as primary source with session fallback for compatibility in tests.

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

### `submissions`
Global (non-contest) code submissions.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `user_id` | `INT` | FK → `users(id)` ON DELETE SET NULL |
| `problem_id` | `VARCHAR(50)` | FK → `problems(id)` ON DELETE CASCADE ON UPDATE CASCADE |
| `code` | `TEXT` | NOT NULL |
| `language` | `VARCHAR(20)` | NOT NULL (currently only `"cpp"`) |
| `overall_status` | `VARCHAR(50)` | NOT NULL |
| `score` | `INT` | NOT NULL (0–100) |
| `results` | `JSONB` | Per-test-case results array |
| `max_time_ms` | `INT` | Maximum time across all test cases |
| `max_memory_kb` | `INT` | Maximum memory across all test cases |
| `submitted_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### `contests`
Programming contests with scheduled lifecycle.

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | PK |
| `title` | `VARCHAR(255)` | NOT NULL |
| `description` | `TEXT` | NULLABLE |
| `start_time` | `TIMESTAMPTZ` | NOT NULL |
| `end_time` | `TIMESTAMPTZ` | NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL, DEFAULT `'scheduled'` |
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

### `contest_scoreboards`
Aggregated scores per user per contest.

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

Tracks non-destructive migrations that have completed. Migration execution is protected by a PostgreSQL advisory lock.

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
| Problem content | limits, statement HTML, private C++ solution, nullable private C++ generator |
| Generated state | nullable PDF and source revision, template version, revision and verified revision |
| Lifecycle | `draft`, `generated`, `ready`, or `published`; creator and timestamps |

### `problem_draft_assets`

Statement assets keyed by UUID, with a filename unique within each draft. Stores MIME type, normalized bytes, SHA-256 checksum, byte size, and timestamps. Deleting a draft cascades to its assets. Each asset is capped at 10 MiB after normalization and each draft at 100 MiB total; the total is checked while the draft row is locked by the same revision-advancing transaction.

### `problem_draft_testcases`

Draft input/output pairs keyed by UUID and unique `(draft_id, case_number)`. Records original input filename, source (`uploaded` or `generated`), source revision, and timestamps. Output may be NULL while authoring is incomplete.

### `authoring_jobs`

Durable job record for solution/generator compilation, generator execution, output generation, PDF builds, and full verification. Each job captures a draft revision and transitions through the constrained authoring job statuses.

`request_snapshot` is private JSONB containing source, identity, deadline and job-specific
seed, input manifest/limits, or sanitized PDF document/image manifests. Terminal import clears it while preserving the bounded
log and result summary. Only one queued/compiling/running job may exist per draft.

### `authoring_job_inputs`

Durable output-job input bytes, keyed by `(job_id, case_id)`, with unique
`(job_id, case_number)`. Columns: job UUID (FK to `authoring_jobs`, cascade delete),
captured case UUID, positive case number, and UTF-8 `input_data` text. No live-case
foreign key: snapshots survive live testcase changes/deletion. Queueing copies
inputs under the draft lock. Every terminal job path releases snapshot rows;
completed history retains only metadata/hashes, not this extra copy of input text.

### `authoring_job_files`

Durable PDF-job image bytes keyed by `(job_id, name)`. Columns: `job_id` UUID
(FK to `authoring_jobs`, cascade delete), `name` TEXT and `content` BYTEA NOT NULL.
Internal names are `avatar` or `asset:filename`. No link to mutable draft assets;
queueing captures bytes while holding the draft lock. All terminal paths release
these extra snapshots atomically with job completion. PDF bytes remain in
`problem_drafts.latest_pdf`, with provenance in `latest_pdf_revision`.

---

## Key Relationships

| Relationship | Cardinality | Notes |
|---|---|---|
| User → Submissions | 1 : N | `ON DELETE SET NULL` (preserve submissions if user deleted) |
| User → Contest Participation | M : N | Via `contest_participants` join table |
| Problem → Testcases | 1 : N | `ON DELETE CASCADE` (delete testcases with problem) |
| Problem → Submissions | 1 : N | `ON DELETE CASCADE` |
| Problem → Contest | N : 1 (nullable) | `problems.contest_id` — marks problem as part of active contest |
| Contest → Contest Problems | 1 : N | **Snapshot** — data is copied, not referenced |
| Contest → Contest Submissions | 1 : N | Separate from global submissions |
| Contest → Contest Scoreboards | 1 : N | One row per (contest, user) pair |
| Contest → Contest Participants | 1 : N | Tracks join time |
| User → Author Profile | 1 : 0..1 | Optional account link; profile may exist without an account |
| Author Profile → Problem Drafts | 1 : N | Draft stores a point-in-time author snapshot |
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

```json
{
  "problem_a": 100,
  "problem_b": 75,
  "problem_c": 0
}
```

Maps `problem_id` to the user's best score for that problem in the contest.

---

## Database Indexes

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `idx_problems_contest_id` | `problems` | `contest_id` | Fast lookup of contest-assigned problems |
| `idx_contest_submissions_contest_user` | `contest_submissions` | `contest_id, user_id` | Efficient per-user contest submission queries |
| `idx_contest_participants_contest` | `contest_participants` | `contest_id` | Fast participant lookup |
| `idx_contests_status` | `contests` | `status` | Scheduler queries by status |
| `idx_contests_time` | `contests` | `start_time, end_time` | Time-range queries |
| `idx_contest_problems_contest` | `contest_problems` | `contest_id` | Fast problem lookup per contest |
| `idx_contest_scoreboards_score_time` | `contest_scoreboards` | `total_score DESC, last_score_improvement_time ASC` | Scoreboard ranking |

---

## Migration Instructions

Legacy initialization remains destructive, but normal backend startup now uses a **non-destructive migration registry**:

1. `backend/scripts/init_db.js` is only for explicitly rebuilding a development database and still drops legacy tables.
2. `backend/scripts/migrate.ts` creates `schema_migrations`, takes an advisory lock, and applies pending entries from `backend/migrations/index.ts` in order.
3. Backend `start` runs compiled migrations before starting the HTTP server.
4. Every production schema change must be a new immutable migration. Never edit an already-applied migration.
5. Migrations must be idempotent at the registry level and must preserve existing production data.

> ⚠️ **CAUTION:** Running `init_db.js` on a populated database will irreversibly delete data. Use the migration runner for normal local and production upgrades.
