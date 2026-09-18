export const authoringPublishedProblemProvenanceSql = `
CREATE TABLE authoring_published_problems (
  draft_id UUID PRIMARY KEY REFERENCES problem_drafts(id) ON DELETE CASCADE,
  problem_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(100),
  time_limit_ms INT NOT NULL,
  memory_limit_mb INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing published drafts become revision-capable without changing their live
-- legacy records. A missing legacy row deliberately has no provenance and will
-- be rejected instead of being recreated by a later revision publish.
INSERT INTO authoring_published_problems
  (draft_id,problem_id,title,author,time_limit_ms,memory_limit_mb)
SELECT d.id,p.id,p.title,p.author,p.time_limit_ms,p.memory_limit_mb
FROM problem_drafts d
JOIN problems p ON p.id=d.problem_id
WHERE d.published_at IS NOT NULL
ON CONFLICT (draft_id) DO NOTHING;
`;
