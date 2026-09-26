import { contestVisibilitySql } from '../../migrations/0020ContestVisibility';

describe('contest visibility migration', () => {
  it('adds a NOT NULL is_visible column defaulting to TRUE', () => {
    const sql = contestVisibilitySql.replace(/\s+/g, ' ').trim();

    expect(sql).toContain('ALTER TABLE contests');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE');
  });

  it('never backfills or mutates existing contest rows', () => {
    // Only the statement matters — the explanatory comment may name status.
    const statement = contestVisibilitySql.split('ALTER TABLE')[1]?.replace(/\s+/g, ' ').trim() ?? '';

    // Every existing contest must stay visible — no UPDATE, no DELETE.
    expect(statement).not.toMatch(/\bUPDATE\b/);
    expect(statement).not.toMatch(/\bDELETE\b/);
    // Nothing else on the contests row is touched.
    expect(statement).not.toContain('status');
    expect(statement).not.toContain('start_time');
    expect(statement).not.toContain('end_time');
  });
});
