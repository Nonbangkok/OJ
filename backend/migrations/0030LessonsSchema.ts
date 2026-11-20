/**
 * Lessons (Learn) MVP — docs/superpowers/specs/2026-11-20-lessons-mvp-design.md §5.
 *
 * Tracks → modules → lessons, imported from a CP-Author bundle (one
 * transaction per import, upsert by slug). Lesson HTML is rendered and
 * sanitized at import time and stored next to its Markdown source.
 *
 * Only lesson completion is stored per user (lesson_progress); problem
 * status shown in a lesson is derived from user_problem_rewards and
 * submissions, like everywhere else. lesson_problems follows problem renames
 * (ON UPDATE CASCADE, like submissions) and drops the link when a problem is
 * deleted.
 */
export const lessonsSchemaSql = `
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
  reading_minutes INT NOT NULL CHECK (reading_minutes > 0),
  source_md TEXT NOT NULL,
  content_html TEXT NOT NULL,
  toc JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash CHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lessons_module_position ON lessons(module_id, position);

CREATE TABLE lesson_assets (
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  data BYTEA NOT NULL,
  PRIMARY KEY (lesson_id, name)
);

CREATE TABLE lesson_problems (
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  problem_id VARCHAR(50) NOT NULL REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('example', 'practice', 'challenge')),
  PRIMARY KEY (lesson_id, problem_id)
);
CREATE INDEX idx_lesson_problems_problem ON lesson_problems(problem_id);

CREATE TABLE lesson_progress (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX idx_lesson_progress_lesson ON lesson_progress(lesson_id);
CREATE INDEX idx_lesson_progress_user_completed ON lesson_progress(user_id, completed_at DESC);

CREATE TABLE lesson_imports (
  id SERIAL PRIMARY KEY,
  imported_by INT REFERENCES users(id) ON DELETE SET NULL,
  bundle_sha256 CHAR(64) NOT NULL,
  source_commit VARCHAR(64),
  added INT NOT NULL,
  changed INT NOT NULL,
  removed INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
