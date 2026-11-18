import { validateProblemFileSet } from '../../utils/headerProblemFiles';
import {
  GRADER_SOURCE_FILENAME_SQL_REGEX,
  isGraderHeaderFilename,
  isGraderSourceFilename,
} from '../../utils/problemFilename';

/**
 * Grader file extensions (A4-06). g++ only compiles a name as C++ when its
 * suffix is one it recognises in that exact casing; any other casing
 * (`main.Cpp`) goes to ld as a linker script, so every student's correct
 * submission got a Compilation Error that blamed the student. Upload
 * validation, the readiness check (hasGraderSource) and the judge's compile
 * plan therefore share one exact, lowercase rule.
 */
describe('grader extensions g++ actually compiles (A4-06)', () => {
  const buf = (s: string) => Buffer.from(s, 'utf-8');
  const grader = (...names: string[]) =>
    validateProblemFileSet('grader', names.map((filename) => ({ filename, content: buf('int main(){}') })), 'student.h');

  it('accepts lowercase .cpp, .cc and .cxx sources with .h / .hpp headers', () => {
    expect(grader('main.cpp')).toBeNull();
    expect(grader('main.cc', 'queue.h')).toBeNull();
    expect(grader('main.cxx', 'api.hpp')).toBeNull();
  });

  it('rejects a grader named Main.Cpp — g++ treats it as a linker script', () => {
    expect(grader('Main.Cpp')).toContain('Main.Cpp');
  });

  it('rejects a grader set whose only source has a non-compiled casing', () => {
    expect(grader('grader.cPp')).not.toBeNull();
    expect(grader('main.CPP')).not.toBeNull();
  });

  it('rejects header casings outside .h / .hpp', () => {
    expect(grader('main.cpp', 'queue.H')).toContain('queue.H');
    expect(grader('main.cpp', 'queue.Hpp')).toContain('queue.Hpp');
  });

  it('still requires at least one source', () => {
    expect(grader('queue.h')).toContain('.cpp');
  });

  it('rejects two sources that would compile to the same .s file', () => {
    const error = grader('main.cpp', 'main.cc');
    expect(error).toContain('main.cpp');
    expect(error).toContain('main.cc');
  });

  it('holds C++-looking starter files to the same lowercase rule, and leaves other starter files alone', () => {
    // Students compile the starter main with their own g++, which has the
    // same linker-script trap; the include rules only know `.h` / `.hpp`.
    const starter = (filename: string) =>
      validateProblemFileSet('starter', [{ filename, content: buf('') }], 'student.h');
    expect(starter('Main.Cpp')).toContain('Main.Cpp');
    expect(starter('vector.H')).toContain('vector.H');
    expect(starter('main.cpp')).toBeNull();
    expect(starter('student.h')).toBeNull();
    expect(starter('sample.in')).toBeNull();
    expect(starter('README.TXT')).toBeNull();
  });

  it('uses one predicate for the plan and one regex for SQL', () => {
    const names = ['main.cpp', 'a.cc', 'b.cxx', 'Main.Cpp', 'x.CPP', 'y.c', 'z.h', 'w.cpp.txt'];
    const sqlRegex = new RegExp(GRADER_SOURCE_FILENAME_SQL_REGEX);
    expect(names.filter(isGraderSourceFilename)).toEqual(['main.cpp', 'a.cc', 'b.cxx']);
    expect(names.filter((name) => sqlRegex.test(name))).toEqual(['main.cpp', 'a.cc', 'b.cxx']);
    expect(['z.h', 'q.hpp', 'Z.H', 'main.cpp'].filter(isGraderHeaderFilename)).toEqual(['z.h', 'q.hpp']);
  });
});
