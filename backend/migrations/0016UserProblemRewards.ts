export const userProblemRewardsSql = `
-- XP progression: one reward row per unique (user, problem) first solve.
-- The UNIQUE constraint is the double-award guard: concurrent judge
-- completions, rejudges, or replayed pipelines can never create a second
-- reward for the same pair.
CREATE TABLE IF NOT EXISTS user_problem_rewards (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Deliberately NOT a foreign key: problem deletion must not silently
  -- strip already-earned XP (the reward keeps its snapshot data instead).
  problem_id VARCHAR(50) NOT NULL,
  xp_awarded INT NOT NULL CHECK (xp_awarded >= 0),
  difficulty_snapshot INT,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, problem_id)
);

-- Award lookup (per user) and the historical backfill scan.
CREATE INDEX IF NOT EXISTS idx_user_problem_rewards_user
  ON user_problem_rewards(user_id);
-- History ordering per user (recent rewards list).
CREATE INDEX IF NOT EXISTS idx_user_problem_rewards_user_awarded
  ON user_problem_rewards(user_id, awarded_at DESC);
`;
