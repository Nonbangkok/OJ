export const problemCategoriesSql = `
-- A problem can carry several categories at once. TEXT[] with a CHECK
-- constraint replaces the single-category VARCHAR: the category list is a
-- closed set defined in the codebase, so the constraint mirrors it here.
-- Backfill maps the legacy free-text values onto the fixed list
-- (case-sensitive); anything unrecognized becomes an empty array
-- (uncategorized), which admins can set properly from the UI afterwards.

ALTER TABLE problems ADD COLUMN categories TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE problem_drafts ADD COLUMN categories TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE authoring_published_problems ADD COLUMN categories TEXT[] NOT NULL DEFAULT '{}';

UPDATE problems SET categories = CASE LOWER(category)
  WHEN 'dynamic programming' THEN ARRAY['Dynamic Programming']
  WHEN 'greedy' THEN ARRAY['Greedy']
  WHEN 'graph' THEN ARRAY['Graph']
  WHEN 'tree' THEN ARRAY['Tree']
  WHEN 'data structures' THEN ARRAY['Data Structures']
  WHEN 'string' THEN ARRAY['String']
  WHEN 'math' THEN ARRAY['Math']
  WHEN 'geometry' THEN ARRAY['Geometry']
  WHEN 'divide and conquer' THEN ARRAY['Divide and Conquer']
  WHEN 'binary search' THEN ARRAY['Binary Search']
  WHEN 'constructive' THEN ARRAY['Constructive']
  WHEN 'bitmasks' THEN ARRAY['Bitmasks']
  WHEN 'sorting' THEN ARRAY['Sorting']
  WHEN '2d-grid' THEN ARRAY['2D-Grid']
  WHEN 'implementation' THEN ARRAY['Implementation']
  WHEN 'other' THEN ARRAY['Other']
  ELSE '{}'
END
WHERE category IS NOT NULL AND category <> '';

UPDATE problem_drafts SET categories = ARRAY[category]
WHERE category IS NOT NULL AND category <> '';

UPDATE authoring_published_problems SET categories = ARRAY[category]
WHERE category IS NOT NULL AND category <> '';

ALTER TABLE problems DROP COLUMN category;
ALTER TABLE problem_drafts DROP COLUMN category;
ALTER TABLE authoring_published_problems DROP COLUMN category;

ALTER TABLE problems ADD CONSTRAINT problems_categories_check CHECK (categories <@ ARRAY[
  'Dynamic Programming','Greedy','Graph','Tree','Data Structures','String','Math',
  'Geometry','Divide and Conquer','Binary Search','Constructive','Bitmasks',
  'Sorting','2D-Grid','Implementation','Other'
]::text[]);
ALTER TABLE problem_drafts ADD CONSTRAINT problem_drafts_categories_check CHECK (categories <@ ARRAY[
  'Dynamic Programming','Greedy','Graph','Tree','Data Structures','String','Math',
  'Geometry','Divide and Conquer','Binary Search','Constructive','Bitmasks',
  'Sorting','2D-Grid','Implementation','Other'
]::text[]);
ALTER TABLE authoring_published_problems ADD CONSTRAINT authoring_published_problems_categories_check CHECK (categories <@ ARRAY[
  'Dynamic Programming','Greedy','Graph','Tree','Data Structures','String','Math',
  'Geometry','Divide and Conquer','Binary Search','Constructive','Bitmasks',
  'Sorting','2D-Grid','Implementation','Other'
]::text[]);
`;
