/**
 * A contest's own submissions, in every contest status (A5-04).
 *
 * While a contest is running or finishing they are its contest_submissions
 * rows. The finish migration moves them into `submissions` in one transaction,
 * recording the contest in submissions.contest_id, and deletes the originals,
 * so at any moment a contest's submissions sit in exactly one of the two
 * tables. Reading both in one statement therefore returns each row once and
 * needs no separate status lookup (which could race the finish commit).
 * Practice submissions have contest_id NULL and are never included; contests
 * that finished before migration 0029 have no linked rows.
 *
 * Ids from the two tables are different sequences: after the finish a row's
 * id is its practice-pool submission id.
 *
 * @param contestIdSql bind parameter (or SQL expression) for the contest id
 * @param columns comma-separated column list present in both tables
 */
export const contestSubmissionsSql = (contestIdSql: string, columns: string): string => `(
      SELECT ${columns} FROM contest_submissions WHERE contest_id = ${contestIdSql}
      UNION ALL
      SELECT ${columns} FROM submissions WHERE contest_id = ${contestIdSql}
    )`;
