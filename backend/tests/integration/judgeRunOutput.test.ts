import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { getSubmissionDetail } from '../../services/submissionQueryService';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// What a judged program's run can send back to the submitter (A9-04 / A7-01 /
// A8-02 capped and path-free Runtime Error output, A4-08 no grader dump on
// header problems, A4-04 unforgeable time/memory telemetry). Drives the REAL
// judge pipeline (compile, sandbox, time_wrapper, seccomp), so it needs the
// backend image: linux, root, and the compiled wrapper in cwd. Same gating as
// judgeRuntime.test.ts.
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

/**
 * Upper bound on the program stderr the judge may persist / serve for one
 * Runtime Error, truncation marker included: 4 KiB (a UBSan report or a
 * Python traceback fits easily).
 */
const MAX_RUNTIME_ERROR_OUTPUT_BYTES = 4 * 1024;

const GRADER_SECRET = 'GRADER_SECRET_TOKEN_QWERTYUIOP';

/** Header-problem grader: the secret literal is compiled into the student's binary. */
const GRADER_MAIN = `#include <cstdio>
#include "student.h"
static const char* const kGraderSecret = "${GRADER_SECRET}";
int main() {
  int n;
  if (std::scanf("%d", &n) != 1) return 0;
  if (n == -987654) std::puts(kGraderSecret);
  std::printf("%d\\n", twice(n));
  return 0;
}
`;

const STUDENT_OK = 'inline int twice(int x) { return 2 * x; }\n';

/**
 * A student.h that reads its own linked binary (which contains the grader)
 * through /proc/self/exe and writes the long [A-Z_] runs to stderr — an
 * in-process `strings | grep`, so the dump stays tiny and survives any
 * output-size cap — then aborts to get a Runtime Error.
 */
const STUDENT_GRADER_DUMP = `#include <cstdio>
#include <cstdlib>
${STUDENT_OK}
namespace {
struct Dump {
  Dump() {
    FILE* f = std::fopen("/proc/self/exe", "rb");
    if (!f) std::abort();
    char run[256];
    int len = 0;
    int c;
    while ((c = std::fgetc(f)) != EOF) {
      if ((c >= 'A' && c <= 'Z') || c == '_') {
        if (len < 255) run[len++] = static_cast<char>(c);
      } else {
        if (len >= 20) { run[len] = 0; std::fprintf(stderr, "%s\\n", run); }
        len = 0;
      }
    }
    std::fclose(f);
    std::abort();
  }
} dump;
}
`;

/** Writes 1 MiB to stderr after a recognisable head line, then exits 1. */
const CPP_HUGE_STDERR = `#include <cstdio>
#include <cstring>
int main() {
  std::fputs("BEGIN_STDERR\\n", stderr);
  static char chunk[4096];
  std::memset(chunk, 'x', sizeof(chunk));
  for (int i = 0; i < 256; i++) std::fwrite(chunk, 1, sizeof(chunk), stderr);
  return 1;
}
`;

/**
 * Uses ~72 MB on a 64 MB problem (RLIMIT_AS = 64 + 32 MB slack, so the
 * allocation succeeds) while forging the wrapper's telemetry line twice:
 * once BEFORE the wrapper reports (defeats first-match parsing) and once from
 * a forked child AFTER the wrapper has reported (defeats last-match parsing).
 */
const CPP_FORGED_TELEMETRY = `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
int main() {
  const char forged[] = "TIME_USED:0.001+0.000 MEM_USED:1\\n";
  if (fork() == 0) {
    usleep(300000);
    if (write(2, forged, sizeof(forged) - 1) < 0) _exit(1);
    _exit(0);
  }
  if (write(2, forged, sizeof(forged) - 1) < 0) return 1;
  size_t n = (size_t)72 << 20;
  char* p = static_cast<char*>(std::malloc(n));
  if (!p) return 2;
  std::memset(p, 1, n);
  std::printf("%d\\n", p[12345]);
  return 0;
}
`;

/** Prints the right answer only if the wrapper's telemetry fd is NOT open in the program. */
const CPP_TELEMETRY_FD_PROBE = `#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <unistd.h>
int main() {
  int n;
  if (std::scanf("%d", &n) != 1) return 0;
  bool reachable = fcntl(3, F_GETFD) != -1 || errno != EBADF;
  if (write(3, "TIME_USED:0.001+0.000 MEM_USED:1\\n", 33) > 0) reachable = true;
  std::printf("%d\\n", reachable ? 0 : 2 * n);
  return 0;
}
`;

/** NUL bytes in stderr (Postgres jsonb rejects \\u0000) must not turn a Runtime Error into a System Error. */
const CPP_NUL_STDERR = `#include <unistd.h>
int main() {
  if (write(2, "NUL_HEAD\\0NUL_TAIL\\n", 18) < 0) return 2;
  return 1;
}
`;

/** Same allocation, no forging: the control that the setup really is an MLE. */
const CPP_OVER_LIMIT_HONEST = `#include <cstdio>
#include <cstdlib>
#include <cstring>
int main() {
  size_t n = (size_t)72 << 20;
  char* p = static_cast<char*>(std::malloc(n));
  if (!p) return 2;
  std::memset(p, 1, n);
  std::printf("%d\\n", p[12345]);
  return 0;
}
`;

(enabled ? describe : describe.skip)('judge run output returned to the submitter', () => {
  jest.setTimeout(60_000);
  const schema = `runout_${randomUUID().replaceAll('-', '')}`;
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
      `INSERT INTO users (username, password_hash, role) VALUES ('runout-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;

    const problems: Array<[string, number, string, string]> = [
      ['ro-std', 256, '5\n', '10\n'],
      ['ro-mem64', 64, '1\n', '1\n'],
    ];
    for (const [id, memory, input, output] of problems) {
      await pool.query(
        'INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ($1, $1, 2000, $2, true)',
        [id, memory],
      );
      await pool.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, $2, $3)',
        [id, input, output],
      );
    }

    await pool.query(
      `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
       VALUES ('ro-hdr', 'ro-hdr', 2000, 256, true, 'header', 'student.h')`,
    );
    await pool.query(
      `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('ro-hdr', 1, '5\n', '10\n')`,
    );
    await pool.query(
      `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('ro-hdr', 'grader', 'main.cpp', $1)`,
      [Buffer.from(GRADER_MAIN, 'utf-8')],
    );
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
    const row = (await pool.query(
      'SELECT overall_status, score, results, max_memory_kb, octet_length(results::text) AS results_bytes FROM submissions WHERE id = $1',
      [id],
    )).rows[0];
    // What GET /submissions/:id hands the owner (the controller returns this row as-is).
    const served = await getSubmissionDetail(String(id));
    return { id, row, served };
  }

  const firstOutput = (results: unknown): string => {
    const list = Array.isArray(results) ? results as Array<{ output?: unknown }> : [];
    const hit = list.find((r) => typeof r?.output === 'string');
    return typeof hit?.output === 'string' ? hit.output : '';
  };

  it('caps the Runtime Error stderr that is stored and served (keeps the head)', async () => {
    const { row, served } = await judgeOnce('ro-std', 'cpp', CPP_HUGE_STDERR);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);

    const stored = firstOutput(row.results);
    expect(stored.startsWith('BEGIN_STDERR')).toBe(true);
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(MAX_RUNTIME_ERROR_OUTPUT_BYTES);
    // The marker says how much was cut (1 MiB written, about 4 KiB kept).
    const truncated = Number(/\[truncated (\d+) bytes\]$/.exec(stored)?.[1]);
    expect(truncated).toBeGreaterThan(1_000_000);
    expect(Number(row.results_bytes)).toBeLessThanOrEqual(2 * MAX_RUNTIME_ERROR_OUTPUT_BYTES);

    const servedOutput = firstOutput(served?.results);
    expect(Buffer.byteLength(servedOutput)).toBeLessThanOrEqual(MAX_RUNTIME_ERROR_OUTPUT_BYTES);
  });

  it('does not put the workspace path in a Python Runtime Error traceback', async () => {
    const { row, served } = await judgeOnce('ro-std', 'python', 'raise ValueError("boom")');
    expect(row.overall_status).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
    const servedOutput = firstOutput(served?.results);
    expect(servedOutput).toContain('ValueError');
    expect(servedOutput).not.toContain('oj-submissions');
  });

  it('header problem: a Runtime Error never carries the compiled grader back to the student', async () => {
    const { row, served } = await judgeOnce('ro-hdr', 'cpp', STUDENT_GRADER_DUMP);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
    expect(JSON.stringify(row.results)).not.toContain(GRADER_SECRET);
    expect(JSON.stringify(served?.results ?? null)).not.toContain(GRADER_SECRET);
    // Only a neutral description of how the program died is kept.
    expect(firstOutput(row.results)).toBe('Program terminated by signal SIGABRT');
  });

  it('stores stderr that contains NUL bytes as a Runtime Error', async () => {
    const { row } = await judgeOnce('ro-std', 'cpp', CPP_NUL_STDERR);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
    const stored = firstOutput(row.results);
    expect(stored).toContain('NUL_HEAD');
    expect(stored).toContain('NUL_TAIL');
  });

  it('the program does not inherit the wrapper telemetry fd', async () => {
    const { row } = await judgeOnce('ro-std', 'cpp', CPP_TELEMETRY_FD_PROBE);
    expect({ status: row.overall_status, results: row.overall_status === SUBMISSION_STATUS.ACCEPTED ? undefined : row.results })
      .toEqual({ status: SUBMISSION_STATUS.ACCEPTED, results: undefined });
  });

  it('reports the wrapper-measured time and memory for a normal run', async () => {
    const { row } = await judgeOnce('ro-std', 'cpp', '#include <cstdio>\nint main(){int n;std::scanf("%d",&n);std::printf("%d\\n",2*n);}');
    expect(row.overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);
    expect(Number(row.max_memory_kb)).toBeGreaterThan(0);
    expect(row.results[0].timeMs).toBeGreaterThanOrEqual(0);
  });

  it('control: an honest over-limit run is Memory Limit Exceeded', async () => {
    const { row } = await judgeOnce('ro-mem64', 'cpp', CPP_OVER_LIMIT_HONEST);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
    expect(Number(row.max_memory_kb)).toBeGreaterThan(64 * 1024);
  });

  it('a program cannot forge the wrapper telemetry to dodge Memory Limit Exceeded', async () => {
    const { row } = await judgeOnce('ro-mem64', 'cpp', CPP_FORGED_TELEMETRY);
    expect({ status: row.overall_status, maxMemoryKbOverLimit: Number(row.max_memory_kb) > 64 * 1024 })
      .toEqual({ status: SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED, maxMemoryKbOverLimit: true });
  });
});
