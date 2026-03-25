import path from 'path';
import { BuildDatabaseImportCommandResult } from '../types/service';

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
      command: `PGPASSWORD=${databasePassword} psql -h ${databaseHost} -p ${databasePort} -U ${databaseUser} -d ${databaseName} -f ${dumpFilePath} -v ON_ERROR_STOP=1`,
    };
  }

  if (fileExtension === '.dump' || fileExtension === '.tar') {
    return {
      kind: 'ok',
      command: `PGPASSWORD=${databasePassword} pg_restore -h ${databaseHost} -p ${databasePort} -U ${databaseUser} -d ${databaseName} -v ${dumpFilePath}`,
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
): string => (
  `PGPASSWORD=${databasePassword} pg_dump -h ${databaseHost} -p ${databasePort} -U ${databaseUser} -d ${databaseName} -F p -f ${dumpFilePath}`
);
