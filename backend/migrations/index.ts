import { coreSchemaSql } from './0001CoreSchema';
import { problemAuthoringFoundationSql } from './0002ProblemAuthoringFoundation';
import { Migration } from './migrationRunner';
import { authoringJobDeliverySql } from './0003AuthoringJobDelivery';
import { authoringJobInputsSql } from './0004AuthoringJobInputs';

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
  { version: '0003_authoring_job_delivery', sql: authoringJobDeliverySql },
  { version: '0004_authoring_job_inputs', sql: authoringJobInputsSql },
]);
