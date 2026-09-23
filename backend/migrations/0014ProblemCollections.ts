export const problemCollectionsSql = `
-- Collections: organizational/teaching groups (Chapter 1, Practice Set, ...)
-- distinct from categories (algorithm topics). A problem belongs to at most
-- one collection; deleting a collection detaches its problems (SET NULL)
-- rather than deleting them.
CREATE TABLE collections (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE problems ADD COLUMN collection_id INT REFERENCES collections(id) ON DELETE SET NULL;

CREATE INDEX idx_problems_collection_id ON problems(collection_id);
`;