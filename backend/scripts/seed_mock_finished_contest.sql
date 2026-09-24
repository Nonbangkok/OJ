-- Mock FINISHED contest with a populated, realistic scoreboard.
-- Idempotent: everything is keyed on the fixed contest title; reruns delete
-- and recreate the mock contest only.
--
-- Shape follows the real post-contest state:
--   * contest row with status 'finished'
--   * contest_participants rows
--   * contest_problems (snapshot copies incl. title/author)
--   * contest_submissions (the submission history users browse)
--   * contest_scoreboards (the FROZEN snapshot finished contests serve —
--     getContestScoreboard reads this table when status = finished)

BEGIN;

DELETE FROM contest_scoreboards WHERE contest_id IN (SELECT id FROM contests WHERE title = 'Mock Finals 2026');
DELETE FROM contest_submissions WHERE contest_id IN (SELECT id FROM contests WHERE title = 'Mock Finals 2026');
DELETE FROM contest_problems WHERE contest_id IN (SELECT id FROM contests WHERE title = 'Mock Finals 2026');
DELETE FROM contest_participants WHERE contest_id IN (SELECT id FROM contests WHERE title = 'Mock Finals 2026');
DELETE FROM contests WHERE title = 'Mock Finals 2026';

INSERT INTO contests (title, description, start_time, end_time, status, created_by)
VALUES (
  'Mock Finals 2026',
  'A finished demo contest with a full scoreboard — 4 problems, 5 participants.',
  NOW() - interval '2 days',
  NOW() - interval '1 day',
  'finished',
  (SELECT id FROM users WHERE username = 'newadmin')
);

-- Participants: newadmin, nova, freya, juno, catzz (all share the demo password)
INSERT INTO contest_participants (contest_id, user_id)
SELECT (SELECT id FROM contests WHERE title = 'Mock Finals 2026'), id FROM users
WHERE username IN ('newadmin', 'nova', 'freya', 'juno', 'catzz');

-- Problem set: sum (has real testcases) plus three visible practice problems.
INSERT INTO contest_problems (contest_id, problem_id, title, author, time_limit_ms, memory_limit_mb)
SELECT (SELECT id FROM contests WHERE title = 'Mock Finals 2026'), p.id, p.title, p.author, p.time_limit_ms, p.memory_limit_mb
FROM problems p
WHERE p.id IN ('sum', 'dfstree', 'dp7', 'lis')
ON CONFLICT DO NOTHING;

-- Submission history: a believable mix per user/problem.
-- nova solved everything; newadmin 3/4; freya 2 solved + 1 partial;
-- juno 1 solved + attempts; catzz attempts only.
INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
VALUES
  -- newadmin: sum AC, dfstree AC, dp7 AC, lis WA-then-partial
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 'sum',      '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '25 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 'dfstree',  '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '90 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 'dp7',      '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '3 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 'lis',      '#include <bits/stdc++.h>', 'cpp', 'Wrong Answer',    0, '[{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '4 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 'lis',      '#include <bits/stdc++.h>', 'cpp', 'Accepted',       60, '[{"status":"Accepted"},{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '5 hours'),

  -- nova: perfect score, all four solved
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='nova'), 'sum',     '#include <bits/stdc++.h>', 'cpp', 'Accepted', 100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '12 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='nova'), 'dfstree', '#include <bits/stdc++.h>', 'cpp', 'Accepted', 100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '45 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='nova'), 'dp7',     '#include <bits/stdc++.h>', 'cpp', 'Accepted', 100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '2 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='nova'), 'lis',     '#include <bits/stdc++.h>', 'cpp', 'Accepted', 100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '4 hours'),

  -- freya: two solved, one partial, one unsolved
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='freya'), 'sum',     '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '30 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='freya'), 'dfstree', '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '2 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='freya'), 'dp7',     '#include <bits/stdc++.h>', 'cpp', 'Wrong Answer',   0, '[{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '3 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='freya'), 'dp7',     '#include <bits/stdc++.h>', 'cpp', 'Accepted',       40, '[{"status":"Accepted"},{"status":"Wrong Answer"},{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '4 hours'),

  -- juno: one solved, one partial attempt
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='juno'), 'sum',     '#include <bits/stdc++.h>', 'cpp', 'Accepted',      100, '[{"status":"Accepted"}]', NOW() - interval '2 days' + interval '20 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='juno'), 'lis',     '#include <bits/stdc++.h>', 'cpp', 'Accepted',       30, '[{"status":"Accepted"},{"status":"Accepted"},{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '5 hours'),

  -- catzz: attempts only, no full solve
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='catzz'), 'sum',    '#include <bits/stdc++.h>', 'cpp', 'Wrong Answer', 0, '[{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '15 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='catzz'), 'sum',    '#include <bits/stdc++.h>', 'cpp', 'Accepted',     50, '[{"status":"Accepted"},{"status":"Wrong Answer"}]', NOW() - interval '2 days' + interval '50 minutes'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='catzz'), 'dfstree','#include <bits/stdc++.h>', 'cpp', 'Time Limit Exceeded', 0, '[{"status":"Time Limit Exceeded"}]', NOW() - interval '2 days' + interval '2 hours');

-- FROZEN scoreboard snapshot (what a finished contest actually serves).
-- detailed_scores mirrors the per-problem best scores above.
INSERT INTO contest_scoreboards (contest_id, user_id, total_score, detailed_scores, last_score_improvement_time)
VALUES
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='nova'), 400,
   '{"sum":{"score":100,"attempts":1,"solved":true},"dfstree":{"score":100,"attempts":1,"solved":true},"dp7":{"score":100,"attempts":1,"solved":true},"lis":{"score":100,"attempts":1,"solved":true}}'::jsonb,
   NOW() - interval '2 days' + interval '4 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='newadmin'), 360,
   '{"sum":{"score":100,"attempts":1,"solved":true},"dfstree":{"score":100,"attempts":1,"solved":true},"dp7":{"score":100,"attempts":1,"solved":true},"lis":{"score":60,"attempts":2,"solved":false}}'::jsonb,
   NOW() - interval '2 days' + interval '5 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='freya'), 240,
   '{"sum":{"score":100,"attempts":1,"solved":true},"dfstree":{"score":100,"attempts":1,"solved":true},"dp7":{"score":40,"attempts":2,"solved":false}}'::jsonb,
   NOW() - interval '2 days' + interval '4 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='juno'), 130,
   '{"sum":{"score":100,"attempts":1,"solved":true},"lis":{"score":30,"attempts":1,"solved":false}}'::jsonb,
   NOW() - interval '2 days' + interval '5 hours'),
  ((SELECT id FROM contests WHERE title = 'Mock Finals 2026'), (SELECT id FROM users WHERE username='catzz'), 50,
   '{"sum":{"score":50,"attempts":2,"solved":false}}'::jsonb,
   NOW() - interval '2 days' + interval '50 minutes');

COMMIT;
