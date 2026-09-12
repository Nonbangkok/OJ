import pg from 'pg';
import { runMigrations } from '../../migrations/migrationRunner';
import { coreMigrations } from '../../migrations';

jest.unmock('pg');

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('core schema migration', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl });
  const database = {
    query: async (text: string, params?: readonly unknown[]) => {
      const result = await pool.query(text, params as unknown[] | undefined);
      return { rows: result.rows as Array<{ version: string }> };
    },
  };

  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('bootstraps a fresh database and is non-destructive when run again', async () => {
    const firstRun = await runMigrations(database, coreMigrations);
    expect(firstRun).toEqual(['0001_core_schema']);

    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'contest_participants',
      'contest_problems',
      'contest_scoreboards',
      'contest_submissions',
      'contests',
      'problems',
      'schema_migrations',
      'submissions',
      'system_settings',
      'testcases',
      'user_sessions',
      'users',
    ]);

    const contestIdColumn = await pool.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'problems'
        AND column_name = 'contest_id'
    `);
    expect(contestIdColumn.rows).toEqual([{ is_nullable: 'YES' }]);

    await pool.query(`
      UPDATE system_settings
      SET setting_value = 'false'
      WHERE setting_key = 'registration_enabled'
    `);
    await pool.query(`
      DELETE FROM schema_migrations
      WHERE version = '0001_core_schema'
    `);

    const secondRun = await runMigrations(database, coreMigrations);
    const setting = await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = 'registration_enabled'
    `);

    expect(secondRun).toEqual(['0001_core_schema']);
    expect(setting.rows).toEqual([{ setting_value: 'false' }]);

    const thirdRun = await runMigrations(database, coreMigrations);
    expect(thirdRun).toEqual([]);
  });
});
