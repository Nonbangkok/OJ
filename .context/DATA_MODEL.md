# Data Model — OJ Grader System

> The memory. Anchors AI in the real database schema to prevent hallucinated relationships.

## Schema Overview

The database contains **11 tables** managed via `backend/scripts/init_db.js`. There is no ORM — all schema is defined as raw SQL DDL.

```mermaid
erDiagram
    users ||--o{ submissions : "submits"
    users ||--o{ contest_participants : "joins"
    users ||--o{ contest_submissions : "submits in contest"
    users ||--o{ contest_scoreboards : "has score in"
    users ||--o{ contests : "creates"

    problems ||--o{ testcases : "has"
    problems ||--o{ submissions : "receives"
    problems }o--o| contests : "assigned to (nullable)"

    contests ||--o{ contest_participants : "has"
    contests ||--o{ contest_submissions : "receives"
    contests ||--o{ contest_scoreboards : "has"
    contests ||--o{ contest_problems : "snapshots"

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

This project uses a **destructive migration** pattern (no incremental migrations):

1. **Schema is defined** in `backend/scripts/init_db.js`.
2. **Running `init_db.js`** drops ALL tables (`DROP ... CASCADE`) and recreates them from scratch.
3. **To add a new table or column:**
   - Add the DDL to `init_db.js` in the appropriate position (respecting FK dependencies).
   - Run `docker-compose exec backend node scripts/init_db.js` (⚠️ destroys all data).
4. **For production changes:** Use manual `ALTER TABLE` statements directly, or export/import the database via the Admin Panel.
5. **No migration framework** (e.g., Knex, Flyway) is currently in use.

> ⚠️ **CAUTION:** Running `init_db.js` on a populated database will irreversibly delete ALL data. Always export a backup first via the Admin Panel's "Export Database" feature.
