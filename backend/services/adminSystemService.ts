import path from 'path';
import { BuildDatabaseExportCommandResult, BuildDatabaseImportCommandResult } from '../types/service';
import { privateTempDirSync } from '../utils/privateTemp';

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
  const connection = { databaseName, databaseUser, databaseHost, databasePort, databasePassword };

  if (fileExtension === '.sql') {
    // A2-06: psql reads the dump from stdin (`-f -`) behind the `\restrict`
    // the import service prepends (see databaseDumpGuard), never straight
    // from the uploaded file. -X skips ~/.psqlrc; --single-transaction makes
    // a failed restore leave nothing behind.
    return {
      kind: 'ok',
      format: 'plain',
      executable: 'psql',
      args: [
        '-X',
        '-v', 'ON_ERROR_STOP=1',
        '--single-transaction',
        ...pgConnectionArgs(connection),
        '-f', '-',
      ],
      env: pgClientEnv(connection),
    };
  }

  if (fileExtension === '.dump' || fileExtension === '.tar') {
    // A2-02: all-or-nothing restore that stops at the first error. Owners
    // and GRANTs are skipped so an archive from an install with other role
    // names still restores (its objects end up owned by the restoring user).
    return {
      kind: 'ok',
      format: 'archive',
      executable: 'pg_restore',
      args: [
        '--no-owner',
        '--no-privileges',
        '--single-transaction',
        '--exit-on-error',
        ...pgConnectionArgs(connection),
        dumpFilePath,
      ],
      env: pgClientEnv(connection),
    };
  }

  return { kind: 'unsupported_extension' };
};

export type PgConnection = {
  databaseName: string;
  databaseUser: string;
  databaseHost: string;
  databasePort: string;
  databasePassword: string;
};

type PgClientCommand = { executable: string; args: string[]; env: Record<string, string> };

const pgConnectionArgs = (connection: PgConnection): string[] => [
  '-h', connection.databaseHost,
  '-p', connection.databasePort,
  '-U', connection.databaseUser,
  '-d', connection.databaseName,
];

/**
 * A2-06: the whole environment of a pg client child. runCommand adds PATH
 * and nothing else, so SECRET_KEY and friends never reach psql.
 */
const pgClientEnv = (connection: PgConnection): Record<string, string> => ({
  PGPASSWORD: connection.databasePassword,
});

/**
 * A2-02: `pg_restore --list` reads an archive's table of contents without
 * connecting anywhere and fails on anything that is not an archive this
 * pg_restore can read. Runs before maintenance mode starts.
 */
export const buildDatabaseArchiveCheckCommand = (archivePath: string): PgClientCommand => ({
  executable: 'pg_restore',
  args: ['--list', archivePath],
  env: {},
});

/**
 * A2-02: full custom-format copy of the live database (sessions included),
 * taken before the import drops it. It holds exactly what
 * dropAllTablesForImport removes: subscriptions are left out because the
 * drop leaves them alone (DROP SUBSCRIPTION of one with a replication slot
 * cannot run inside a transaction), so restoring the copy never meets an
 * object that is still there.
 */
export const buildDatabaseSafetyCopyCommand = (safetyCopyPath: string, connection: PgConnection): PgClientCommand => ({
  executable: 'pg_dump',
  args: [...pgConnectionArgs(connection), '--no-subscriptions', '-F', 'c', '-f', safetyCopyPath],
  env: pgClientEnv(connection),
});

/** A2-02: put the safety copy back after dropAllTablesForImport emptied the database again. */
export const buildDatabaseSafetyRestoreCommand = (safetyCopyPath: string, connection: PgConnection): PgClientCommand => ({
  executable: 'pg_restore',
  args: ['--single-transaction', '--exit-on-error', ...pgConnectionArgs(connection), safetyCopyPath],
  env: pgClientEnv(connection),
});

/**
 * Path for a new export dump, inside a fresh private 0700 directory made for
 * it in the backend work root (the dump holds every hash, grader and hidden
 * testcase). The caller removes `path.dirname(result)` with removePrivateTemp.
 */
export const buildDatabaseExportFilePath = (timestamp: number): string =>
  path.join(privateTempDirSync('export-'), `db_backup_${timestamp}.sql`);

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
