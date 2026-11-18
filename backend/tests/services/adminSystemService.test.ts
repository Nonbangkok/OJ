import fs from 'fs';
import path from 'path';
import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from '../../services/adminSystemService';
import { backendWorkRoot, removePrivateTemp } from '../../utils/privateTemp';

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
    it('puts each dump in its own fresh 0700 directory inside the private work root', async () => {
      const first = buildDatabaseExportFilePath(1700000000000);
      const second = buildDatabaseExportFilePath(1700000000000);
      try {
        expect(path.basename(first)).toBe('db_backup_1700000000000.sql');
        expect(path.dirname(path.dirname(first))).toBe(backendWorkRoot());
        expect(path.basename(path.dirname(first))).toMatch(/^export-/);
        expect(path.dirname(second)).not.toBe(path.dirname(first));
        expect(fs.lstatSync(path.dirname(first)).mode & 0o777).toBe(0o700);
      } finally {
        await removePrivateTemp(path.dirname(first));
        await removePrivateTemp(path.dirname(second));
      }
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
