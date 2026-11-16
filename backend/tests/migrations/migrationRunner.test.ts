type Migration = { version: string; sql: string } | { version: string; concurrentStatements: readonly string[] };

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

const migrations: ReadonlyArray<{ version: string; sql: string }> = [
  { version: '0001_core', sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)' },
  { version: '0002_problems', sql: 'CREATE TABLE problems (id TEXT PRIMARY KEY)' },
];

describe('migration runner', () => {
  it('runs pending migrations in order and records each completed version', async () => {
    const calls: Array<{ text: string; params?: readonly unknown[] }> = [];
    const database: MigrationDatabase = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
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
      'SELECT pg_try_advisory_lock($1) AS locked',
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
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
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
      'SELECT pg_try_advisory_lock($1) AS locked',
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
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
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
      'SELECT pg_try_advisory_lock($1) AS locked',
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

  it('runs a concurrent migration statement by statement outside a transaction, then records it', async () => {
    const calls: string[] = [];
    const database: MigrationDatabase = {
      query: async (text) => {
        calls.push(text);
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
        return { rows: [] };
      },
    };
    const { runMigrations } = loadMigrationRunner();
    const applied = await runMigrations(database, [{
      version: '0003_index',
      concurrentStatements: ['DROP INDEX CONCURRENTLY IF EXISTS idx_x', 'CREATE INDEX CONCURRENTLY idx_x ON t (a)'],
    }]);
    expect(applied).toEqual(['0003_index']);
    expect(calls).toEqual([
      'SELECT pg_try_advisory_lock($1) AS locked',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'DROP INDEX CONCURRENTLY IF EXISTS idx_x',
      'CREATE INDEX CONCURRENTLY idx_x ON t (a)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(calls).not.toContain('BEGIN');
  });

  it('retries a concurrent migration from its first statement when Postgres breaks a deadlock', async () => {
    const calls: string[] = [];
    let failures = 1;
    const database: MigrationDatabase = {
      query: async (text) => {
        calls.push(text);
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
        if (text.startsWith('CREATE INDEX CONCURRENTLY') && failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        }
        return { rows: [] };
      },
    };
    const { runMigrations } = loadMigrationRunner();
    const applied = await runMigrations(database, [{
      version: '0003_index',
      concurrentStatements: ['DROP INDEX CONCURRENTLY IF EXISTS idx_x', 'CREATE INDEX CONCURRENTLY idx_x ON t (a)'],
    }]);
    expect(applied).toEqual(['0003_index']);
    expect(calls.filter((t) => t.startsWith('DROP INDEX'))).toHaveLength(2);
    expect(calls.filter((t) => t.startsWith('CREATE INDEX CONCURRENTLY'))).toHaveLength(2);
  });

  it('gives up on a concurrent migration after repeated deadlocks, and on any other error at once', async () => {
    const { runMigrations } = loadMigrationRunner();
    let creates = 0;
    const deadlocking: MigrationDatabase = {
      query: async (text) => {
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
        if (text.startsWith('CREATE INDEX CONCURRENTLY')) {
          creates += 1;
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        }
        return { rows: [] };
      },
    };
    const migration = { version: '0003_index', concurrentStatements: ['CREATE INDEX CONCURRENTLY idx_x ON t (a)'] };
    await expect(runMigrations(deadlocking, [migration])).rejects.toThrow('deadlock detected');
    expect(creates).toBe(5);

    let otherCalls = 0;
    const broken: MigrationDatabase = {
      query: async (text) => {
        if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] } as never;
        if (text.startsWith('CREATE INDEX CONCURRENTLY')) {
          otherCalls += 1;
          throw Object.assign(new Error('relation "t" does not exist'), { code: '42P01' });
        }
        return { rows: [] };
      },
    };
    await expect(runMigrations(broken, [migration])).rejects.toThrow('does not exist');
    expect(otherCalls).toBe(1);
  });

  it('waits for another migrator by polling the lock, never by blocking inside a statement', async () => {
    jest.useFakeTimers();
    const calls: string[] = [];
    let busy = 2;
    const database: MigrationDatabase = {
      query: async (text) => {
        calls.push(text);
        if (text.startsWith('SELECT pg_try_advisory_lock')) {
          busy -= 1;
          return { rows: [{ locked: busy < 0 }] } as never;
        }
        return { rows: [] };
      },
    };
    const { runMigrations } = loadMigrationRunner();
    const run = runMigrations(database, []);
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(run).resolves.toEqual([]);
    expect(calls.filter((t) => t.startsWith('SELECT pg_try_advisory_lock'))).toHaveLength(3);
    expect(calls).not.toContain('SELECT pg_advisory_lock($1)');
    jest.useRealTimers();
  });
});
