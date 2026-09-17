import { spawnSync } from 'child_process';
import fs from 'fs';
import pg from 'pg';
import { migrations, coreMigrations } from '../../migrations';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';

jest.unmock('pg');

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('database backup and restore', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl });
  const dumpPath = `/tmp/oj-restore-${process.pid}.sql`;

  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrationsFromPool(pool, coreMigrations);
  });

  afterEach(() => {
    if (fs.existsSync(dumpPath)) {
      fs.unlinkSync(dumpPath);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips migration metadata and applies current migrations after restore', async () => {
    await pool.query(`
      INSERT INTO users (username, password_hash)
      VALUES ('restore-sentinel', 'hash')
    `);
    await pool.query(`
      UPDATE system_settings
      SET setting_value = 'false'
      WHERE setting_key = 'registration_enabled'
    `);

    const databaseUrl = new URL(integrationDatabaseUrl!);
    const commonArgs = [
      '-h', databaseUrl.hostname,
      '-p', databaseUrl.port || '5432',
      '-U', decodeURIComponent(databaseUrl.username),
      '-d', databaseUrl.pathname.slice(1),
    ];
    const commandEnvironment = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(databaseUrl.password),
    };

    const dump = spawnSync('pg_dump', [...commonArgs, '-F', 'p', '-f', dumpPath], {
      encoding: 'utf8',
      env: commandEnvironment,
    });
    if (dump.status !== 0) {
      throw new Error(`pg_dump failed: ${dump.stderr}`);
    }

    await pool.query(`
      INSERT INTO users (username, password_hash)
      VALUES ('not-in-backup', 'hash')
    `);

    await dropAllTablesForImport({ query: async (text) => pool.query(text) });
    const tablesAfterDrop = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tablesAfterDrop.rows).toEqual([]);

    // A pre-authoring backup restored over an authoring-era database must not leave
    // orphaned authoring tables behind.
    await runMigrationsFromPool(pool, migrations);
    await pool.query(`
      INSERT INTO author_profiles (aka_name, real_name, default_language, country_code)
      VALUES ('stale-author', 'Stale Author', 'English', 'THA')
    `);
    await dropAllTablesForImport({ query: async (text) => pool.query(text) });
    const tablesAfterSecondDrop = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tablesAfterSecondDrop.rows).toEqual([]);

    const restore = spawnSync('psql', [...commonArgs, '-f', dumpPath, '-v', 'ON_ERROR_STOP=1'], {
      encoding: 'utf8',
      env: commandEnvironment,
    });
    if (restore.status !== 0) {
      throw new Error(`psql restore failed: ${restore.stderr}`);
    }

    await runMigrationsFromPool(pool, coreMigrations);

    const users = await pool.query('SELECT username FROM users ORDER BY username');
    expect(users.rows).toEqual([{ username: 'restore-sentinel' }]);

    const setting = await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = 'registration_enabled'
    `);
    expect(setting.rows).toEqual([{ setting_value: 'false' }]);

    const appliedMigrations = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(appliedMigrations.rows).toEqual([{ version: '0001_core_schema' }]);
  });
});
