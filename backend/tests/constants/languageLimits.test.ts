import {
  JAVA_CONFIG,
  JUDGE_CONFIG,
  LANGUAGE_LIMITS,
  LANGUAGE_PREPARE,
  SUPPORTED_LANGUAGES,
  effectiveLimits,
} from '../../constants';

describe('language constants', () => {
    describe('SUPPORTED_LANGUAGES', () => {
        it('contains exactly cpp, python and java', () => {
            expect([...SUPPORTED_LANGUAGES]).toEqual(['cpp', 'python', 'java']);
        });
    });

    describe('LANGUAGE_LIMITS multipliers', () => {
        it('gives C++ the identity multipliers (1x time, 1x memory)', () => {
            expect(LANGUAGE_LIMITS.cpp).toMatchObject({ timeMultiplier: 1, memoryMultiplier: 1, timeOffsetMs: 0, rssOverheadMb: 0 });
        });

        it('gives Python 4x time and 2x memory', () => {
            expect(LANGUAGE_LIMITS.python).toMatchObject({ timeMultiplier: 4, memoryMultiplier: 2, timeOffsetMs: 0, rssOverheadMb: 0 });
        });

        it('gives Java 2x time + 500 ms and a 1x heap clamped to 16..512 MB', () => {
            expect(LANGUAGE_LIMITS.java).toMatchObject({
                timeMultiplier: 2,
                timeOffsetMs: 500,
                memoryMultiplier: 1,
                memoryFloorMb: 16,
                memoryCeilingMb: 512,
                oomExitCode: 3,
            });
        });

        it('treats only Java\'s exit code as OOM evidence', () => {
            expect(LANGUAGE_LIMITS.cpp.oomExitCode).toBeUndefined();
            expect(LANGUAGE_LIMITS.python.oomExitCode).toBeUndefined();
        });

        it('defines limits for every supported language', () => {
            for (const language of SUPPORTED_LANGUAGES) {
                expect(LANGUAGE_LIMITS[language]).toBeDefined();
            }
        });
    });

    describe('effectiveLimits', () => {
        const slack = JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB;

        it('keeps the C++ limits exactly as before', () => {
            expect(effectiveLimits('cpp', 1000, 256)).toEqual({ timeMs: 1000, memoryMb: 256, rssLimitMb: 256, asLimitMb: 256 + slack });
        });

        it('keeps the Python limits exactly as before', () => {
            expect(effectiveLimits('python', 1000, 256)).toEqual({ timeMs: 4000, memoryMb: 512, rssLimitMb: 512, asLimitMb: 512 + slack });
        });

        it('gives Java a heap equal to the limit, an RSS allowance and an address-space grace', () => {
            expect(effectiveLimits('java', 1000, 256)).toEqual({
                timeMs: 2500,
                memoryMb: 256,
                rssLimitMb: 256 + JAVA_CONFIG.RSS_OVERHEAD_MB,
                asLimitMb: 256 + JAVA_CONFIG.AS_GRACE_MB,
            });
        });

        it('clamps the Java heap to 512 MB for large limits', () => {
            expect(effectiveLimits('java', 1000, 1024).memoryMb).toBe(512);
            expect(effectiveLimits('java', 1000, 1024).rssLimitMb).toBe(512 + JAVA_CONFIG.RSS_OVERHEAD_MB);
        });

        it('raises a tiny Java limit to the 16 MB floor so the JVM can start', () => {
            expect(effectiveLimits('java', 1000, 4).memoryMb).toBe(16);
        });

        it('does not clamp C++ or Python', () => {
            expect(effectiveLimits('cpp', 1000, 1024).memoryMb).toBe(1024);
            expect(effectiveLimits('cpp', 1000, 4).memoryMb).toBe(4);
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
            // The compile invocation is a shell-less argv array referencing
            // the source and output paths.
            expect(LANGUAGE_PREPARE.cpp.checkCommand('/src/s.cpp', '/out/s.out')).toEqual({
                command: 'g++',
                args: ['-std=c++20', '-fsanitize=signed-integer-overflow', '-fno-sanitize-recover=signed-integer-overflow', '/src/s.cpp', '-o', '/out/s.out'],
            });
        });

        it('syntax-checks Python via py_compile', () => {
            expect(LANGUAGE_PREPARE.python.sourceExtension).toBe('.py');
            expect(LANGUAGE_PREPARE.python.checkCommand('/src/s.py', '/out/s.out')).toEqual({
                command: 'python3',
                args: ['-m', 'py_compile', '/src/s.py'],
            });
        });

        it('runs the C++ binary directly and Python through the interpreter', () => {
            const limits = effectiveLimits('cpp', 1000, 256);
            expect(LANGUAGE_PREPARE.cpp.runCommand('/out/s.out', limits)).toEqual({
                command: '/out/s.out',
                args: [],
            });
            expect(LANGUAGE_PREPARE.python.runCommand('/src/s.py', limits)).toEqual({
                command: '/usr/bin/python3',
                args: ['/src/s.py'],
            });
        });

        it('compiles (produces an artifact) for C++ but not for Python', () => {
            expect(LANGUAGE_PREPARE.cpp.compiledArtifactPath('/out/s.out')).toBe('/out/s.out');
            expect(LANGUAGE_PREPARE.python.compiledArtifactPath('/out/s.out')).toBeNull();
        });

        describe('java', () => {
            const java = LANGUAGE_PREPARE.java;

            it('writes the source as Main.java and compiles into classes/', () => {
                expect(java.sourceName).toBe('Main.java');
                expect(java.outputName).toBe('classes');
                expect(java.compiledArtifactPath('classes')).toBe('classes');
            });

            it('compiles with javac: no annotation processing, UTF-8, output dir, bounded JVM', () => {
                const { command, args } = java.checkCommand('Main.java', 'classes');
                expect(command).toBe('javac');
                expect(args).toEqual(expect.arrayContaining(['-proc:none', '-encoding', 'UTF-8', '-d', 'classes', 'Main.java']));
                expect(args).toEqual(expect.arrayContaining(['-J-Xmx256m', '-J-XX:+UseSerialGC', '-J-XX:-UsePerfData']));
                expect(args[args.length - 1]).toBe('Main.java');
            });

            it('has its own compile caps, larger than the shared g++ ones', () => {
                expect(java.compileLimits).toBeDefined();
                expect(java.compileLimits!.asBytes).toBeGreaterThan(JUDGE_CONFIG.COMPILE_AS_LIMIT_BYTES);
                expect(java.compileLimits!.timeoutMs).toBeGreaterThanOrEqual(JUDGE_CONFIG.COMPILE_TIMEOUT_MS);
            });

            it('requires classes/Main.class after the compile, with the beginner hint', () => {
                expect(java.requiredArtifact).toEqual({ path: 'classes/Main.class', message: expect.stringContaining('Main') });
            });

            it('runs the JVM through the trusted launcher with heap flags derived from the limits', () => {
                const ws = '/tmp/oj-submissions/sub_1_ws';
                const run = java.runCommand(`${ws}/classes`, effectiveLimits('java', 1000, 256));
                expect(run.command).toBe('/usr/bin/java');
                expect(run.args).toEqual(expect.arrayContaining([
                    '-Xmx256m',
                    '-XX:+UseSerialGC',
                    '-XX:ActiveProcessorCount=1',
                    '-XX:CICompilerCount=2',
                    '-XX:-UsePerfData',
                    '-XX:+DisableAttachMechanism',
                    '-XX:+ExitOnOutOfMemoryError',
                    `-Djava.io.tmpdir=${ws}`,
                    `-XX:ErrorFile=${ws}/hs_err.log`,
                ]));
                expect(run.args.some((a) => a.startsWith('-Xss'))).toBe(false);
                expect(run.args.slice(-3)).toEqual(['-cp', `${JAVA_CONFIG.LAUNCHER_DIR}:${ws}/classes`, 'OjJavaLauncher']);
                expect(run.env).toEqual({ MALLOC_ARENA_MAX: '2' });
            });

            it('follows the clamped heap for a large limit', () => {
                const run = java.runCommand('/w/classes', effectiveLimits('java', 1000, 2048));
                expect(run.args).toContain('-Xmx512m');
            });
        });
    });
});
