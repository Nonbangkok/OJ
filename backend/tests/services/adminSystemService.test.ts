import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from '../../services/adminSystemService';

import {
  buildDatabaseArchiveCheckCommand,
  buildDatabaseSafetyCopyCommand,
  buildDatabaseSafetyRestoreCommand,
} from '../../services/adminSystemService';

const connection = {
  databaseName: 'oj_db',
  databaseUser: 'postgres',
  databaseHost: 'db',
  databasePort: '5432',
  databasePassword: 'secret',
};

describe('import safety commands (A2-02)', () => {
  it('checks an archive with pg_restore --list, without connecting or credentials', () => {
    expect(buildDatabaseArchiveCheckCommand('/tmp/up.dump')).toEqual({
      executable: 'pg_restore',
      args: ['--list', '/tmp/up.dump'],
      env: {},
    });
  });

  it('takes a full custom-format safety copy (sessions included, subscriptions left out like the drop leaves them)', () => {
    expect(buildDatabaseSafetyCopyCommand('/tmp/oj-db-import-x/pre-import.dump', connection)).toEqual({
      executable: 'pg_dump',
      args: ['-h', 'db', '-p', '5432', '-U', 'postgres', '-d', 'oj_db', '--no-subscriptions', '-F', 'c', '-f', '/tmp/oj-db-import-x/pre-import.dump'],
      env: { PGPASSWORD: 'secret' },
    });
  });

  it('restores the safety copy all-or-nothing', () => {
    expect(buildDatabaseSafetyRestoreCommand('/tmp/oj-db-import-x/pre-import.dump', connection)).toEqual({
      executable: 'pg_restore',
      args: ['--single-transaction', '--exit-on-error', '-h', 'db', '-p', '5432', '-U', 'postgres', '-d', 'oj_db', '/tmp/oj-db-import-x/pre-import.dump'],
      env: { PGPASSWORD: 'secret' },
    });
  });
});

describe('adminSystemService', () => {
  describe('buildDatabaseImportCommand', () => {
    it('should build psql command for .sql file', () => {
      const result = buildDatabaseImportCommand(
        'backup.sql',
        '/tmp/backup.sql',
        'oj_db',
        'postgres',
        'db',
        '5432',
        'secret'
      );

      expect(result).toEqual({
        kind: 'ok',
        format: 'plain',
        executable: 'psql',
        // A2-06: the dump arrives on stdin behind the service's \restrict,
        // never as `-f <upload>`; -X skips ~/.psqlrc.
        args: [
          '-X',
          '-v', 'ON_ERROR_STOP=1',
          '--single-transaction',
          '-h', 'db',
          '-p', '5432',
          '-U', 'postgres',
          '-d', 'oj_db',
          '-f', '-',
        ],
        env: { PGPASSWORD: 'secret' },
      });
    });

    it('should build pg_restore command for .dump file', () => {
      const result = buildDatabaseImportCommand(
        'backup.dump',
        '/tmp/backup.dump',
        'oj_db',
        'postgres',
        'db',
        '5432',
        'secret'
      );

      expect(result).toEqual({
        kind: 'ok',
        format: 'archive',
        executable: 'pg_restore',
        // A2-02: all-or-nothing, first error is fatal, foreign owners/GRANTs skipped.
        args: [
          '--no-owner',
          '--no-privileges',
          '--single-transaction',
          '--exit-on-error',
          '-h', 'db',
          '-p', '5432',
          '-U', 'postgres',
          '-d', 'oj_db',
          '/tmp/backup.dump',
        ],
        env: { PGPASSWORD: 'secret' },
      });
    });

    it('treats .tar like .dump', () => {
      const result = buildDatabaseImportCommand('backup.TAR', '/tmp/backup.tar', 'oj_db', 'postgres', 'db', '5432', 'secret');

      expect(result).toMatchObject({ kind: 'ok', format: 'archive', executable: 'pg_restore' });
    });

    it('should return unsupported_extension for unknown file type', () => {
      const result = buildDatabaseImportCommand(
        'backup.txt',
        '/tmp/backup.txt',
        'oj_db',
        'postgres',
        'db',
        '5432',
        'secret'
      );

      expect(result).toEqual({ kind: 'unsupported_extension' });
    });
  });

  describe('buildDatabaseExportFilePath', () => {
    it('should build deterministic export path', () => {
      const result = buildDatabaseExportFilePath(1700000000000);
      expect(result).toBe('/tmp/db_backup_1700000000000.sql');
    });
  });

  describe('buildDatabaseExportCommand', () => {
    it('should build pg_dump command that excludes session rows (ADMIN-003)', () => {
      const command = buildDatabaseExportCommand(
        '/tmp/db_backup.sql',
        'oj_db',
        'postgres',
        'db',
        '5432',
        'secret'
      );

      expect(command.kind).toBe('ok');
      expect(command.executable).toBe('pg_dump');
      expect(command.args).toEqual([
        '-h', 'db',
        '-p', '5432',
        '-U', 'postgres',
        '-d', 'oj_db',
        // Live connect.sid values (including the exporting admin's) must not
        // be embedded in the dump.
        '--exclude-table=user_sessions',
        '-F', 'p',
        '-f', '/tmp/db_backup.sql',
      ]);
      expect(command.env).toEqual({ PGPASSWORD: 'secret' });
    });
  });
});
