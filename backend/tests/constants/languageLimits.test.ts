import {
  LANGUAGE_LIMITS,
  LANGUAGE_PREPARE,
  SUPPORTED_LANGUAGES,
} from '../../constants';

describe('language constants', () => {
    describe('SUPPORTED_LANGUAGES', () => {
        it('contains exactly cpp and python', () => {
            expect([...SUPPORTED_LANGUAGES]).toEqual(['cpp', 'python']);
        });
    });

    describe('LANGUAGE_LIMITS multipliers', () => {
        it('gives C++ the identity multipliers (1x time, 1x memory)', () => {
            expect(LANGUAGE_LIMITS.cpp).toEqual({ timeMultiplier: 1, memoryMultiplier: 1 });
        });

        it('gives Python 4x time and 2x memory', () => {
            expect(LANGUAGE_LIMITS.python).toEqual({ timeMultiplier: 4, memoryMultiplier: 2 });
        });

        it('defines limits for every supported language', () => {
            for (const language of SUPPORTED_LANGUAGES) {
                expect(LANGUAGE_LIMITS[language]).toBeDefined();
            }
        });
    });

    describe('LANGUAGE_PREPARE', () => {
        it('defines a prepare entry for every supported language', () => {
            for (const language of SUPPORTED_LANGUAGES) {
                expect(LANGUAGE_PREPARE[language]).toBeDefined();
            }
        });

        it('compiles C++ with the exact g++ flags used today', () => {
            expect(LANGUAGE_PREPARE.cpp.sourceExtension).toBe('.cpp');
            // The command template references the source and output paths.
            expect(LANGUAGE_PREPARE.cpp.checkCommand('/src/s.cpp', '/out/s.out'))
                .toBe('g++ -std=c++20 -fsanitize=signed-integer-overflow /src/s.cpp -o /out/s.out');
        });

        it('syntax-checks Python via py_compile', () => {
            expect(LANGUAGE_PREPARE.python.sourceExtension).toBe('.py');
            expect(LANGUAGE_PREPARE.python.checkCommand('/src/s.py', '/out/s.out'))
                .toBe('python3 -m py_compile /src/s.py');
        });

        it('runs the C++ binary directly and Python through the interpreter', () => {
            expect(LANGUAGE_PREPARE.cpp.runCommand('/out/s.out')).toEqual({
                command: '/out/s.out',
                args: [],
            });
            expect(LANGUAGE_PREPARE.python.runCommand('/src/s.py')).toEqual({
                command: 'python3',
                args: ['/src/s.py'],
            });
        });

        it('compiles (produces an artifact) for C++ but not for Python', () => {
            expect(LANGUAGE_PREPARE.cpp.compiledArtifactPath('/out/s.out')).toBe('/out/s.out');
            expect(LANGUAGE_PREPARE.python.compiledArtifactPath('/out/s.out')).toBeNull();
        });
    });
});
