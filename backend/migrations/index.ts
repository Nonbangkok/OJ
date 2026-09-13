import { coreSchemaSql } from './0001CoreSchema';
import { problemAuthoringFoundationSql } from './0002ProblemAuthoringFoundation';
import { Migration } from './migrationRunner';

export const coreMigrations: readonly Migration[] = Object.freeze([
  {
    version: '0001_core_schema',
    sql: coreSchemaSql,
  },
]);

export const migrations: readonly Migration[] = Object.freeze([
  ...coreMigrations,
  {
    version: '0002_problem_authoring_foundation',
    sql: problemAuthoringFoundationSql,
  },
]);
