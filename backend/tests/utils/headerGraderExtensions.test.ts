import { validateProblemFileSet, validateProblemFilename } from '../../utils/headerProblemFiles';
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
 * plan therefore share one exact, case-sensitive list: the suffixes g++
 * itself compiles as C++ (`.CPP` and `.C` included, `.Cpp` and `.CXX` not).
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

  it('accepts every other suffix g++ compiles as C++, in its exact casing (.CPP, .C, .cp, .c++)', () => {
    // g++ (gcc/cp/lang-specs.h): .cc .cp .cxx .cpp .CPP .c++ .C are C++.
    expect(grader('main.CPP')).toBeNull();
    expect(grader('main.C')).toBeNull();
    expect(grader('main.cp')).toBeNull();
    expect(grader('main.c++', 'queue.h')).toBeNull();
  });

  it('rejects a grader named Main.Cpp — g++ treats it as a linker script', () => {
    expect(grader('Main.Cpp')).toContain('Main.Cpp');
  });

  it('rejects any other casing with a message that lists the accepted suffixes', () => {
    for (const name of ['grader.cPp', 'main.CXX', 'main.CC', 'main.Cxx', 'main.CP', 'main.C++', 'main.c', 'main.ii']) {
      const error = grader(name);
      expect({ name, error }).toEqual({ name, error: expect.stringContaining(name) });
      expect(error).toContain('.CPP');
    }
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
    expect(grader('main.C', 'main.CPP')).not.toBeNull();
  });

  it('holds C++-looking starter files to the same casing rule, and leaves other starter files alone', () => {
    // Students compile the starter main with their own g++, which has the
    // same linker-script trap; the include rules only know `.h` / `.hpp`.
    const starter = (filename: string) =>
      validateProblemFileSet('starter', [{ filename, content: buf('') }], 'student.h');
    expect(starter('Main.Cpp')).toContain('Main.Cpp');
    expect(starter('vector.H')).toContain('vector.H');
    expect(starter('main.CXX')).toContain('main.CXX');
    expect(starter('main.cpp')).toBeNull();
    expect(starter('main.CPP')).toBeNull();
    expect(starter('main.C')).toBeNull();
    expect(starter('helper.c')).toBeNull();
    expect(starter('student.h')).toBeNull();
    expect(starter('sample.in')).toBeNull();
    expect(starter('README.TXT')).toBeNull();
  });

  it('uses one predicate for the plan and one regex for SQL', () => {
    const names = ['main.cpp', 'a.cc', 'b.cxx', 'c.CPP', 'd.C', 'e.cp', 'f.c++', 'Main.Cpp', 'x.CXX', 'y.c', 'z.h', 'w.cpp.txt', 'v.c+', 'u.ii'];
    const accepted = ['main.cpp', 'a.cc', 'b.cxx', 'c.CPP', 'd.C', 'e.cp', 'f.c++'];
    const sqlRegex = new RegExp(GRADER_SOURCE_FILENAME_SQL_REGEX);
    expect(names.filter(isGraderSourceFilename)).toEqual(accepted);
    expect(names.filter((name) => sqlRegex.test(name))).toEqual(accepted);
    expect(['z.h', 'q.hpp', 'Z.H', 'main.cpp'].filter(isGraderHeaderFilename)).toEqual(['z.h', 'q.hpp']);
  });

  it('allows "+" inside a file name, so a .c++ grader can be uploaded', () => {
    expect(validateProblemFilename('main.c++')).toBeNull();
    expect(validateProblemFilename('+main.cpp')).not.toBeNull();
  });
});
