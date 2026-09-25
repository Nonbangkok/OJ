import path from 'path';
import { BuildDatabaseExportCommandResult, BuildDatabaseImportCommandResult } from '../types/service';

export const buildDatabaseImportCommand = (
  originalFileName: string,
  dumpFilePath: string,
  databaseName: string,
  databaseUser: string,
  databaseHost: string,
  databasePort: string,
  databasePassword: string,
): BuildDatabaseImportCommandResult => {
  const fileExtension = path.extname(originalFileName).toLowerCase();

  if (fileExtension === '.sql') {
    return {
      kind: 'ok',
      executable: 'psql',
      args: [
        '-h', databaseHost,
        '-p', databasePort,
        '-U', databaseUser,
        '-d', databaseName,
        '-f', dumpFilePath,
        '-v', 'ON_ERROR_STOP=1',
      ],
      env: {
        PGPASSWORD: databasePassword,
      },
    };
  }

  if (fileExtension === '.dump' || fileExtension === '.tar') {
    return {
      kind: 'ok',
      executable: 'pg_restore',
      args: [
        '-h', databaseHost,
        '-p', databasePort,
        '-U', databaseUser,
        '-d', databaseName,
        dumpFilePath,
      ],
      env: {
        PGPASSWORD: databasePassword,
      },
    };
  }

  return { kind: 'unsupported_extension' };
};

export const buildDatabaseExportFilePath = (timestamp: number): string => path.join('/tmp', `db_backup_${timestamp}.sql`);

export const buildDatabaseExportCommand = (
  dumpFilePath: string,
  databaseName: string,
  databaseUser: string,
  databaseHost: string,
  databasePort: string,
  databasePassword: string,
): BuildDatabaseExportCommandResult => ({
  kind: 'ok',
  executable: 'pg_dump',
  args: [
    '-h', databaseHost,
    '-p', databasePort,
    '-U', databaseUser,
    '-d', databaseName,
    // ADMIN-003: never export session rows — the dump would otherwise embed
    // live connect.sid values (including the exporting admin's) that a
    // restore would resurrect. Post-import everyone re-logs in, which is the
    // correct behavior anyway.
    '--exclude-table=user_sessions',
    '-F', 'p',
    '-f', dumpFilePath,
  ],
  env: {
    PGPASSWORD: databasePassword,
  },
});
