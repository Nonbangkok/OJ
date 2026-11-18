import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// A9-06: RLIMIT_AS and the wait4() peak are per process, so a program that
// forks N workers could hold N times the memory limit (and N CPUs of time)
// and still be Accepted. Judged programs are therefore thread-only: the
// time_wrapper seccomp filter refuses fork/vfork and clone without
// CLONE_THREAD (clone3 answers ENOSYS so glibc falls back to clone).
// Threads keep working: they share the one limited address space.
//
// Drives the REAL judge pipeline, so it needs the backend image: linux, root,
// the compiled wrapper in cwd.
const gateConditions: Array<[string, boolean]> = [
  ['INTEGRATION_DATABASE_URL is set', Boolean(process.env.INTEGRATION_DATABASE_URL)],
  ['platform is linux', process.platform === 'linux'],
  ['running as uid 0', process.getuid?.() === 0],
  ['scripts/time_wrapper exists in cwd', fs.existsSync('scripts/time_wrapper')],
];
const unmet = gateConditions.filter(([, ok]) => !ok).map(([name]) => name);
if (process.env.JUDGE_RUNTIME_REQUIRED === '1' && unmet.length > 0) {
  throw new Error(`judge runtime suite is required (JUDGE_RUNTIME_REQUIRED=1) but unmet conditions: ${unmet.join('; ')}`);
}
const enabled = unmet.length === 0;

const MEMORY_LIMIT_MB = 48;
const WORKERS = 3;
const WORKER_MB = 40; // each under the limit, together 2.5x over it

/**
 * Three forked workers each touch 40 MB and stay resident together; the
 * parent prints the right answer only if every worker succeeded.
 */
const FORKED_WORKERS = `#include <cstdlib>
#include <iostream>
#include <sys/wait.h>
#include <unistd.h>
int main() {
  long long n; std::cin >> n;
  const size_t bytes = (size_t)${WORKER_MB} << 20;
  for (int i = 0; i < ${WORKERS}; i++) {
    pid_t p = fork();
    if (p == 0) {
      volatile char* m = (volatile char*)std::malloc(bytes); if (!m) _exit(3);
      for (size_t k = 0; k < bytes; k += 4096) m[k] = 1;
      usleep(300000);
      _exit(m[4096] == 1 ? 0 : 4);
    }
    if (p < 0) break;
  }
  int ok = 0, st;
  while (wait(&st) > 0) if (WIFEXITED(st) && WEXITSTATUS(st) == 0) ok++;
  if (ok == ${WORKERS}) std::cout << n * 2 << "\\n"; else std::cout << "workers=" << ok << "\\n";
  return 0;
}
`;

/** fork() itself must fail with EPERM, not crash the program. */
const FORK_PROBE = `#include <cerrno>
#include <iostream>
#include <unistd.h>
int main() {
  long long n; std::cin >> n;
  pid_t p = fork();
  if (p == 0) _exit(0);
  std::cout << (p < 0 && errno == EPERM ? n * 2 : -1) << "\\n";
  return 0;
}
`;

/** std::thread still works (clone with CLONE_THREAD). */
const CPP_THREADS = `#include <iostream>
#include <thread>
#include <vector>
int main() {
  long long n; std::cin >> n;
  std::vector<long long> r(4, 0);
  std::vector<std::thread> pool;
  for (int t = 0; t < 4; t++) pool.emplace_back([&r, n, t] { r[t] = n * 2; });
  for (auto& th : pool) th.join();
  std::cout << r[3] << "\\n";
  return 0;
}
`;

const PY_THREADS = `import threading
n = int(input())
out = []
t = threading.Thread(target=lambda: out.append(n * 2))
t.start(); t.join()
print(out[0])
`;

const PY_FORK = `import os
n = int(input())
try:
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    print(-1)
except PermissionError:
    print(n * 2)
`;

(enabled ? describe : describe.skip)('judged programs are thread-only (A9-06)', () => {
  jest.setTimeout(90_000);
  const schema = `judge_forkban_${randomUUID().replaceAll('-', '')}`;
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
      `INSERT INTO users (username, password_hash, role) VALUES ('forkban-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ('mem48', 'mem48', 2000, $1, true)`,
      [MEMORY_LIMIT_MB],
    );
    await pool.query(
      `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('mem48', 1, '3\n', '6\n')`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judgeOnce(language: 'cpp' | 'python', code: string): Promise<string> {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, 'mem48', $2, $3, $4, 0) RETURNING id`,
      [userId, code, language, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status FROM submissions WHERE id = $1', [id])).rows[0].overall_status;
  }

  it(`forked workers holding ${WORKERS} x ${WORKER_MB} MB together are not Accepted under a ${MEMORY_LIMIT_MB} MB limit`, async () => {
    expect(await judgeOnce('cpp', FORKED_WORKERS)).not.toBe(SUBMISSION_STATUS.ACCEPTED);
  });

  it('fork() fails with EPERM instead of creating a process', async () => {
    expect(await judgeOnce('cpp', FORK_PROBE)).toBe(SUBMISSION_STATUS.ACCEPTED);
  });

  it('Python os.fork() raises PermissionError', async () => {
    expect(await judgeOnce('python', PY_FORK)).toBe(SUBMISSION_STATUS.ACCEPTED);
  });

  it('C++ std::thread still works', async () => {
    expect(await judgeOnce('cpp', CPP_THREADS)).toBe(SUBMISSION_STATUS.ACCEPTED);
  });

  it('Python threading still works', async () => {
    expect(await judgeOnce('python', PY_THREADS)).toBe(SUBMISSION_STATUS.ACCEPTED);
  });
});
