import { integrityFixesSql } from '../../migrations/0018IntegrityFixes';

describe('integrity fixes migration (0018)', () => {
  const sql = integrityFixesSql.replace(/\s+/g, ' ').trim();

  it('snapshots pre-contest problem visibility (XSYS-004/CONTEST-006)', () => {
    expect(sql).toContain('ALTER TABLE problems ADD COLUMN is_visible_before_contest BOOLEAN');
  });

  it('enforces case-insensitive username uniqueness (DB-08/AUTH-006)', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (LOWER(username))',
    );
  });

  it('converts user_sessions.expire to timestamptz (DB-09)', () => {
    expect(sql).toContain('ALTER TABLE user_sessions ALTER COLUMN expire TYPE timestamptz');
  });

  it('self-heals published drafts with a missing published_at (DB-12)', () => {
    // Guarded: only rows in status='published' with a NULL timestamp are
    // touched, and COALESCE keeps any non-null value intact.
    expect(sql).toContain('SET published_at = COALESCE(published_at, updated_at)');
    expect(sql).toContain("WHERE status = 'published' AND published_at IS NULL");
  });
});
