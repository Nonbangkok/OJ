type Migration = {
  version: string;
  sql: string;
};

type MigrationDatabase = {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Array<{ version: string }> }>;
};

type RunMigrations = (
  database: MigrationDatabase,
  migrations: readonly Migration[],
) => Promise<string[]>;

type MigrationRunnerModule = {
  runMigrations?: RunMigrations;
  SCHEMA_MIGRATION_LOCK_ID?: number;
};

const loadMigrationRunner = (): Required<MigrationRunnerModule> => {
  const module = require('../../migrations/migrationRunner') as MigrationRunnerModule;
  expect(module.runMigrations).toBeInstanceOf(Function);
  expect(module.SCHEMA_MIGRATION_LOCK_ID).toBe(734001);
  return module as Required<MigrationRunnerModule>;
};

const migrations: readonly Migration[] = [
  { version: '0001_core', sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)' },
  { version: '0002_problems', sql: 'CREATE TABLE problems (id TEXT PRIMARY KEY)' },
];

describe('migration runner', () => {
  it('runs pending migrations in order and records each completed version', async () => {
    const calls: Array<{ text: string; params?: readonly unknown[] }> = [];
    const database: MigrationDatabase = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (text.startsWith('SELECT version')) {
          return { rows: [{ version: '0001_core' }] };
        }
        return { rows: [] };
      },
    };

    const { runMigrations, SCHEMA_MIGRATION_LOCK_ID } = loadMigrationRunner();
    const applied = await runMigrations(database, migrations);

    expect(applied).toEqual(['0002_problems']);
    expect(calls.map((call) => call.text)).toEqual([
      'SELECT pg_advisory_lock($1)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      'CREATE TABLE problems (id TEXT PRIMARY KEY)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'COMMIT',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(calls[0].params).toEqual([SCHEMA_MIGRATION_LOCK_ID]);
    expect(calls[5].params).toEqual(['0002_problems']);
    expect(calls[7].params).toEqual([SCHEMA_MIGRATION_LOCK_ID]);
  });

  it('does nothing when every migration version is already recorded', async () => {
    const calls: string[] = [];
    const database: MigrationDatabase = {
      query: async (text) => {
        calls.push(text);
        if (text.startsWith('SELECT version')) {
          return { rows: migrations.map(({ version }) => ({ version })) };
        }
        return { rows: [] };
      },
    };

    const { runMigrations } = loadMigrationRunner();
    const applied = await runMigrations(database, migrations);

    expect(applied).toEqual([]);
    expect(calls).toEqual([
      'SELECT pg_advisory_lock($1)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'SELECT pg_advisory_unlock($1)',
    ]);
  });

  it('rolls back a failed migration and never records its version', async () => {
    const calls: Array<{ text: string; params?: readonly unknown[] }> = [];
    const database: MigrationDatabase = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (text.startsWith('SELECT version')) {
          return { rows: [] };
        }
        if (text === migrations[0].sql) {
          throw new Error('invalid migration SQL');
        }
        return { rows: [] };
      },
    };

    const { runMigrations, SCHEMA_MIGRATION_LOCK_ID } = loadMigrationRunner();
    await expect(runMigrations(database, migrations)).rejects.toThrow('invalid migration SQL');

    expect(calls.map((call) => call.text)).toEqual([
      'SELECT pg_advisory_lock($1)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      migrations[0].sql,
      'ROLLBACK',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(calls.some((call) => call.text.includes('INSERT INTO schema_migrations'))).toBe(false);
    expect(calls.at(-1)?.params).toEqual([SCHEMA_MIGRATION_LOCK_ID]);
  });
});
