export const coreSchemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE TABLE IF NOT EXISTS problems (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(100),
  problem_pdf BYTEA,
  time_limit_ms INT DEFAULT 2000,
  memory_limit_mb INT DEFAULT 256,
  is_visible BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS testcases (
  id SERIAL PRIMARY KEY,
  problem_id VARCHAR(50) REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE,
  case_number INT NOT NULL,
  input_data TEXT NOT NULL,
  output_data TEXT NOT NULL,
  UNIQUE (problem_id, case_number)
);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  problem_id VARCHAR(50) REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE,
  code TEXT NOT NULL,
  language VARCHAR(20) NOT NULL,
  overall_status VARCHAR(50) NOT NULL,
  score INT NOT NULL,
  results JSONB,
  max_time_ms INT,
  max_memory_kb INT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contests (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS contest_id INTEGER REFERENCES contests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS contest_participants (
  contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS contest_submissions (
  id SERIAL PRIMARY KEY,
  contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  problem_id VARCHAR(50) NOT NULL,
  code TEXT NOT NULL,
  language VARCHAR(20) NOT NULL,
  overall_status VARCHAR(50) NOT NULL,
  score INTEGER NOT NULL,
  results JSONB,
  max_time_ms INTEGER,
  max_memory_kb INTEGER,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contest_scoreboards (
  contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total_score INTEGER NOT NULL,
  detailed_scores JSONB,
  last_score_improvement_time TIMESTAMPTZ,
  PRIMARY KEY (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  problem_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(100),
  time_limit_ms INT DEFAULT 2000,
  memory_limit_mb INT DEFAULT 256,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (contest_id, problem_id)
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('registration_enabled', 'true')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_problems_contest_id
  ON problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_contest_user
  ON contest_submissions(contest_id, user_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest
  ON contest_participants(contest_id);
CREATE INDEX IF NOT EXISTS idx_contests_status
  ON contests(status);
CREATE INDEX IF NOT EXISTS idx_contests_time
  ON contests(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_contest_problems_contest
  ON contest_problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_scoreboards_score_time
  ON contest_scoreboards(total_score DESC, last_score_improvement_time ASC);
`;
