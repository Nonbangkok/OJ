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

// --- header-problem fixtures -------------------------------------------------
// A distinctive string inside the grader's main.cpp. It must never reach the
// submitter: not through a compile diagnostic (hence
// -fno-diagnostics-show-caret, which stops g++ echoing source lines) and not
// through a run (hence the workspace scrub before the binary runs).
const GRADER_MARKER = 'GRADER_SECRET_MARKER';

const GRADER_MAIN = `// ${GRADER_MARKER}: reference solution notes live here.
#include <iostream>
#include "stack.h"
int main() {
  int n;
  if (!(std::cin >> n)) return 0;
  CP::stack<int> s;
  for (int i = 0; i < n; i++) { int x; std::cin >> x; s.push(x); }
  while (s.size() > 0) {
    std::cout << s.top();
    s.pop();
    std::cout << (s.size() > 0 ? ' ' : '\\n');
  }
  return 0;
}
`;

const GRADER_STACK_HEADER = `#ifndef CP_STACK_H
#define CP_STACK_H
namespace CP {
template <typename T>
class stack {
  T data[128];
  int count = 0;
public:
  void push(const T& value);
  void pop();
  T top() const;
  int size() const;
};
}
#include "student.h"
#endif
`;

/** A correct student.h: out-of-line definitions of the declared members. */
const STUDENT_OK = `namespace CP {
template <typename T> void stack<T>::push(const T& value) { data[count++] = value; }
template <typename T> void stack<T>::pop() { if (count > 0) --count; }
template <typename T> T stack<T>::top() const { return data[count - 1]; }
template <typename T> int stack<T>::size() const { return count; }
}
`;

/** pop() drops two elements: terminates, but prints "3 1" instead of "3 2 1". */
const STUDENT_WRONG_POP = STUDENT_OK.replace(
  'void stack<T>::pop() { if (count > 0) --count; }',
  'void stack<T>::pop() { count -= 2; }',
);

/** A missing semicolon — the diagnostic must name student.h, not the grader. */
const STUDENT_SYNTAX_ERROR = STUDENT_OK.replace('data[count++] = value;', 'data[count++] = value');

/**
 * Tries to read the grader sources at RUN time, from the cwd and from the
 * binary's own directory (the workspace, found via /proc/self/exe). A global
 * constructor runs this before main, so its verdict is printed even though
 * the grader's main produces no output for the `hprobe` testcase.
 */
const STUDENT_FILE_PROBE = `#include <cstdio>
#include <cstring>
#include <unistd.h>
${STUDENT_OK}
namespace {
struct Probe {
  Probe() {
    bool opened = false;
    if (FILE* f = std::fopen("main.cpp", "r")) { opened = true; std::fclose(f); }
    char self[4096];
    ssize_t len = ::readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (len > 0) {
      self[len] = '\\0';
      char* slash = std::strrchr(self, '/');
      if (slash) {
        *slash = '\\0';
        char target[4200];
        const char* names[3] = { "main.cpp", "stack.h", "student.h" };
        for (int i = 0; i < 3; i++) {
          std::snprintf(target, sizeof(target), "%s/%s", self, names[i]);
          if (FILE* g = std::fopen(target, "r")) { opened = true; std::fclose(g); }
        }
      }
    }
    std::printf("%s\\n", opened ? "open" : "closed");
    std::fflush(stdout);
  }
} probe;
}
`;

/** Assembler-level embedding of the secret source: rejected before compiling. */
const STUDENT_INCBIN = `${STUDENT_OK}
namespace { struct Leak { Leak() { asm(".incbin \\"main.cpp\\""); } } leak; }
`;

/** [problem id, testcase input, expected output] */
const HEADER_PROBLEM_SEEDS: Array<[string, string, string]> = [
  ['hstack', '3\n1 2 3\n', '3 2 1\n'],
  // The grader prints nothing for n = 0, so the probe's own line IS the output.
  ['hprobe', '0\n', 'closed\n'],
];

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

    // --- header problems: the student submits only student.h, which the
    // problem's SECRET grader files include. `hstack` checks verdicts;
    // `hprobe` (same grader, empty-output testcase) lets a submission report
    // whether it could still READ the grader sources at run time.
    for (const [id, input, output] of HEADER_PROBLEM_SEEDS) {
      await pool.query(
        `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
         VALUES ($1, $1, 1000, 256, true, 'header', 'student.h')`,
        [id],
      );
      await pool.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, $2, $3)',
        [id, input, output],
      );
      for (const [filename, content] of [['main.cpp', GRADER_MAIN], ['stack.h', GRADER_STACK_HEADER]]) {
        await pool.query(
          `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ($1, 'grader', $2, $3)`,
          [id, filename, Buffer.from(content, 'utf-8')],
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
    ['cpp-signed-overflow', 'double', 'cpp',
      '#include <climits>\n#include <iostream>\nint main(){volatile int x = INT_MAX; x = x + 1; std::cout << x << "\\n";}',
      SUBMISSION_STATUS.RUNTIME_ERROR],
    // Prints (and flushes) the correct answer before overflowing: still a Runtime Error.
    ['cpp-signed-overflow-correct-output', 'double', 'cpp',
      '#include <climits>\n#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<n*2<<std::endl;volatile int x = INT_MAX; x = x + 1; return x == 0;}',
      SUBMISSION_STATUS.RUNTIME_ERROR],
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

  it.each(cases)('%s', async (name, problemId, language, code, expected) => {
    const row = await judgeOnce(problemId, language, code);
    expect({ name, status: row.overall_status, results: row.overall_status === expected ? undefined : row.results })
      .toEqual({ name, status: expected, results: undefined });
    if (expected === SUBMISSION_STATUS.ACCEPTED) expect(row.score).toBe(100);
    if (name.startsWith('cpp-signed-overflow')) {
      const output = String(row.results?.[0]?.output ?? '');
      expect(output).toContain('signed integer overflow');
      expect(output).not.toContain('oj-submissions');
    }
    if (expected === SUBMISSION_STATUS.COMPILATION_ERROR) {
      const output = String(row.results?.[0]?.output ?? '');
      expect(output).toMatch(/error/i);
      expect(output).not.toContain('oj-submissions');
    }
  });

  describe('header problems (student.h compiled with the secret grader)', () => {
    it('accepts a correct implementation', async () => {
      const row = await judgeOnce('hstack', 'cpp', STUDENT_OK);
      expect({ status: row.overall_status, results: row.results }).toMatchObject({ status: SUBMISSION_STATUS.ACCEPTED });
      expect(row.score).toBe(100);
    });

    it('rejects a wrong implementation with Wrong Answer', async () => {
      const row = await judgeOnce('hstack', 'cpp', STUDENT_WRONG_POP);
      expect({ status: row.overall_status, results: row.results })
        .toMatchObject({ status: SUBMISSION_STATUS.WRONG_ANSWER });
    });

    it('reports a syntax error against student.h without echoing the grader source', async () => {
      const row = await judgeOnce('hstack', 'cpp', STUDENT_SYNTAX_ERROR);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      const output = String(row.results?.[0]?.output ?? '');
      // The diagnostic keeps pointing at the file the student wrote...
      expect(output).toContain('student.h');
      expect(output).toMatch(/error/i);
      // ...but no secret grader content and no server paths leak.
      expect(output).not.toContain(GRADER_MARKER);
      expect(output).not.toContain('oj-submissions');
    });

    it('cannot #include the grader main into the submission to read it', async () => {
      const row = await judgeOnce('hstack', 'cpp', `#include "main.cpp"\n${STUDENT_OK}`);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      const output = String(row.results?.[0]?.output ?? '');
      expect(output).not.toContain(GRADER_MARKER);
      expect(output).not.toContain('oj-submissions');
    });

    it('cannot read the grader sources at run time — they are scrubbed first', async () => {
      // The probe prints "closed" only if every fopen of main.cpp / stack.h /
      // student.h failed; the testcase expects exactly that.
      const row = await judgeOnce('hprobe', 'cpp', STUDENT_FILE_PROBE);
      expect({ status: row.overall_status, results: row.results })
        .toMatchObject({ status: SUBMISSION_STATUS.ACCEPTED });
    });

    it('rejects assembler-level embedding of the grader source', async () => {
      const row = await judgeOnce('hstack', 'cpp', STUDENT_INCBIN);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      const output = String(row.results?.[0]?.output ?? '');
      expect(output).toContain('inline assembly');
      expect(output).not.toContain(GRADER_MARKER);
    });

    it('rejects a Python submission to a header problem', async () => {
      const row = await judgeOnce('hstack', 'python', 'print(1)');
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      expect(String(row.results?.[0]?.output ?? '')).toContain('C++ only');
    });
  });

  it('judge toolchain is g++ 14 and Python 3.13', () => {
    expect(execFileSync('g++', ['-dumpversion']).toString().trim().startsWith('14')).toBe(true);
    const py = execFileSync('/usr/bin/python3', ['-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")']);
    expect(py.toString().trim()).toBe('3.13');
  });
});
