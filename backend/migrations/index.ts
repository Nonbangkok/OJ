import { coreSchemaSql } from './0001CoreSchema';
import { Migration } from './migrationRunner';

export const coreMigrations: readonly Migration[] = [
  {
    version: '0001_core_schema',
    sql: coreSchemaSql,
  },
];
