import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// Drives the REAL judge pipeline (compile, sandbox, time_wrapper, seccomp) and
// therefore needs the backend image: linux, root, and the compiled wrapper in cwd.
const enabled = Boolean(
  process.env.INTEGRATION_DATABASE_URL
  && process.platform === 'linux'
  && process.getuid?.() === 0
  && fs.existsSync('scripts/time_wrapper'),
);

(enabled ? describe : describe.skip)('judge runtime verdicts (end to end)', () => {
  jest.setTimeout(30_000);
  const schema = `judge_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  let userId: number;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (db.withTransaction as jest.Mock).mockImplementation(async (body: (client: pg.PoolClient) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await body(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
    userId = (await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ('judge-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    const problems: Array<[string, number, Array<[string, string]>]> = [
      ['double', 256, [['3', '6'], ['21', '42']]],
      ['small-mem', 32, [['1', '1']]],
      ['sock', 256, [['x', 'blocked']]],
    ];
    for (const [id, memory, cases] of problems) {
      await pool.query(
        'INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ($1, $1, 1000, $2, true)',
        [id, memory],
      );
      for (const [i, [input, output]] of cases.entries()) {
        await pool.query(
          'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
          [id, i + 1, `${input}\n`, `${output}\n`],
        );
      }
    }
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judgeOnce(problemId: string, language: 'cpp' | 'python', code: string) {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
      [userId, problemId, code, language, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status, score, results FROM submissions WHERE id = $1', [id])).rows[0];
  }

  const cases: Array<[string, string, 'cpp' | 'python', string, string]> = [
    ['cpp-accepted', 'double', 'cpp',
      '#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<n*2<<"\\n";}', SUBMISSION_STATUS.ACCEPTED],
    ['cpp-wrong-answer', 'double', 'cpp',
      '#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<n<<"\\n";}', SUBMISSION_STATUS.WRONG_ANSWER],
    ['cpp-tle', 'double', 'cpp', 'int main(){for(;;);}', SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED],
    ['cpp-mle', 'small-mem', 'cpp',
      '#include <iostream>\n#include <vector>\nint main(){std::vector<char> v(40<<20, 1); std::cout << (int)v[12345] << "\\n";}',
      SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED],
    ['cpp-segfault', 'double', 'cpp',
      'int main(){volatile int* p = nullptr; *p = 1; return 0;}', SUBMISSION_STATUS.RUNTIME_ERROR],
    // Characterises today's judge: UBSan is compiled without -fno-sanitize-recover
    // (constants/index.ts LANGUAGE_PREPARE.cpp), so it only reports to stderr and the
    // program exits 0. The documented "signed overflow -> Runtime Error" does not hold
    // today; tracked as a follow-up, and this expectation flips when that is fixed.
    ['cpp-signed-overflow', 'double', 'cpp',
      '#include <climits>\n#include <iostream>\nint main(){volatile int x = INT_MAX; x = x + 1; std::cout << x << "\\n";}',
      SUBMISSION_STATUS.WRONG_ANSWER],
    ['cpp-socket-blocked', 'sock', 'cpp',
      '#include <sys/socket.h>\n#include <iostream>\nint main(){std::cout << (socket(AF_INET, SOCK_STREAM, 0) < 0 ? "blocked" : "open") << "\\n";}',
      SUBMISSION_STATUS.ACCEPTED],
    ['cpp-compile-error', 'double', 'cpp', 'int main( {', SUBMISSION_STATUS.COMPILATION_ERROR],
    ['py-accepted', 'double', 'python', 'print(int(input())*2)', SUBMISSION_STATUS.ACCEPTED],
    ['py-wrong-answer', 'double', 'python', 'print(input())', SUBMISSION_STATUS.WRONG_ANSWER],
    ['py-runtime-error', 'double', 'python', 'raise ValueError("boom")', SUBMISSION_STATUS.RUNTIME_ERROR],
    ['py-syntax-error', 'double', 'python', 'print(', SUBMISSION_STATUS.COMPILATION_ERROR],
    ['py-tle', 'double', 'python', 'while True: pass', SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED],
  ];

  it.each(cases)('%s', async (_name, problemId, language, code, expected) => {
    const row = await judgeOnce(problemId, language, code);
    if (row.overall_status !== expected) process.stderr.write(`${_name} ${JSON.stringify(row)}\n`);
    expect(row.overall_status).toBe(expected);
    if (expected === SUBMISSION_STATUS.ACCEPTED) expect(row.score).toBe(100);
    if (expected === SUBMISSION_STATUS.COMPILATION_ERROR) {
      expect(JSON.stringify(row.results)).not.toContain('oj-submissions');
    }
  });

  it('judge toolchain is g++ 14 and Python 3.13', () => {
    expect(execFileSync('g++', ['-dumpversion']).toString().trim().startsWith('14')).toBe(true);
    const py = execFileSync('/usr/bin/python3', ['-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")']);
    expect(py.toString().trim()).toBe('3.13');
  });
});
