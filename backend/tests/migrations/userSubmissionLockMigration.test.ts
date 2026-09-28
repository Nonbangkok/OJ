import { migrations } from '../../migrations';
import { runMigrations } from '../../migrations/migrationRunner';

describe('user submission lock migration', () => {
  it('is registered and the runner applies and records it for existing databases', async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const database = {
      query: async (sql: string, params?: readonly unknown[]) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT version')) return { rows: [] };
        return { rows: [] };
      },
    };
    const migration = migrations.find(({ version }) => version === '0023_user_submission_lock');
    expect(migration).toBeDefined();

    await expect(runMigrations(database, [migration!])).resolves.toEqual(['0023_user_submission_lock']);
    expect(calls.map(({ sql }) => sql)).toContain(migration!.sql);
    expect(calls).toContainEqual({
      sql: expect.stringContaining('INSERT INTO schema_migrations'),
      params: ['0023_user_submission_lock'],
    });
    expect(migration!.sql.replace(/\s+/g, ' ')).toContain(
      'ADD COLUMN IF NOT EXISTS submissions_locked BOOLEAN NOT NULL DEFAULT FALSE',
    );
  });
});
