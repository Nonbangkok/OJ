type DatabaseConstraintError = {
  code?: string;
  constraint?: string;
};

/**
 * Postgres unique-violation detector (SQLSTATE 23505). When `constraint` is
 * given, the error must also match that specific constraint name; otherwise
 * any unique violation counts.
 */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const databaseError = error as DatabaseConstraintError;
  return databaseError?.code === '23505'
    && (constraint === undefined || databaseError.constraint === constraint);
};
