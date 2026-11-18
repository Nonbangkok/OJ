import { spawnSync } from 'child_process';
import fs from 'fs';
import pg from 'pg';
import { migrations } from '../../migrations';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';

jest.unmock('pg');

// A5-04: submissions.contest_id (migration 0029) must survive the admin
// database export/import, and a dump taken before 0029 must gain the column
// when the import runs the migrations. Needs a disposable database and the
// pg_dump/psql clients (present in the backend image, which is where CI runs
// it); skips otherwise. Like databaseRestore.test.ts it recreates the public
// schema, so run it in band with that suite.
const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const pgToolsAvailable = ['pg_dump', 'psql'].every((tool) => spawnSync(tool, ['--version']).status === 0);
const describeWithDatabase = integrationDatabaseUrl && pgToolsAvailable ? describe : describe.skip;

describeWithDatabase('database export/import keeps the contest link of migrated submissions', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl });
  const dumpPath = `/tmp/oj-restore-contest-link-${process.pid}.sql`;

  afterEach(() => {
    if (fs.existsSync(dumpPath)) {
      fs.unlinkSync(dumpPath);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const pgClient = (tool: 'pg_dump' | 'psql', args: string[]) => {
    const databaseUrl = new URL(integrationDatabaseUrl!);
    const result = spawnSync(tool, [
      '-h', databaseUrl.hostname,
      '-p', databaseUrl.port || '5432',
      '-U', decodeURIComponent(databaseUrl.username),
      '-d', databaseUrl.pathname.slice(1),
      ...args,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) },
    });
    if (result.status !== 0) {
      throw new Error(`${tool} failed: ${result.stderr}`);
    }
  };
  /** The admin export: a plain dump of the whole database (adminSystemService). */
  const exportDatabase = () => pgClient('pg_dump', ['--exclude-table=user_sessions', '-F', 'p', '-f', dumpPath]);
  /** The admin import of a .sql dump: drop the schema, psql the dump, run the migrations. */
  const importDatabase = async () => {
    await dropAllTablesForImport({ query: async (text) => pool.query(text) });
    pgClient('psql', ['-f', dumpPath, '-v', 'ON_ERROR_STOP=1']);
    return runMigrationsFromPool(pool, migrations);
  };
  const seedContestSubmission = async (withContestLink: boolean) => {
    await pool.query(`INSERT INTO users (id, username, password_hash) VALUES (7, 'u7', 'hash')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status)
      VALUES (3, 'Old', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'finished')`);
    await pool.query(`INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('p', 'P', 'a', 1000, 256, true)`);
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES (7, 'p', 'int main(){}', 'cpp', 'Accepted', 100)`,
    );
    if (withContestLink) await pool.query('UPDATE submissions SET contest_id = 3');
  };

  it('A5-04: a dump with contest-linked submissions round-trips, and an older dump gains the column on import', async () => {
    // A dump of the current schema keeps each migrated row's contest and the foreign key.
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrationsFromPool(pool, migrations);
    await seedContestSubmission(true);
    exportDatabase();
    expect(await importDatabase()).toEqual([]);
    expect((await pool.query('SELECT contest_id FROM submissions')).rows).toEqual([{ contest_id: 3 }]);
    await pool.query('DELETE FROM contests WHERE id = 3');
    expect((await pool.query('SELECT contest_id FROM submissions')).rows).toEqual([{ contest_id: null }]);

    // A dump from before migration 0029: the import applies it, old rows stay unlinked.
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrationsFromPool(pool, migrations.filter((m) => m.version !== '0029_submissions_contest_id'));
    await seedContestSubmission(false);
    exportDatabase();
    expect(await importDatabase()).toEqual(['0029_submissions_contest_id']);
    expect((await pool.query('SELECT contest_id FROM submissions')).rows).toEqual([{ contest_id: null }]);
    const index = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_submissions_contest_id'`);
    expect(index.rows).toHaveLength(1);
  });
});
