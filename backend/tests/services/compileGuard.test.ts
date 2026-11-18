import { findForbiddenAsm, findForbiddenInclude, findHeaderSourceRejection, findIncludeRejection } from '../../utils/compileGuard';
import { sanitizeCompilerStderr } from '../../services/submissionService';
import { SUBMISSION_VALIDATION } from '../../constants';

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

  // --- A4-07 / A9-07: the rest of the include family ----------------------
  // GCC honours #import and #include_next too, and both accept absolute
  // paths; the guard used to match `#include` only.

  it('rejects #import of an absolute path', () => {
    expect(findForbiddenInclude('#import "/etc/hostname"')).toBe('/etc/hostname');
  });

  it('rejects #include_next of an absolute path (angle form)', () => {
    expect(findForbiddenInclude('#include_next </etc/hostname>')).toBe('/etc/hostname');
  });

  it('rejects #include_next of an absolute path (quote form)', () => {
    expect(findForbiddenInclude('#include_next "/proc/self/environ"')).toBe('/proc/self/environ');
  });

  it('rejects #import of a traversing path', () => {
    expect(findForbiddenInclude('#import "../../app/.env"')).toBe('../../app/.env');
  });

  it('rejects #embed, whatever it names', () => {
    expect(findForbiddenInclude('#embed "/etc/passwd"')).toBe('#embed');
  });

  it('sees directives spelled with the %: digraph or a comment after #', () => {
    expect(findForbiddenInclude('%:include "/etc/passwd"')).toBe('/etc/passwd');
    expect(findForbiddenInclude('# /* c */ include "/etc/passwd"')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#/**/include_next </etc/passwd>')).toBe('/etc/passwd');
  });

  it('treats a lone CR as a line break, like GCC', () => {
    expect(findForbiddenInclude('int x; // note\r#include "/etc/passwd"\n')).toBe('/etc/passwd');
  });

  it('rejects absolute and traversing __has_include operands', () => {
    expect(findForbiddenInclude('#if __has_include("/etc/passwd")\n#endif')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#if __has_include_next(<../x.h>)\n#endif')).toBe('../x.h');
    expect(findForbiddenInclude('#if __has_include(<vector>)\n#endif')).toBeNull();
  });

  it('rejects path-like angle spans and escaped literals in macro bodies', () => {
    expect(findForbiddenInclude('#define E </etc/passwd>\n#include E')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#define E "\\x2f" "etc/passwd"\n#include E')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#define E "\\057etc/passwd"\n#include E')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#define F(x) "/etc/" #x\n#include F(passwd)')).toBe('/etc/');
  });

  it('ignores include-like text in comments and string literals', () => {
    expect(findForbiddenInclude('/*\n#include "/etc/passwd"\n*/\nint main(){}')).toBeNull();
    expect(findForbiddenInclude('const char* s = R"(\n#include "/etc/passwd"\n)";')).toBeNull();
  });

  it('does not mistake an ellipsis in a macro string for a traversal', () => {
    expect(findForbiddenInclude('#define dbg(x) std::cerr << #x << "..." << (x)\n#define MSG "Loading..."')).toBeNull();
  });

  it('leaves an unterminated #include for the compiler to report', () => {
    expect(findForbiddenInclude('#include <iostream\nint main(){}')).toBeNull();
  });
});

/**
 * The guard is only as good as its agreement with GCC's own lexer: wherever
 * the two disagree about where a comment or a literal starts, a submission
 * can hide a directive from the guard that g++ still runs. Every case below
 * was checked against g++ 14 (`-std=c++20`): g++ reads the hidden path.
 */
describe('lexing the way GCC does (review: guard bypasses)', () => {
  it('turns the rest of the line after an unterminated quote into one token, like GCC', () => {
    // GCC: `' /*` is one CPP_OTHER token, so there is no comment, and the
    // #include between the two #if 0 blocks is a live directive.
    for (const quote of ["'", '"']) {
      const code = `#if 0\n${quote} /*\n#endif\n#include "/etc/passwd"\n#if 0\n*/\n#endif\nint main(){}\n`;
      expect(findForbiddenInclude(code)).toBe('/etc/passwd');
    }
    // The same through an unterminated quoted header name.
    expect(findForbiddenInclude('#include "abc /*\n#include "/w/data.txt"\n// */\nint main(){}\n')).toBe('/w/data.txt');
    // An unterminated quote cannot open a raw string later on its line either.
    expect(findForbiddenInclude('int x = \'a R"q(\n#include "/etc/passwd"\n)q";\n')).toBe('/etc/passwd');
  });

  it('lexes every operand of an #include line as a header name, like GCC', () => {
    // GCC lexes `<x /* y>` as a header name (and ignores it as an extra
    // token), so the next line is a live directive.
    expect(findForbiddenInclude('#include <vector> <x /* y>\n#include "/etc/passwd"\n// */\n')).toBe('/etc/passwd');
    expect(findForbiddenInclude('#import <vector> <x /* y>\n#include "/etc/passwd"\n// */\n')).toBe('/etc/passwd');
    // ... in a skipped block too.
    expect(findForbiddenInclude('#if 0\n#include <x /* y>\n#endif\n#include "/etc/passwd"\n// */\n')).toBe('/etc/passwd');
    // A header name that only a macro in front of it turns into the operand.
    expect(findForbiddenInclude('#define E\n#include E "/w/data.txt"\nint main(){}\n')).toBe('/w/data.txt');
    expect(findForbiddenInclude('#define E\n#include E </etc/passwd>\n')).toBe('/etc/passwd');
  });

  it('follows GCC through digit separators', () => {
    // GCC: `1'` gives the separator back before `$` / `é`, so `'$/*'` is a
    // closed character literal and `/*` opens nothing.
    expect(findForbiddenInclude("int x = 1'$/*';\n#include \"/etc/passwd\"\n// */\n")).toBe('/etc/passwd');
    expect(findForbiddenInclude("int x = 1'é/*';\n#include \"/etc/passwd\"\n// */\n")).toBe('/etc/passwd');
    // And it keeps adjacent separators inside the number: no literal opens.
    expect(findForbiddenInclude("#if 0\nx 1'''a /*\nR\"q(\n*/\n#endif\n#include \"/etc/passwd\"\n)q\"\n")).toBe('/etc/passwd');
  });

  it('splices a backslash, NUL and newline the way GCC does', () => {
    // GCC treats NUL as whitespace between a backslash and the newline.
    expect(findForbiddenInclude('const char *s = "\\\u0000\n/*";\n#include "/etc/passwd"\n// */\n')).toBe('/etc/passwd');
  });

  it('keeps ordinary code with apostrophes in comments and #if 0 blocks', () => {
    const code = [
      '#include <bits/stdc++.h>',
      "// don't worry, it's fine",
      "/* the grader's main calls this */",
      '#if 0',
      "This doesn't compile yet; it's a draft.",
      "const char* t = \"it's\";",
      '#endif',
      "int sep = 1'000'000;",
      "char q = '\\'';",
      'int main(){}',
      '',
    ].join('\n');
    expect(findForbiddenInclude(code)).toBeNull();
  });
});

describe('findForbiddenInclude fails closed where it cannot read the code the way GCC does', () => {
  it('rejects a line splice inside a raw string (GCC reverts it, the line count shifts)', () => {
    const code = 'const char* s = R"x()\\\nx" /*\n)x";\n#include "/w/data.txt"\n// */\nint main(){}\n';
    expect(findForbiddenInclude(code)).not.toBeNull();
  });

  it('rejects a literal glued to a prefixed literal (GCC reads the prefix as a ud-suffix)', () => {
    expect(findForbiddenInclude('const char* s = "x"R"y(\n#include "/w/data.txt"\n)y";\nint main(){}\n')).not.toBeNull();
  });

  it('rejects malformed raw-string delimiters ($, @, `, non-ASCII), which GCC recovers from differently', () => {
    expect(findForbiddenInclude('const char* s = R"$(\n"\n#include "/etc/passwd"\n)$";\n')).not.toBeNull();
    expect(findForbiddenInclude('const char* s = R"a b(x)a b";\n')).not.toBeNull();
    // Valid delimiters are fine.
    expect(findForbiddenInclude('const char* s = R"#(x)#"; const char* t = R""(y)"";\n')).toBeNull();
  });

  it('rejects a backslash outside literals (universal character names)', () => {
    expect(findForbiddenInclude('int a\\N{LATIN SMALL LETTER E WITH ACUTE}R"x(\n#include "/etc/passwd"\n)x";\n')).not.toBeNull();
  });

  it('rejects a __has_include operand whose lexing depends on whether GCC evaluates it', () => {
    // Evaluated (#if, active text): `<x /* y>` is a header name; skipped or
    // in a #define body: `/*` opens a comment. Either way it is ambiguous.
    expect(findForbiddenInclude('#if __has_include <x /* y>\n#endif\n#include "/etc/passwd"\n// */\n')).not.toBeNull();
    expect(findForbiddenInclude('#if 0\nint a = __has_include(<x /* y>);\n#endif\n')).not.toBeNull();
    expect(findForbiddenInclude('#if __has_include("a\\" /*")\n#endif\n')).not.toBeNull();
    expect(findForbiddenInclude('#define LP (\n#if __has_include LP <x>)\n#endif\n')).not.toBeNull();
    // Plain operands lex the same both ways.
    expect(findForbiddenInclude('#if __has_include(<vector>) && __has_include("x.h")\n#endif\n#ifdef __has_include\n#endif\n')).toBeNull();
  });

  it('rejects #embed outright (GCC 14 lexes it as an unknown directive, GCC 15 would read the file)', () => {
    expect(findForbiddenInclude('const char d[] = {\n#embed "data.bin"\n};\n')).not.toBeNull();
  });
});

describe('findForbiddenInclude on computed includes and #line', () => {
  it('checks the include line itself, not only macro bodies', () => {
    // GCC: `LT` expands to `<`, the header name is `/w/data.txt`.
    expect(findForbiddenInclude('#define LT <\n#include LT/w/data.txt>\nint main(){}\n')).not.toBeNull();
    expect(findForbiddenInclude('#define S(x) #x\n#include S(/etc/passwd)\n')).not.toBeNull();
    expect(findForbiddenInclude('#define S(x) #x\n#include S(x/../../etc/passwd)\n')).not.toBeNull();
  });

  it('follows macros named on a computed include line to their bodies', () => {
    expect(findForbiddenInclude('#define LT <\n#define P /w/data.txt\n#include LT P>\n')).not.toBeNull();
    expect(findForbiddenInclude('#define LT <\n#define Q /etc/passwd\n#define P Q\n#include LT P>\n')).not.toBeNull();
    // A reserved name could come from a system header (`_PATH_*`).
    expect(findForbiddenInclude('#include <paths.h>\n#include _PATH_BSHELL\n')).not.toBeNull();
  });

  it('still allows computed includes of plain names', () => {
    expect(findForbiddenInclude('#define H <vector>\n#include H\n#define DIV(a, b) ((a) / (b))\n')).toBeNull();
  });

  it('rejects #line and line markers that name an absolute or traversing file (g++ prints its lines as caret context)', () => {
    expect(findForbiddenInclude('#line 1 "/w/data.txt"\nint x = ;\n')).toBe('/w/data.txt');
    expect(findForbiddenInclude('# 1 "/w/data.txt"\nint x = ;\n')).toBe('/w/data.txt');
    expect(findForbiddenInclude('#line 1 "../../app/.env"\n')).toBe('../../app/.env');
    expect(findForbiddenInclude('#define S(x) #x\n#line 1 S(/w/data.txt)\n')).not.toBeNull();
    expect(findForbiddenInclude('#line 20 "solution.cpp"\n#line 30\n')).toBeNull();
  });
});

describe('findIncludeRejection', () => {
  it('wraps a forbidden path in the submitter-facing message', () => {
    expect(findIncludeRejection('#include "/etc/passwd"\n')).toBe(
      'Compilation rejected: #include of a non-permitted path ("/etc/passwd") is not allowed. '
        + 'Use standard library headers (e.g. <bits/stdc++.h>) only.',
    );
  });

  it('names the line (and the file, when given) of a lexical rejection', () => {
    const code = 'int a;\nconst char* s = "x"R"y(z)y";\n';
    expect(findIncludeRejection(code)).toContain('(line 2)');
    expect(findIncludeRejection(code, 'student.h')).toContain('(student.h:2)');
    expect(findIncludeRejection('#embed "x"\n')).toContain('#embed is not allowed');
    expect(findIncludeRejection('#line 1 "/etc/passwd"\n')).toContain('#line');
  });

  it('returns null for ordinary code', () => {
    expect(findIncludeRejection('#include <bits/stdc++.h>\nint main(){}\n')).toBeNull();
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

  // --- A4-01 / A9-03: grader-embedding bypasses ---------------------------
  // GCC writes asm strings and section names into the assembly verbatim, so
  // any of these used to bake the grader's main.cpp into the binary.

  it('rejects the asm keyword assembled by token pasting + octal-escaped incbin (A4-01 PoC1)', () => {
    // `J(as,m)(...)` expands to `asm(...)`: the literal `asm` never appears,
    // and `\56\151ncbin` decodes to `.incbin` only inside the assembler.
    const code =
      '#define J(a,b) a##b\nJ(as,m)(".pushsection .rodata\\n\\56\\151ncbin \\"main.cpp\\"\\n.byte 0\\n.popsection");';
    expect(findForbiddenAsm(code)).toBe('##');
    expect(findForbiddenAsm('%:define J(a,b) a%:%:b')).toBe('##');
  });

  it('decodes escapes before looking for incbin in a string', () => {
    expect(findForbiddenAsm('const char* s = "\\56\\151ncbin";')).toBe('incbin');
    // Hex escapes are greedy, so `\x63` needs a literal break before `bin`.
    expect(findForbiddenAsm('const char* s = ".in\\x63" "bin";')).toBe('incbin');
    expect(findForbiddenAsm('const char* s = ".IN\\x43\\x42IN";')).toBe('incbin');
    expect(findForbiddenAsm('const char* s = ".IN\\u0043BIN";')).toBe('incbin');
  });

  it('rejects an .incbin smuggled through a section attribute with no asm keyword (A4-01 PoC2)', () => {
    const code =
      '__attribute__((used, section(".data.g\\n.globl gsrc\\ngsrc:\\n\\56\\151ncbin \\"main.cpp\\"\\n.byte 0\\n#"))) char gpad = 0;';
    expect(findForbiddenAsm(code)).toBe('section');
  });

  it('rejects an .incbin split across adjacent string literals (A9-03)', () => {
    // GCC concatenates `".inc" "bin ..."` before the assembler sees it.
    expect(findForbiddenAsm('const char* s = ".inc" "bin \\"main.cpp\\"";')).toBe('incbin');
    expect(findForbiddenAsm('const char* s = ".inc"\n  "bin";')).toBe('incbin');
    const code =
      '__attribute__((used, section(".rodata.x\\n.global leak\\nleak:\\n.inc" "bin \\"main.cpp\\"\\n.byte 0\\n#"))) static const char d = 0;';
    expect(findForbiddenAsm(code)).not.toBeNull();
  });

  it('rejects a section attribute whatever escapes hide its payload (A9-03)', () => {
    const code = '__attribute__((section(".x\\n.in\\x63bin \\"main.cpp\\"\\n#"))) char d = 0;';
    expect(findForbiddenAsm(code)).not.toBeNull();
  });

  it('rejects every attribute and directive whose string reaches the assembler verbatim', () => {
    expect(findForbiddenAsm('[[gnu::section(".x")]] char d;')).toBe('section');
    expect(findForbiddenAsm('<:<:gnu::__section__(".x"):>:> char d;')).toBe('__section__');
    expect(findForbiddenAsm('static int g __attribute__((weakref("x")));')).toBe('weakref');
    expect(findForbiddenAsm('int f() __attribute__((symver("f@V1")));')).toBe('symver');
    expect(findForbiddenAsm('#ident "x"')).toBe('#ident');
    expect(findForbiddenAsm('%:sccs "x"')).toBe('#sccs');
  });

  it('sees asm through a backslash-space-newline splice', () => {
    expect(findForbiddenAsm('as\\ \nm("nop");')).toBe('asm');
  });

  it('reads raw strings verbatim instead of decoding them', () => {
    expect(findForbiddenAsm('const char* s = R"x(\\56\\151ncbin)x";')).toBeNull();
    expect(findForbiddenAsm('const char* s = R"x(.incbin)x";')).toBe('incbin');
  });
});

describe('guard cost on hostile input', () => {
  // The guards run synchronously in the API process for every submission, so
  // a quadratic path is a denial of service: a 64 KiB `#define X <<<...>`
  // used to block the event loop for ~40 s. Each input below hits one path
  // that is linear now (spans grouped by their `>`, memoised unterminated
  // quotes, bounded literal runs, binary-searched splices); the budget is
  // generous for a loaded machine and still far below the old cost.
  const N = SUBMISSION_VALIDATION.MAX_CODE_LENGTH;
  const context = { submissionFilename: 'student.h', graderFiles: [], starterFilenames: [] };
  const hostile: Array<[string, string]> = [
    ['angle spans in a macro body', `#define X ${'<'.repeat(N - 12)}>`],
    ['spaced angle spans', `#define X ${'< a '.repeat((N - 12) / 4)}>`],
    ['unterminated escaped quotes', '"\\'.repeat(N / 2)],
    ['unterminated escaped char quotes', "'\\".repeat(N / 2)],
    ['adjacent string literals', `const char* s = ${'"ab" '.repeat((N - 20) / 5)};`],
    ['raw strings between splices', 'R"(a)" \\\n'.repeat(Math.floor(N / 9))],
    ['unclosed angle header names on an include line', `#include ${'<'.repeat(N - 10)}`],
    ['closed angle header names on an include line', `#include ${'<a>'.repeat(Math.floor((N - 10) / 3))}`],
    ['__has_include operands', `#if ${'__has_include(<a>) || '.repeat(Math.floor((N - 10) / 24))}0\n#endif`],
    ['digit separators', `int x = 1${"'".repeat(N - 20)};`],
    ['macro chains behind computed includes', Array.from({ length: Math.floor(N / 40) }, (_, k) =>
      (k % 2 === 0 ? `#define M${k} M${k - 1} /\n` : `#include M${k - 1}\n`)).join('')],
  ];

  it.each(hostile)('%s', (_name, code) => {
    expect(code.length).toBeLessThanOrEqual(N);
    const started = Date.now();
    findForbiddenInclude(code);
    findForbiddenAsm(code);
    findHeaderSourceRejection(code, context);
    expect(Date.now() - started).toBeLessThan(3000);
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
