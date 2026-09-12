type Migration = {
  version: string;
  sql: string;
};

type MigrationClient = {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Array<{ version: string }> }>;
  release: () => void;
};

type MigrationPool = {
  connect: () => Promise<MigrationClient>;
};

type RunMigrationsFromPool = (
  pool: MigrationPool,
  migrations?: readonly Migration[],
) => Promise<string[]>;

const loadCommand = (): RunMigrationsFromPool => {
  const module = require('../../scripts/migrate') as {
    runMigrationsFromPool?: RunMigrationsFromPool;
  };
  expect(module.runMigrationsFromPool).toBeInstanceOf(Function);
  return module.runMigrationsFromPool!;
};

describe('migration command', () => {
  it('uses one acquired connection for the complete migration transaction', async () => {
    const calls: string[] = [];
    let releaseCount = 0;
    const client: MigrationClient = {
      query: async (text) => {
        calls.push(text);
        if (text.startsWith('SELECT version')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {
        releaseCount += 1;
      },
    };
    const pool: MigrationPool = {
      connect: async () => client,
    };
    const migrations = [{ version: '0001_test', sql: 'CREATE TABLE example (id INT)' }];

    const applied = await loadCommand()(pool, migrations);

    expect(applied).toEqual(['0001_test']);
    expect(calls).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      'CREATE TABLE example (id INT)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'COMMIT',
    ]);
    expect(releaseCount).toBe(1);
  });

  it('releases the acquired connection when a migration fails', async () => {
    let releaseCount = 0;
    const failingSql = 'INVALID MIGRATION';
    const client: MigrationClient = {
      query: async (text) => {
        if (text.startsWith('SELECT version')) {
          return { rows: [] };
        }
        if (text === failingSql) {
          throw new Error('migration failed');
        }
        return { rows: [] };
      },
      release: () => {
        releaseCount += 1;
      },
    };
    const pool: MigrationPool = {
      connect: async () => client,
    };

    await expect(loadCommand()(pool, [
      { version: '0001_failure', sql: failingSql },
    ])).rejects.toThrow('migration failed');

    expect(releaseCount).toBe(1);
  });
});
