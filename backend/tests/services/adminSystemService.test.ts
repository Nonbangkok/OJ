import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from '../../services/adminSystemService';

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

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.executable).toBe('psql');
        expect(result.args).toContain('/tmp/backup.sql');
      }
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

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.executable).toBe('pg_restore');
        expect(result.args).toContain('/tmp/backup.dump');
      }
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
    it('should build pg_dump command', () => {
      const command = buildDatabaseExportCommand(
        '/tmp/db_backup.sql',
        'oj_db',
        'postgres',
        'db',
        '5432',
        'secret'
      );

      expect(command).toContain('pg_dump');
      expect(command).toContain('-f /tmp/db_backup.sql');
      expect(command).toContain('PGPASSWORD=secret');
    });
  });
});
