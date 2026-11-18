import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { findSimilarContestPairs } from '../../services/similarityService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A5-05: on a header problem every student starts from the same starter
 * student.h (plus the shipped main.cpp and data-structure header), so two
 * independent solutions share most of their tokens. Cheat detection must
 * compare only what each student added to the starter: honest pairs stay
 * below the threshold, a copied solution is still reported.
 *
 * The files follow the bundled hp_pair02_less layout
 * (content/header-problems/problems/hp_pair02_less).
 */
(databaseUrl ? describe : describe.skip)('header problem similarity (A5-05)', () => {
  const schema = `hps_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  const withBody = (body: string) => `#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  // Your code here
${body}
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::make_min(const CP::pair<T1, T2> &other)
{
  // You MAY need to edit this function
  if (other < *this)
  {
    first = other.first;
    second = other.second;
  }
}

#endif
`;
  const starterStudent = withBody('  return false;');
  const starterMain = `#include <iostream>
#include "pair.h"
#include "student.h"
int main() {
  CP::pair<int, int> a(1, 2), b(1, 3);
  std::cout << (a < b) << std::endl;
  a.make_min(b);
  std::cout << a.first << " " << a.second << std::endl;
  return 0;
}
`;
  // Two students solving it on their own.
  const reference = withBody(`  if (first < other.first)
    return true;
  if (other.first < first)
    return false;
  return second < other.second;`);
  const independent = withBody('  return first < other.first || (!(other.first < first) && second < other.second);');
  // A third copies the reference, renaming and reformatting it.
  const copied = withBody(`  // compare the first members, then the second ones
  if (first < other.first) return true;   if (other.first < first) return false;
  return second   <   other.second;`).replaceAll('other', 'rhs');

  const submit = (user: number, code: string, minutes: number) =>
    pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, 'hp', $2, 'cpp', 'Accepted', 100, '[]'::jsonb, NOW() - make_interval(mins => $3))`,
      [user, code, 60 - minutes],
    );
  const pairsOf = async () =>
    (await findSimilarContestPairs(1)).map((p) => [p.problemId, [p.userA, p.userB].sort()]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'alice', 'x', 'user'), (2, 'bob', 'x', 'user'), (3, 'carol', 'x', 'user')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible,
        contest_id, contest_position, problem_type, submission_filename)
      VALUES ('hp', 'Pair Less', 'x', '{}', 1000, 256, false, 1, 1, 'header', 'student.h')`);
    await pool.query(`INSERT INTO problem_files (problem_id, role, filename, content) VALUES
      ('hp', 'starter', 'student.h', convert_to($1, 'UTF8')),
      ('hp', 'starter', 'main.cpp', convert_to($2, 'UTF8')),
      ('hp', 'grader', 'main.cpp', convert_to('int main() { return 0; }', 'UTF8'))`, [starterStudent, starterMain]);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2), (1, 3)');
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('does not flag two independent solutions written on the same starter', async () => {
    await submit(1, reference, 10);
    await submit(2, independent, 20);

    expect(await pairsOf()).toEqual([]);
  });

  it('still flags a copied solution, and only that pair', async () => {
    await submit(1, reference, 10);
    await submit(2, independent, 20);
    await submit(3, copied, 30);

    expect(await pairsOf()).toEqual([['hp', ['alice', 'carol']]]);
  });

  it('does not flag two students who both handed in the untouched starter', async () => {
    await submit(1, starterStudent, 10);
    await submit(2, starterStudent, 20);

    expect(await pairsOf()).toEqual([]);
  });
});
