import fs from 'node:fs';
import path from 'node:path';
import { findHeaderSourceRejection, type HeaderSourceContext } from '../../utils/compileGuard';

/**
 * Header-problem source rules (defence in depth over the two-step build).
 * The submission is compiled in the same translation unit as the problem's
 * SECRET grader, so it must not be able to rewrite or stringize grader code
 * into a diagnostic (A8-03), pull a grader file in by name, or reach the
 * assembler (A4-01 / A9-03) — and no rejection may quote grader content.
 */

const GRADER_SECRET_COMMENT = 'GRADER_SECRET_NOTES_42';
const GRADER_MAIN = `// ${GRADER_SECRET_COMMENT}: the reference checks live here
#include <cstdio>
#include "vector.h"
#include "student.h"
#define SECRET_LIMIT 777
int main() {
  int n;
  if (scanf("%d", &n) != 1) return 0;
  for (int i = 0; i < SECRET_LIMIT; ++i) std::printf("%d\\n", check_value(i));
  return 0;
}
`;
const GRADER_VECTOR = `#ifndef _CP_VECTOR_INCLUDED_
#define _CP_VECTOR_INCLUDED_
namespace CP { template <typename T> class vector { T *mData; public: void fill(const T &value); }; }
#endif
`;

const CONTEXT: HeaderSourceContext = {
  submissionFilename: 'student.h',
  graderFiles: [
    { filename: 'main.cpp', content: Buffer.from(GRADER_MAIN) },
    { filename: 'vector.h', content: Buffer.from(GRADER_VECTOR) },
  ],
  starterFilenames: ['main.cpp', 'student.h', 'vector.h'],
};

const reject = (code: string, context: HeaderSourceContext = CONTEXT) => findHeaderSourceRejection(code, context);

const STUDENT_OK = `#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
#include <algorithm>
using namespace std;
template <typename T>
void CP::vector<T>::fill(const T &value) { std::fill(mData, mData + 1, value); }
inline int check_value(int i) { return i; }
#endif
`;

describe('findHeaderSourceRejection', () => {
  it('accepts an ordinary student header', () => {
    expect(reject(STUDENT_OK)).toBeNull();
  });

  describe('include family', () => {
    it('allows <standard> headers and the public starter headers by exact name', () => {
      expect(reject('#include <bits/stdc++.h>\n#include "vector.h"\n#include_next <vector>\n')).toBeNull();
    });

    it('rejects a quoted include of anything that is not a public header — the grader main included', () => {
      const message = reject('#include "main.cpp"\n');
      expect(message).toContain('student.h:1');
      expect(message).toContain('"main.cpp"');
      expect(message).toContain('"vector.h"');
      expect(reject('#include "secret_checker.h"\n')).toContain('not allowed');
      expect(reject('#import "student.h"\n')).toContain('not allowed');
      expect(reject('#include "./vector.h"\n')).toContain('not allowed');
    });

    it('lists no headers when the problem has no public header', () => {
      const message = reject('#include "vector.h"\n', { ...CONTEXT, starterFilenames: ['main.cpp', 'student.h'] });
      expect(message).toContain('standard headers (<...>) only');
    });

    it('rejects angle includes with .., a backslash or a leading /', () => {
      expect(reject('#include <../vector.h>\n')).toContain('".."');
      expect(reject('#include <a\\b.h>\n')).toContain('not allowed');
      expect(reject('#include_next < /etc/passwd>\n')).toContain('not allowed');
    });

    it('rejects computed includes, whatever the macro holds', () => {
      expect(reject('#define H <vector>\n#include H\n')).toContain('not through a macro');
      expect(reject('#import HDR(x)\n')).toContain('not through a macro');
    });

    it('rejects #embed outright (GCC 15 would read the grader bytes at compile time)', () => {
      expect(reject('const char d[] = {\n#embed "vector.h"\n};\n')).toContain('#embed is not allowed');
    });

    it('sees through comments, digraphs and line splices in the directive', () => {
      expect(reject('# /* note */ include "main.cpp"\n')).toContain('not allowed');
      expect(reject('%:include "main.cpp"\n')).toContain('not allowed');
      expect(reject('#inc\\\nlude "main.cpp"\n')).toContain('not allowed');
    });
  });

  describe('macros (A8-03)', () => {
    it('rejects redefining a C++ keyword to stringize the grader\'s own code', () => {
      const message = reject('#define for(...) static_assert(false, #__VA_ARGS__);\n');
      expect(message).toContain('C++ keyword "for"');
      expect(reject('#define if(...) static_assert(false, #__VA_ARGS__);\n')).toContain('"if"');
      expect(reject('#undef while\n')).toContain('"while"');
      expect(reject('#define and &&\n')).toContain('"and"');
    });

    it('rejects #define / #undef of any identifier the grader uses', () => {
      expect(reject('#define printf(...) static_assert(false, #__VA_ARGS__)\n')).toContain('the grader uses that name');
      expect(reject('#define scanf(...) 0\n')).toContain('"scanf"');
      expect(reject('#undef SECRET_LIMIT\n#define SECRET_LIMIT 1\n')).toContain('"SECRET_LIMIT"');
      expect(reject('#define mData mOther\n')).toContain('"mData"');
      // ... including the grader header's own include guard.
      expect(reject('#define _CP_VECTOR_INCLUDED_\n')).toContain('_CP_VECTOR_INCLUDED_');
    });

    it('rejects function-like or non-empty defines of reserved names, but allows an include guard', () => {
      expect(reject('#define __builtin_offsetof(...) static_assert(false, #__VA_ARGS__)\n')).toContain('reserved name');
      expect(reject('#define _Hidden 1\n')).toContain('reserved name');
      expect(reject('#ifndef _STUDENT_H\n#define _STUDENT_H\n#endif\n')).toBeNull();
      expect(reject('#define __MY_GUARD__ /* empty */\n')).toBeNull();
    });

    it('allows the submission\'s own macros', () => {
      expect(reject('#define ll long long\n#define REP(i, n) for (int i = 0; i < (n); ++i)\n#undef ll\n')).toBeNull();
    });

    it('takes identifiers from grader code only, not from its comments or strings', () => {
      expect(reject('#define reference 1\n#define checks 2\n')).toBeNull();
    });

    it('never quotes grader content in a rejection', () => {
      const attempts = [
        '#define for(...) static_assert(false, #__VA_ARGS__);\n',
        '#define printf(...) x\n',
        '#include "main.cpp"\n',
        '#define SECRET_LIMIT 3\n',
        'asm(".incbin \\"main.cpp\\"");\n',
      ];
      for (const attempt of attempts) {
        const message = reject(attempt) ?? '';
        expect(message).not.toBe('');
        expect(message).not.toContain(GRADER_SECRET_COMMENT);
        expect(message).not.toContain('scanf("%d"');
        expect(message).not.toContain('777');
      }
    });
  });

  describe('assembler embedding (A4-01 / A9-03)', () => {
    it('keeps the inline-assembly message for asm keywords', () => {
      expect(reject('asm(".incbin \\"main.cpp\\"");\n'))
        .toBe('Compilation rejected: inline assembly ("asm") is not allowed in this problem.');
      expect(reject('void f() { __asm__ volatile(""); }\n')).toContain('"__asm__"');
    });

    it('rejects token pasting, section attributes, #ident and embedded incbin', () => {
      expect(reject('#define J(a,b) a##b\nJ(as,m)("nop");\n')).toContain('token pasting');
      expect(reject('__attribute__((section(".x"))) char d;\n')).toContain('"section"');
      expect(reject('#ident "x"\n')).toContain('#ident');
      expect(reject('const char* s = ".inc" "bin";\n')).toContain('"incbin"');
    });

    it('reports the line of the offending construct', () => {
      expect(reject('int a;\nint b;\n__attribute__((section(".x"))) char d;\n')).toContain('student.h:3');
    });
  });

  describe('lexical ambiguity', () => {
    it('rejects a backslash outside literals (universal character names in identifiers)', () => {
      expect(reject('int \\u0061sm_x = 1;\n')).toContain('backslash outside');
    });

    it('rejects a line splice inside a raw string, where GCC keeps the backslash', () => {
      expect(reject('const char* s = R"x(a\\\nb)x";\n')).toContain('raw string');
    });

    it('rejects unterminated and malformed raw strings', () => {
      expect(reject('const char* s = R"x(never closed\n')).toContain('raw string');
      expect(reject('const char* s = R"a b(x)a b";\n')).toContain('raw string');
    });

    it('rejects a literal glued to a prefixed literal (GCC splits it only when the word is a macro)', () => {
      expect(reject('const char* s = "x"R"y(z)y";\n')).toContain('put a space');
    });

    it('rejects delimited and named escapes the guard cannot decode', () => {
      expect(reject('const char* s = ".in\\N{LATIN SMALL LETTER C}bin";\n')).toContain('escape');
      expect(reject('const char* s = ".in\\x{63}bin";\n')).toContain('escape');
    });

    it('keeps directives hidden in raw strings and comments out of the rules, as GCC does', () => {
      expect(reject('const char* s = R"(\n#include "main.cpp"\n#define for x\n)";\n')).toBeNull();
      expect(reject('/*\n#include "main.cpp"\n*/\n// #define for x\n')).toBeNull();
    });

    it('treats a lone CR as a line break, as GCC does', () => {
      expect(reject('int x; // comment\r#define for(...) x\n')).toContain('"for"');
    });
  });
});

/**
 * Every bundled header problem's own headers (reference solution, naive
 * solution, starter template) must pass the rules against that problem's
 * real grader and starter file sets. The sets are rebuilt the way
 * content/header-problems/build.py ships them: grader = main.cpp
 * (grader_main.cpp) + <ds>.h, starter = main.cpp (starter_main.cpp) + <ds>.h +
 * student.h, where <ds>.h is lib/<topic>.h with meta.json's declarations
 * injected at the marker.
 */
const contentDir = path.resolve(process.env.HEADER_PROBLEMS_CONTENT ?? path.join(__dirname, '../../../content/header-problems'));
const problemsDir = path.join(contentDir, 'problems');
const contentPresent = fs.existsSync(problemsDir);
const TOPIC_HEADERS: Record<string, string> = {
  pair: 'pair.h', vector: 'vector.h', stack: 'stack.h', queue: 'queue.h', priority_queue: 'priority_queue.h',
};

/** harness.py compose_header: the declarations replace the marker line, at its indentation. */
function composeHeader(topic: string, declarations: string[]): string {
  const template = fs.readFileSync(path.join(contentDir, 'lib', TOPIC_HEADERS[topic]), 'utf8');
  const marker = template.split('\n').find((line) => line.includes('// @@DECLARATIONS@@'));
  if (!marker) throw new Error(`no declarations marker in lib/${TOPIC_HEADERS[topic]}`);
  const indent = marker.slice(0, marker.length - marker.trimStart().length);
  const injected = declarations.flatMap((entry) => entry.split('\n')).map((line) => (line.trim() ? indent + line : ''));
  return template.replace(marker, injected.join('\n'));
}

(contentPresent ? describe : describe.skip)('bundled header problems pass the header rules', () => {
  const ids = contentPresent ? fs.readdirSync(problemsDir).filter((id) => id.startsWith('hp_')).sort() : [];

  it('finds the 50 bundled problems', () => {
    expect(ids).toHaveLength(50);
  });

  it.each(ids)('%s', (id) => {
    const dir = path.join(problemsDir, id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as {
      topic: string; declarations: string[]; submission_filename?: string;
    };
    const ds = TOPIC_HEADERS[meta.topic];
    const header = composeHeader(meta.topic, meta.declarations);
    const submissionFilename = meta.submission_filename ?? 'student.h';
    const context: HeaderSourceContext = {
      submissionFilename,
      graderFiles: [
        { filename: 'main.cpp', content: fs.readFileSync(path.join(dir, 'grader_main.cpp')) },
        { filename: ds, content: Buffer.from(header) },
      ],
      starterFilenames: ['main.cpp', ds, submissionFilename],
    };
    for (const file of ['solution.h', 'slow.h', 'student_template.h']) {
      const code = fs.readFileSync(path.join(dir, file), 'utf8');
      expect({ file, rejection: findHeaderSourceRejection(code, context) }).toEqual({ file, rejection: null });
    }
  });
});
