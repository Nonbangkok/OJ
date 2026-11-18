import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import * as compileGuard from '../../utils/compileGuard';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

/**
 * Header problems: student code must never read the SECRET grader source,
 * neither at compile time nor at run time. Drives the REAL judge pipeline
 * (compile + sandbox + run), so it needs the backend image: linux, root, and
 * the compiled time_wrapper in cwd.
 *
 *  - A4-01: `asm`/`.incbin` assembled past a lexical guard via token pasting
 *    and octal escapes used to bake the grader into the binary, which then
 *    printed it at run time, after the scrub.
 *  - A9-03: the same embedding via a section attribute with a split string
 *    literal (no `asm` keyword, no literal `incbin`).
 *  - A8-03: no run at all — student macros turned the grader's own tokens
 *    into `static_assert` diagnostic text in the Compilation Error.
 *
 * Two layers stop these, and each is tested on its own: the header source
 * rules reject the submissions up front, and — with those rules switched
 * off — the two-step build still leaves the assembler nothing to embed,
 * because every grader file is deleted before it runs.
 */
const gateConditions: Array<[string, boolean]> = [
  ['INTEGRATION_DATABASE_URL is set', Boolean(process.env.INTEGRATION_DATABASE_URL)],
  ['platform is linux', process.platform === 'linux'],
  ['running as uid 0', process.getuid?.() === 0],
  ['scripts/time_wrapper exists in cwd', fs.existsSync('scripts/time_wrapper')],
];
const unmet = gateConditions.filter(([, ok]) => !ok).map(([name]) => name);
if (process.env.JUDGE_RUNTIME_REQUIRED === '1' && unmet.length > 0) {
  throw new Error(`judge runtime suite is required (JUDGE_RUNTIME_REQUIRED=1) but unmet: ${unmet.join('; ')}`);
}
const enabled = unmet.length === 0;

// A distinctive token in the grader's COMMENT and a distinctive identifier in
// the grader's CODE. Neither may ever reach the submitter.
const GRADER_COMMENT_MARKER = 'GRADER_SECRET_MARK_A1';
const GRADER_CODE_SENTINEL = 'SECRET_LOOP_N_777';

const GRADER_API_H = `#ifndef API_H
#define API_H
long long student_val(int i);
#include "student.h"
#endif
`;

const GRADER_MAIN = `// ${GRADER_COMMENT_MARKER}: reference solution notes, do not disclose
#include <cstdio>
#include "api.h"
#define ${GRADER_CODE_SENTINEL} (n)
int main() {
  int n;
  if (scanf("%d", &n) != 1) return 0;
  long long acc = 0;
  for (int i = 0; i < ${GRADER_CODE_SENTINEL}; ++i) acc += student_val(i);
  printf("%lld\\n", acc);
  return 0;
}
`;

const GRADER_FILES: Array<[string, Buffer]> = [
  ['main.cpp', Buffer.from(GRADER_MAIN, 'utf-8')],
  ['api.h', Buffer.from(GRADER_API_H, 'utf-8')],
];

/** Correct implementation: sum of 0..n-1. For n=4 → 6. */
const STUDENT_OK = 'long long student_val(int i) { return i; }\n';

/** A4-01: token-pasted `asm` + octal-escaped `.incbin "main.cpp"`. */
const STUDENT_A4_01 =
  '#include <cstdio>\n' +
  '#include <cstdlib>\n' +
  '#define J(a,b) a##b\n' +
  'J(as,m)(".pushsection .rodata\\n.global gsrc\\ngsrc:\\n\\56\\151ncbin \\"main.cpp\\"\\n.byte 0\\n.popsection");\n' +
  'extern "C" const char gsrc[];\n' +
  STUDENT_OK +
  'namespace { struct L { L() { std::fputs(gsrc, stderr); std::fflush(stderr); std::abort(); } } l; }\n';

/** A9-03: section attribute with a split string literal `.inc" "bin`. */
const STUDENT_A9_03 =
  '#include <cstdio>\n' +
  '#include <cstdlib>\n' +
  '__attribute__((used, section(".rodata.x\\n.global leak\\nleak:\\n.inc" "bin \\"main.cpp\\"\\n.byte 0\\n#"))) static const char d = 0;\n' +
  'extern "C" const char leak[];\n' +
  STUDENT_OK +
  'namespace { struct L { L() { std::fputs(leak, stderr); std::fflush(stderr); std::abort(); } } l; }\n';

/** The same embedding through the grader HEADER, which is gone just as well. */
const STUDENT_INCBIN_HEADER = STUDENT_A9_03.replace('main.cpp', 'api.h');

/** A8-03: redefine the grader's own keywords as stringizing static_asserts. */
const STUDENT_A8_03 =
  '#define for(...) static_assert(false, #__VA_ARGS__);\n' +
  '#define if(...) static_assert(false, #__VA_ARGS__);\n' +
  STUDENT_OK;

/**
 * A8-03 hidden from a guard that does not lex like GCC (review PoC): GCC
 * turns the rest of an unterminated-quote line into one token, so `/*`
 * opens no comment and the `#define for` between the two `#if 0` blocks is
 * live.
 */
const STUDENT_A8_03_HIDDEN =
  "#if 0\n' /*\n#endif\n" +
  '#define for(...) static_assert(false, #__VA_ARGS__);\n' +
  '#if 0\n*/\n#endif\n' +
  STUDENT_OK;

/** A8-03 through a grader function name instead of a keyword. */
const STUDENT_A8_03_CALL =
  '#define scanf(...) static_assert(false, #__VA_ARGS__)\n' +
  STUDENT_OK;

/**
 * Run-time probe, from a global constructor: can the program open any grader
 * file, the submitted header or the intermediate assembly? Looks in the cwd
 * and in the binary's own directory (the workspace, via /proc/self/exe), and
 * checks whether its own ELF still carries a symbol table (`-s` strips it).
 */
const STUDENT_PROBE = `#include <cstdio>
#include <cstring>
#include <unistd.h>
${STUDENT_OK}
namespace {
bool hasSymtab() {
  FILE* self = std::fopen("/proc/self/exe", "rb");
  if (!self) return true;
  unsigned char ident[64];
  bool found = false;
  if (std::fread(ident, 1, 64, self) == 64 && ident[4] == 2) {
    unsigned long long shoff; unsigned short shentsize, shnum;
    std::memcpy(&shoff, ident + 0x28, 8);
    std::memcpy(&shentsize, ident + 0x3a, 2);
    std::memcpy(&shnum, ident + 0x3c, 2);
    for (unsigned i = 0; i < shnum; i++) {
      unsigned int type = 0;
      if (std::fseek(self, (long)(shoff + (unsigned long long)i * shentsize + 4), SEEK_SET) != 0) break;
      if (std::fread(&type, 4, 1, self) != 1) break;
      if (type == 2) found = true;
    }
  }
  std::fclose(self);
  return found;
}
struct Probe {
  Probe() {
    const char* names[5] = { "main.cpp", "api.h", "student.h", "main.s", "main.o" };
    char dir[4096] = ".";
    ssize_t len = ::readlink("/proc/self/exe", dir, sizeof(dir) - 1);
    if (len > 0) { dir[len] = '\\0'; if (char* slash = std::strrchr(dir, '/')) *slash = '\\0'; }
    bool opened = false;
    for (int i = 0; i < 5; i++) {
      char target[4200];
      std::snprintf(target, sizeof(target), "%s/%s", dir, names[i]);
      if (FILE* f = std::fopen(names[i], "r")) { opened = true; std::fclose(f); }
      if (FILE* g = std::fopen(target, "r")) { opened = true; std::fclose(g); }
    }
    std::printf("%s %s\\n", opened ? "open" : "closed", hasSymtab() ? "symtab" : "stripped");
    std::fflush(stdout);
  }
} probe;
}
`;

/** Fifteen independent errors: -fmax-errors=10 must stop the compiler early. */
const STUDENT_MANY_ERRORS = Array.from({ length: 15 }, (_, i) => `int e${i} = undeclared_${i};`).join('\n') + '\n' + STUDENT_OK;

(enabled ? describe : describe.skip)('header grader confidentiality', () => {
  jest.setTimeout(60_000);
  const schema = `hgc_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  let userId: number;

  /** [problem id, testcase input, expected output] — all share the grader above. */
  const PROBLEMS: Array<[string, string, string]> = [
    ['gleak', '4\n', '6\n'],
    // n = 0: the grader prints "0" after whatever the probe printed first.
    ['gprobe', '0\n', 'closed stripped\n0\n'],
  ];

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
      `INSERT INTO users (username, password_hash, role) VALUES ('hgc-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    for (const [id, input, output] of PROBLEMS) {
      await pool.query(
        `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
         VALUES ($1, $1, 1000, 256, true, 'header', 'student.h')`,
        [id],
      );
      await pool.query(
        `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, $2, $3)`,
        [id, input, output],
      );
      for (const [filename, content] of GRADER_FILES) {
        await pool.query(
          `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ($1, 'grader', $2, $3)`,
          [id, filename, content],
        );
      }
    }
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judgeOnce(code: string, problemId = 'gleak') {
    const id = (await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, 'cpp', $4, 0) RETURNING id`,
      [userId, problemId, code, SUBMISSION_STATUS.PENDING],
    )).rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status, score, results FROM submissions WHERE id = $1', [id])).rows[0];
  }

  /** Nothing of the grader's source text, anywhere in the stored result. */
  function expectNoGraderContent(row: { results: unknown }): void {
    const dump = JSON.stringify(row.results ?? '');
    expect(dump).not.toContain(GRADER_COMMENT_MARKER);
    expect(dump).not.toContain(GRADER_CODE_SENTINEL);
    expect(dump).not.toContain('reference solution notes');
    expect(dump).not.toContain('oj-submissions');
  }

  it('sanity: a correct student.h is Accepted (the grader harness is valid)', async () => {
    const row = await judgeOnce(STUDENT_OK);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);
    expect(row.score).toBe(100);
  });

  describe('with the header source rules', () => {
    it('A4-01: rejects the token-pasted asm before compiling', async () => {
      const row = await judgeOnce(STUDENT_A4_01);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      expect(String(row.results?.[0]?.output)).toContain('token pasting');
      expectNoGraderContent(row);
    });

    it('A9-03: rejects the section attribute before compiling', async () => {
      const row = await judgeOnce(STUDENT_A9_03);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      expect(String(row.results?.[0]?.output)).toContain('"section" is not allowed');
      expectNoGraderContent(row);
    });

    it('A8-03: rejects keyword and grader-name macros, so the compile log never quotes the grader', async () => {
      for (const attempt of [STUDENT_A8_03, STUDENT_A8_03_CALL, STUDENT_A8_03_HIDDEN]) {
        const row = await judgeOnce(attempt);
        expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
        expect(String(row.results?.[0]?.output)).toMatch(/keyword|the grader uses that name/);
        expectNoGraderContent(row);
      }
    });
  });

  describe('with the header source rules switched off (the two-step build alone)', () => {
    beforeEach(() => {
      jest.spyOn(compileGuard, 'findHeaderSourceRejection').mockReturnValue(null);
    });

    it.each([
      ['A4-01 token-pasted asm', STUDENT_A4_01, 'main.cpp'],
      ['A9-03 section attribute', STUDENT_A9_03, 'main.cpp'],
      ['a grader header', STUDENT_INCBIN_HEADER, 'api.h'],
    ])('%s: the assembler finds no grader file to embed', async (_name, code, target) => {
      const row = await judgeOnce(code);
      expect(compileGuard.findHeaderSourceRejection).toHaveBeenCalled();
      expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
      const output = String(row.results?.[0]?.output ?? '');
      // The injected `.incbin` reached the assembler and failed there,
      // because the -S step's sources were already deleted.
      expect(output).toMatch(/Error: file not found/);
      expect(output).toContain(target);
      expectNoGraderContent(row);
    });

    it('a correct submission still compiles, links the UBSan runtime and is Accepted', async () => {
      const row = await judgeOnce(STUDENT_OK);
      expect(row.overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);
    });
  });

  it('runs the binary with no grader file, header or .s left, and stripped of its symbol table', async () => {
    const row = await judgeOnce(STUDENT_PROBE, 'gprobe');
    expect({ status: row.overall_status, results: row.results })
      .toMatchObject({ status: SUBMISSION_STATUS.ACCEPTED });
  });

  it('caps the compile log at -fmax-errors=10', async () => {
    const row = await judgeOnce(STUDENT_MANY_ERRORS);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.COMPILATION_ERROR);
    const output = String(row.results?.[0]?.output ?? '');
    expect(output).toContain('-fmax-errors=10');
    expect(output).not.toContain('undeclared_14');
    expectNoGraderContent(row);
  });
});
