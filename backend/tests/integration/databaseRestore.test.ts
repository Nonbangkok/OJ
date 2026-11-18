import { spawnSync } from 'child_process';
import fs from 'fs';
import pg from 'pg';
import { migrations, coreMigrations } from '../../migrations';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';

jest.unmock('pg');

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;
const hasTool = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;
const itWithPgTools = ['psql', 'pg_dump'].every(hasTool) ? it : it.skip;

// The import drop removes every non-system schema of the database it runs
// on, so this suite works on a throwaway database of its own: never the
// shared integration database, whose per-suite schemas other suites use.
describeWithDatabase('database backup and restore', () => {
  const databaseName = `oj_db_restore_${process.pid}`;
  const admin = new pg.Pool({ connectionString: integrationDatabaseUrl });
  const databaseUrl = new URL(integrationDatabaseUrl ?? 'postgres://unused:unused@127.0.0.1:1/unused');
  databaseUrl.pathname = `/${databaseName}`;
  const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
  const dumpPath = `/tmp/oj-restore-${process.pid}.sql`;

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  });

  beforeEach(async () => {
    await pool.query('DROP SCHEMA IF EXISTS extra CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS "Mixed Case" CASCADE');
    await pool.query('DROP PUBLICATION IF EXISTS oj_restore_pub');
    await pool.query('SELECT lo_unlink(oid) FROM pg_largeobject_metadata');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
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
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  });

  it('drops every non-system schema, large object and publication, and leaves one empty public schema (A2-02)', async () => {
    await pool.query('CREATE SCHEMA extra');
    await pool.query('CREATE TABLE extra.notes (id int PRIMARY KEY)');
    await pool.query('CREATE SCHEMA "Mixed Case"');
    await pool.query("SELECT lo_from_bytea(0, 'large object')");
    await pool.query('CREATE PUBLICATION oj_restore_pub FOR TABLE extra.notes');

    await dropAllTablesForImport({ query: async (text) => pool.query(text) });

    const schemas = await pool.query(`
      SELECT nspname FROM pg_namespace
      WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%'
    `);
    expect(schemas.rows).toEqual([{ nspname: 'public' }]);
    const objectsInPublic = await pool.query(`
      SELECT count(*)::int AS count FROM pg_class WHERE relnamespace = 'public'::regnamespace
    `);
    expect(objectsInPublic.rows).toEqual([{ count: 0 }]);
    expect((await pool.query('SELECT count(*)::int AS count FROM pg_largeobject_metadata')).rows).toEqual([{ count: 0 }]);
    expect((await pool.query('SELECT count(*)::int AS count FROM pg_publication')).rows).toEqual([{ count: 0 }]);
  });

  itWithPgTools('round-trips migration metadata and applies current migrations after restore', async () => {
    await pool.query(`
      INSERT INTO users (username, password_hash)
      VALUES ('restore-sentinel', 'hash')
    `);
    await pool.query(`
      UPDATE system_settings
      SET setting_value = 'false'
      WHERE setting_key = 'registration_enabled'
    `);

    const commonArgs = [
      '-h', databaseUrl.hostname,
      '-p', databaseUrl.port || '5432',
      '-U', decodeURIComponent(databaseUrl.username),
      '-d', databaseName,
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
      INSERT INTO author_profiles (id, aka_name, real_name, default_language, country_code)
      VALUES (gen_random_uuid(), 'stale-author', 'Stale Author', 'English', 'THA')
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
