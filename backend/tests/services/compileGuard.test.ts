import { findForbiddenAsm, findForbiddenInclude } from '../../utils/compileGuard';
import { sanitizeCompilerStderr } from '../../services/submissionService';

/**
 * Unit tests for the compile-time hardening (security item N1):
 * - block #include directives that read files outside the submission, which
 *   would otherwise let a source exfiltrate secrets / read arbitrary files via
 *   g++ error output (e.g. `#include "/proc/self/environ"`);
 * - strip the internal temp source path from returned compiler diagnostics.
 */
describe('findForbiddenInclude', () => {
  it('allows ordinary standard-library and relative includes', () => {
    expect(findForbiddenInclude('#include <bits/stdc++.h>\nint main(){}')).toBeNull();
    expect(findForbiddenInclude('#include <iostream>\n#include <vector>')).toBeNull();
    expect(findForbiddenInclude('#include "helper.h"')).toBeNull();
    expect(findForbiddenInclude('int main(){ return 0; }')).toBeNull();
  });

  it('rejects absolute-path includes (quote form) — the secret-exfil vector', () => {
    expect(findForbiddenInclude('#include "/proc/self/environ"')).toBe('/proc/self/environ');
    expect(findForbiddenInclude('#include "/etc/shadow"\nint main(){}')).toBe('/etc/shadow');
  });

  it('rejects absolute-path includes (angle form)', () => {
    expect(findForbiddenInclude('#include </etc/passwd>')).toBe('/etc/passwd');
  });

  it('rejects parent-directory traversal', () => {
    expect(findForbiddenInclude('#include "../../app/.env"')).toBe('../../app/.env');
    expect(findForbiddenInclude('#include "../secret.txt"')).toBe('../secret.txt');
  });

  it('handles odd-but-valid whitespace in the directive', () => {
    expect(findForbiddenInclude('  #  include   "/proc/self/environ"  ')).toBe('/proc/self/environ');
    expect(findForbiddenInclude('#include <  cstdio  >')).toBeNull();
  });

  it('returns the first offending include when several are present', () => {
    const code = '#include <iostream>\n#include "/proc/self/environ"\n#include "/etc/shadow"';
    expect(findForbiddenInclude(code)).toBe('/proc/self/environ');
  });

  // --- RUNNER-001 bypass forms --------------------------------------------
  // The literal-only regex was bypassable via macro includes and
  // backslash-newline continuation; these must all be rejected now.

  it('rejects macro includes whose #define body is an absolute path', () => {
    expect(findForbiddenInclude('#define E "/proc/1/environ"\n#include E')).toBe('/proc/1/environ');
  });

  it('rejects macro includes built from concatenated string literals', () => {
    expect(findForbiddenInclude('#define E "/proc/" "1/environ"\n#include E')).toBe('/proc/1/environ');
  });

  it('rejects macro include chains where the path is defined in pieces', () => {
    expect(findForbiddenInclude('#define A "/proc/1/"\n#define B A "environ"\n#include B')).toBe('/proc/1/');
  });

  it('rejects absolute paths hidden behind backslash-newline continuation', () => {
    const continued = '#include "/et\\\nc/passwd"';
    expect(findForbiddenInclude(continued)).toBe('/etc/passwd');
    const macroContinued = '#define P "/et\\\nc/passwd"\n#include P';
    expect(findForbiddenInclude(macroContinued)).toBe('/etc/passwd');
  });

  it('rejects traversal paths hidden in #define bodies', () => {
    expect(findForbiddenInclude('#define H "../../app/.env"\n#include H')).toBe('../../app/.env');
  });

  it('still allows benign macro includes and defines', () => {
    // A macro include with no dangerous define in the file.
    expect(findForbiddenInclude('#include E')).toBeNull();
    // Ordinary non-path defines (numbers, type aliases, strings without / or ..).
    expect(findForbiddenInclude('#define N 100\n#define X std::vector<int>\n#define NAME "problem"\n#include <iostream>')).toBeNull();
    // Comment between directive parts must not splice into a path.
    expect(findForbiddenInclude('#include <ios/* comment */tream>')).toBeNull();
  });
});

describe('findForbiddenAsm', () => {
  it('rejects inline asm keywords used to embed files', () => {
    expect(findForbiddenAsm('asm(".incbin \\"main.cpp\\"")')).toBe('asm');
    expect(findForbiddenAsm('__asm__ volatile("")')).toBe('__asm__');
    expect(findForbiddenAsm('__asm volatile("")')).toBe('__asm');
  });

  it('rejects incbin and .include directives anywhere in the code', () => {
    expect(findForbiddenAsm('const char* s = "incbin";')).toBe('incbin');
    expect(findForbiddenAsm('x .include y')).toBe('.include');
  });

  it('does not match asm as a substring of a longer identifier', () => {
    expect(findForbiddenAsm('int plasma = 1;')).toBeNull();
    expect(findForbiddenAsm('int spasm;')).toBeNull();
  });

  it('ignores asm and incbin inside comments', () => {
    expect(findForbiddenAsm('// asm\nint x;')).toBeNull();
    expect(findForbiddenAsm('/* asm */ int x;')).toBeNull();
    expect(findForbiddenAsm('/* incbin */ int x;')).toBeNull();
  });

  it('does not let a // inside a string literal hide following code', () => {
    expect(findForbiddenAsm('const char* u = "http://x"; asm("nop");')).toBe('asm');
  });

  it('sees through backslash-newline continuation', () => {
    expect(findForbiddenAsm('as\\\nm("nop");')).toBe('asm');
  });

  it('allows ordinary code', () => {
    expect(findForbiddenAsm('#include <bits/stdc++.h>\nint main(){ return 0; }')).toBeNull();
  });
});

describe('sanitizeCompilerStderr', () => {
  it('replaces the internal temp source path with a neutral name', () => {
    const tempPath = '/usr/src/app/services/submissions/42_1700000000000.cpp';
    const raw = `${tempPath}: In function 'int main()':\n${tempPath}:3:5: error: expected ';'`;
    const out = sanitizeCompilerStderr(raw, tempPath);
    expect(out).not.toContain(tempPath);
    expect(out).toContain('solution.cpp');
    expect(out).toContain("error: expected ';'");
  });

  it('returns a generic message when stderr is empty/undefined', () => {
    expect(sanitizeCompilerStderr('', '/tmp/x.cpp')).toBe('Compilation failed');
    expect(sanitizeCompilerStderr(undefined, '/tmp/x.cpp')).toBe('Compilation failed');
  });

  it('strips workspace paths from diagnostics by default', () => {
    const raw = '/tmp/oj-submissions/sub_1_2_abc/solution.cpp:3:5: error: expected \';\'';
    const out = sanitizeCompilerStderr(raw, 'solution.cpp');
    expect(out).not.toContain('oj-submissions');
    expect(out).toContain('solution.cpp:3:5: error');
  });

  it('keeps the submitted file name for header problems, path-stripped to its basename', () => {
    // A header submission is a named file (student.h) compiled with the
    // problem's grader sources: diagnostics MUST keep pointing at the real
    // file the student wrote, so the neutral rename is off — only server
    // paths are stripped.
    const raw = 'In file included from main.cpp:1:\n'
      + 'student.h:3:5: error: expected \';\'\n'
      + '/tmp/oj-submissions/sub_1_2_abc/student.h:4:1: error: stray token';
    const out = sanitizeCompilerStderr(raw, 'student.h', 'cpp', { keepSourceName: true });
    expect(out).toContain('student.h:3:5: error');
    expect(out).toContain('student.h:4:1: error: stray token');
    expect(out).not.toContain('solution.cpp');
    expect(out).not.toContain('oj-submissions');
  });
});
