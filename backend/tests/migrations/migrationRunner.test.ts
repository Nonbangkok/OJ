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

const loadRunMigrations = (): RunMigrations => {
  const module = require('../../migrations/migrationRunner') as { runMigrations?: RunMigrations };
  expect(module.runMigrations).toBeInstanceOf(Function);
  return module.runMigrations!;
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

    const applied = await loadRunMigrations()(database, migrations);

    expect(applied).toEqual(['0002_problems']);
    expect(calls.map((call) => call.text)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      'CREATE TABLE problems (id TEXT PRIMARY KEY)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'COMMIT',
    ]);
    expect(calls[4].params).toEqual(['0002_problems']);
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

    const applied = await loadRunMigrations()(database, migrations);

    expect(applied).toEqual([]);
    expect(calls).toHaveLength(2);
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

    await expect(loadRunMigrations()(database, migrations)).rejects.toThrow('invalid migration SQL');

    expect(calls.map((call) => call.text)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      migrations[0].sql,
      'ROLLBACK',
    ]);
    expect(calls.some((call) => call.text.includes('INSERT INTO schema_migrations'))).toBe(false);
  });
});
