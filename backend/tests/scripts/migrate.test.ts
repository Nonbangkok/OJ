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

type ClosableMigrationPool = MigrationPool & {
  end: () => Promise<void>;
};

type RunMigrationsFromPool = (
  pool: MigrationPool,
  migrations?: readonly Migration[],
) => Promise<string[]>;

type MigrationCommandModule = {
  migrateAndClose?: (
    pool?: ClosableMigrationPool,
    migrations?: readonly Migration[],
  ) => Promise<string[]>;
  runMigrationsFromPool?: RunMigrationsFromPool;
};

const loadCommand = (): MigrationCommandModule => {
  const module = require('../../scripts/migrate') as {
    migrateAndClose?: MigrationCommandModule['migrateAndClose'];
    runMigrationsFromPool?: RunMigrationsFromPool;
  };
  return module;
};

const loadRunMigrationsFromPool = (): RunMigrationsFromPool => {
  const command = loadCommand().runMigrationsFromPool;
  expect(command).toBeInstanceOf(Function);
  return command!;
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

    const applied = await loadRunMigrationsFromPool()(pool, migrations);

    expect(applied).toEqual(['0001_test']);
    expect(calls).toEqual([
      'SELECT pg_advisory_lock($1)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      'CREATE TABLE example (id INT)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'COMMIT',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(releaseCount).toBe(1);
  });

  it('releases the acquired connection when a migration fails', async () => {
    const calls: string[] = [];
    let releaseCount = 0;
    const failingSql = 'INVALID MIGRATION';
    const client: MigrationClient = {
      query: async (text) => {
        calls.push(text);
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

    await expect(loadRunMigrationsFromPool()(pool, [
      { version: '0001_failure', sql: failingSql },
    ])).rejects.toThrow('migration failed');

    expect(calls).toEqual([
      'SELECT pg_advisory_lock($1)',
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      expect.stringContaining('SELECT version'),
      'BEGIN',
      failingSql,
      'ROLLBACK',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(releaseCount).toBe(1);
  });

  it('uses the complete migration registry by default', async () => {
    const calls: Array<{ text: string; params?: readonly unknown[] }> = [];
    const client: MigrationClient = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (text.startsWith('SELECT version')) {
          return { rows: [{ version: '0001_core_schema' }] };
        }
        return { rows: [] };
      },
      release: jest.fn(),
    };
    const pool: MigrationPool = {
      connect: async () => client,
    };

    const applied = await loadRunMigrationsFromPool()(pool);

    expect(applied).toEqual([
      '0002_problem_authoring_foundation',
      '0003_authoring_job_delivery',
      '0004_authoring_job_inputs',
      '0005_authoring_job_files',
      '0006_authoring_published_problem_provenance',
      '0007_problem_category',
      '0008_user_profile',
      '0009_profile_sync',
      '0010_submission_indexes',
      '0011_authoring_draft_category',
      '0012_problem_categories',
      '0013_problem_difficulty',
      '0014_problem_collections',
      '0015_drop_collection_description',
      '0016_user_problem_rewards',
    ]);
    expect(calls).toContainEqual({
      text: expect.stringContaining('CREATE TABLE author_profiles'),
      params: undefined,
    });
    expect(calls).toContainEqual({
      text: expect.stringContaining('INSERT INTO schema_migrations'),
      params: ['0002_problem_authoring_foundation'],
    });
  });

  it('closes the pool after applying migrations', async () => {
    let endCount = 0;
    const client: MigrationClient = {
      query: async (text) => {
        if (text.startsWith('SELECT version')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: jest.fn(),
    };
    const pool: ClosableMigrationPool = {
      connect: async () => client,
      end: async () => {
        endCount += 1;
      },
    };
    const migrateAndClose = loadCommand().migrateAndClose;

    expect(migrateAndClose).toBeInstanceOf(Function);
    await expect(migrateAndClose!(pool, [
      { version: '0001_test', sql: 'CREATE TABLE example (id INT)' },
    ])).resolves.toEqual(['0001_test']);
    expect(endCount).toBe(1);
  });

  it('closes the pool when applying migrations fails', async () => {
    let endCount = 0;
    const client: MigrationClient = {
      query: async (text) => {
        if (text.startsWith('SELECT version')) {
          return { rows: [] };
        }
        if (text === 'INVALID MIGRATION') {
          throw new Error('migration failed');
        }
        return { rows: [] };
      },
      release: jest.fn(),
    };
    const pool: ClosableMigrationPool = {
      connect: async () => client,
      end: async () => {
        endCount += 1;
      },
    };
    const migrateAndClose = loadCommand().migrateAndClose;

    expect(migrateAndClose).toBeInstanceOf(Function);
    await expect(migrateAndClose!(pool, [
      { version: '0001_failure', sql: 'INVALID MIGRATION' },
    ])).rejects.toThrow('migration failed');
    expect(endCount).toBe(1);
  });
});
