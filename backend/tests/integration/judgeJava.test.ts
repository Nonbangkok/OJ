import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { JAVA_CONFIG, JAVA_MAIN_CLASS_HINT, SUBMISSION_STATUS, SubmissionLanguage } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// Java submissions through the REAL judge pipeline (javac, the launcher,
// time_wrapper rlimits + seccomp, the verdict rules): the container matrix of
// spec 2026-11-20-java-language-support-design.md, "Testing". Needs the
// backend image (linux, root, the compiled wrapper, the JDK and
// /opt/oj/java-launcher). CI runs it in the `judge-tests` profile under the
// production capability set.
//
// The measurements behind JAVA_CONFIG.AS_GRACE_MB / RSS_OVERHEAD_MB /
// COMPILE_AS_LIMIT_BYTES are recorded next to those constants; the "measure"
// test below prints the current VmPeak / VmHWM on every run.
const gateConditions: Array<[string, boolean]> = [
  ['INTEGRATION_DATABASE_URL is set', Boolean(process.env.INTEGRATION_DATABASE_URL)],
  ['platform is linux', process.platform === 'linux'],
  ['running as uid 0', process.getuid?.() === 0],
  ['scripts/time_wrapper exists in cwd', fs.existsSync('scripts/time_wrapper')],
  ['the Java launcher is installed', fs.existsSync(`${JAVA_CONFIG.LAUNCHER_DIR}/${JAVA_CONFIG.LAUNCHER_CLASS}.class`)],
];
const unmet = gateConditions.filter(([, ok]) => !ok).map(([name]) => name);
if (process.env.JUDGE_RUNTIME_REQUIRED === '1' && unmet.length > 0) {
  throw new Error(`judge runtime suite is required (JUDGE_RUNTIME_REQUIRED=1) but unmet conditions: ${unmet.join('; ')}`);
}
const enabled = unmet.length === 0;

/** Every program reads n and prints 2n when it behaved as the row expects. */
const main = (body: string, imports = '') => `${imports}
public class Main {
  public static void main(String[] args) throws Exception {
    java.util.Scanner in = new java.util.Scanner(System.in);
    long n = in.nextLong();
${body}
  }
}
`;

const PROGRAMS = {
  hello: main('    System.out.println(n * 2);'),
  bufferedReader: `import java.io.*;
public class Main {
  public static void main(String[] args) throws IOException {
    BufferedReader r = new BufferedReader(new InputStreamReader(System.in));
    long n = Long.parseLong(r.readLine().trim());
    PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));
    out.println(n * 2);
    out.flush();
  }
}
`,
  compactSource: `void main() {
  long n = new java.util.Scanner(System.in).nextLong();
  IO.println(n * 2);
}
`,
  heapOverflow: main(`    java.util.List<long[]> keep = new java.util.ArrayList<>();
    while (true) keep.add(new long[1 << 20]);`),
  /** ~70% of the heap live until the end (about what SerialGC lets a program
   *  hold): must stay Accepted, i.e. the RSS allowance covers the JVM. */
  heapNearlyFull: main(`    long max = Runtime.getRuntime().maxMemory();
    java.util.List<byte[]> keep = new java.util.ArrayList<>();
    long held = 0;
    while (held < max * 7 / 10) { byte[] b = new byte[1 << 20]; java.util.Arrays.fill(b, (byte) 1); keep.add(b); held += b.length; }
    long sum = 0; for (byte[] b : keep) sum += b[4096];
    System.out.println(sum == keep.size() ? n * 2 : -1);`),
  infiniteLoop: main('    long x = 0; while (true) { x += n; if (x == -7) break; }\n    System.out.println(x);'),
  busyThreads: main(`    for (int t = 0; t < 4; t++) {
      Thread th = new Thread(() -> { long x = 0; while (true) { x++; if (x == -7) break; } });
      th.start();
    }
    Thread.sleep(60_000);`),
  executor16: main(`    java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(16);
    java.util.List<java.util.concurrent.Future<Long>> parts = new java.util.ArrayList<>();
    for (int t = 0; t < 16; t++) parts.add(pool.submit(() -> n * 2));
    long last = 0; for (var f : parts) last = f.get();
    pool.shutdown();
    System.out.println(last);`),
  deepRecursion: `public class Main {
  static long depth(long d) { return d == 0 ? 0 : 1 + depth(d - 1); }
  public static void main(String[] args) {
    long n = new java.util.Scanner(System.in).nextLong();
    System.out.println(depth(100_000) == 100_000 ? n * 2 : -1);
  }
}
`,
  unboundedRecursion: `public class Main {
  static long f(long d) { return 1 + f(d + 1); }
  public static void main(String[] args) { System.out.println(f(0)); }
}
`,
  processBuilder: main(`    try { new ProcessBuilder("/bin/true").start().waitFor(); System.out.println(-1); }
    catch (java.io.IOException e) { System.out.println(n * 2); }`),
  /** socket() is denied (EPERM); the JDK's socket class initializer fails. */
  socket: main(`    try (java.net.Socket s = new java.net.Socket()) {
      s.connect(new java.net.InetSocketAddress("127.0.0.1", 9), 500);
      System.out.println(-1);
    } catch (java.io.IOException e) { System.out.println(-2); }`),
  manyThreads: main(`    for (int t = 0; t < 200; t++) {
      Thread th = new Thread(() -> { try { Thread.sleep(30_000); } catch (InterruptedException e) {} });
      th.setDaemon(true);
      th.start();
    }
    System.out.println(-1);`),
  writes: main(`    boolean tmpRefused;
    try { java.nio.file.Files.writeString(java.nio.file.Path.of("/tmp/oj-java-probe"), "x"); tmpRefused = false; }
    catch (java.io.IOException e) { tmpRefused = true; }
    java.io.File own = java.io.File.createTempFile("probe", ".txt");
    java.nio.file.Files.writeString(own.toPath(), "ok");
    boolean ownWritten = "ok".equals(java.nio.file.Files.readString(own.toPath()));
    System.out.println(tmpRefused && ownWritten ? n * 2 : -1);`),
  env: main(`    java.util.Set<String> keys = new java.util.TreeSet<>(System.getenv().keySet());
    System.out.println(keys.equals(new java.util.TreeSet<>(java.util.List.of("MALLOC_ARENA_MAX", "PATH", "TMPDIR"))) ? n * 2 : -1);`),
  exit3: main('    System.exit(3);'),
  publicSolution: `public class Solution {
  public static void main(String[] args) { System.out.println(6); }
}
`,
  packageDeclared: `package foo;
public class Main {
  public static void main(String[] args) { System.out.println(6); }
}
`,
  noMain: `public class Main { static int x = 1; }
`,
  syntaxError: `public class Main { int x = ; }
`,
  /** Prints the JVM's /proc/self/status memory lines on stderr, exits 1. */
  measure: (fill: boolean) => main(`    ${fill ? `long max = Runtime.getRuntime().maxMemory();
    java.util.List<byte[]> keep = new java.util.ArrayList<>();
    long held = 0;
    while (held < max * 7 / 10) { byte[] b = new byte[1 << 20]; java.util.Arrays.fill(b, (byte) 1); keep.add(b); held += b.length; }` : ''}
    for (String line : java.nio.file.Files.readAllLines(java.nio.file.Path.of("/proc/self/status"))) {
      if (line.startsWith("Vm") || line.startsWith("Threads")) System.err.println(line);
    }
    System.err.println("maxMemory=" + Runtime.getRuntime().maxMemory());
    System.exit(1);`),
} as const;

const CPP_EXIT3 = `#include <cstdlib>
int main() { std::exit(3); }
`;

interface Verdict {
  status: string;
  output: string;
  memoryKb: number;
  timeMs: number;
}

(enabled ? describe : describe.skip)('Java submissions (spec 2026-11-20)', () => {
  jest.setTimeout(180_000);
  const schema = `judge_java_${randomUUID().replaceAll('-', '')}`;
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
      `INSERT INTO users (username, password_hash, role) VALUES ('java-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    for (const [id, timeMs, memoryMb] of [['j256', 1000, 256], ['j64', 1000, 64]] as const) {
      await pool.query(
        `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ($1, $1, $2, $3, true)`,
        [id, timeMs, memoryMb],
      );
      await pool.query(
        `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, '3\n', '6\n')`,
        [id],
      );
    }
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judgeOnce(code: string, problemId = 'j256', language: SubmissionLanguage = 'java'): Promise<Verdict> {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
      [userId, problemId, code, language, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    const row = (await pool.query('SELECT overall_status, results FROM submissions WHERE id = $1', [id])).rows[0];
    const first = (row.results ?? [])[0] ?? {};
    return { status: row.overall_status, output: String(first.output ?? ''), memoryKb: first.memoryKb ?? -1, timeMs: first.timeMs ?? -1 };
  }

  const expectStatus = async (code: string, status: string, problemId = 'j256'): Promise<Verdict> => {
    const verdict = await judgeOnce(code, problemId);
    if (verdict.status !== status) {
      // Surface what the judge saw when a row fails.
      console.log(`expected ${status}, got`, verdict);
    }
    expect(verdict.status).toBe(status);
    return verdict;
  };

  it('measure: JVM address space and resident memory (logged, never fails)', async () => {
    for (const fill of [false, true]) {
      const verdict = await judgeOnce(PROGRAMS.measure(fill));
      console.log(`[java measure] heap ${fill ? '70% full' : 'idle'}: status=${verdict.status} peakRssKb=${verdict.memoryKb}\n${verdict.output}`);
    }
  });

  it('hello world with Scanner is Accepted', async () => {
    await expectStatus(PROGRAMS.hello, SUBMISSION_STATUS.ACCEPTED);
  });

  it('hello world is Accepted under a 64 MB limit', async () => {
    await expectStatus(PROGRAMS.hello, SUBMISSION_STATUS.ACCEPTED, 'j64');
  });

  it('BufferedReader + PrintWriter I/O is Accepted', async () => {
    await expectStatus(PROGRAMS.bufferedReader, SUBMISSION_STATUS.ACCEPTED);
  });

  it('a Java 25 compact source file (void main) is Accepted', async () => {
    await expectStatus(PROGRAMS.compactSource, SUBMISSION_STATUS.ACCEPTED);
  });

  it('allocating past the heap is Memory Limit Exceeded', async () => {
    await expectStatus(PROGRAMS.heapOverflow, SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
  });

  it('holding ~70% of the heap is still Accepted (the RSS allowance covers the JVM)', async () => {
    await expectStatus(PROGRAMS.heapNearlyFull, SUBMISSION_STATUS.ACCEPTED);
  });

  it('an infinite loop is Time Limit Exceeded', async () => {
    await expectStatus(PROGRAMS.infiniteLoop, SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
  });

  it('four busy threads are Time Limit Exceeded, not Memory Limit Exceeded', async () => {
    await expectStatus(PROGRAMS.busyThreads, SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
  });

  it('a 16-thread executor is Accepted', async () => {
    await expectStatus(PROGRAMS.executor16, SUBMISSION_STATUS.ACCEPTED);
  });

  it('recursion 100,000 frames deep is Accepted on the launcher\'s 32 MB main thread', async () => {
    await expectStatus(PROGRAMS.deepRecursion, SUBMISSION_STATUS.ACCEPTED);
  });

  it('unbounded recursion is a Runtime Error showing the StackOverflowError', async () => {
    const verdict = await expectStatus(PROGRAMS.unboundedRecursion, SUBMISSION_STATUS.RUNTIME_ERROR);
    expect(verdict.output).toContain('Exception in thread "main" java.lang.StackOverflowError');
    expect(verdict.output).not.toContain('oj-submissions');
  });

  it('starting a process fails (seccomp: thread-only)', async () => {
    await expectStatus(PROGRAMS.processBuilder, SUBMISSION_STATUS.ACCEPTED);
  });

  it('opening a socket fails (seccomp): a Runtime Error, never a connection', async () => {
    const verdict = await expectStatus(PROGRAMS.socket, SUBMISSION_STATUS.RUNTIME_ERROR);
    expect(verdict.output).toContain('java.net.Socket');
  });

  it('200 threads exhaust the per-uid task limit: a Runtime Error naming the native-thread OutOfMemoryError', async () => {
    // Thread.start throws this OutOfMemoryError into the program as an
    // ordinary exception; ExitOnOutOfMemoryError does not fire for it.
    const verdict = await expectStatus(PROGRAMS.manyThreads, SUBMISSION_STATUS.RUNTIME_ERROR);
    expect(verdict.output).toContain('unable to create native thread');
  });

  it('writing /tmp fails while java.io.tmpdir (the workspace) works', async () => {
    await expectStatus(PROGRAMS.writes, SUBMISSION_STATUS.ACCEPTED);
  });

  it('runs with exactly PATH, TMPDIR and MALLOC_ARENA_MAX in its environment', async () => {
    await expectStatus(PROGRAMS.env, SUBMISSION_STATUS.ACCEPTED);
  });

  it('System.exit(3) is reported as MLE (documented: it only forges a worse verdict)', async () => {
    await expectStatus(PROGRAMS.exit3, SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
  });

  it('a C++ program exiting 3 stays a Runtime Error', async () => {
    const verdict = await judgeOnce(CPP_EXIT3, 'j256', 'cpp');
    expect(verdict.status).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
  });

  it('public class Solution is a Compilation Error with the Main hint', async () => {
    const verdict = await expectStatus(PROGRAMS.publicSolution, SUBMISSION_STATUS.COMPILATION_ERROR);
    expect(verdict.output).toContain('should be declared in a file named Solution.java');
    expect(verdict.output).toContain(JAVA_MAIN_CLASS_HINT);
    expect(verdict.output).not.toContain('oj-submissions');
  });

  it('a package declaration is a Compilation Error with the Main hint', async () => {
    const verdict = await expectStatus(PROGRAMS.packageDeclared, SUBMISSION_STATUS.COMPILATION_ERROR);
    expect(verdict.output).toBe(JAVA_MAIN_CLASS_HINT);
  });

  it('a syntax error is a Compilation Error naming Main.java', async () => {
    const verdict = await expectStatus(PROGRAMS.syntaxError, SUBMISSION_STATUS.COMPILATION_ERROR);
    expect(verdict.output).toContain('Main.java:1: error');
    expect(verdict.output).not.toContain('oj-submissions');
    expect(verdict.output).not.toContain(JAVA_MAIN_CLASS_HINT);
  });

  it('a class Main without a main method is a Runtime Error that says so', async () => {
    const verdict = await expectStatus(PROGRAMS.noMain, SUBMISSION_STATUS.RUNTIME_ERROR);
    expect(verdict.output).toContain('Main method not found');
  });
});
