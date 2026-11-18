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

// A9-05 and the /tmp pre-claim class of A9-02: a judged program may only
// write inside its own workspace. It must not be able to create a path the
// backend later trusts (e.g. claim /tmp/oj_uploads before the backend does),
// and nothing it writes outside the workspace may outlive its submission (a
// disk-fill and drop-box channel otherwise).
//
// Drives the REAL judge pipeline (compile, sandbox, time_wrapper, seccomp),
// so it needs the backend image: linux, root, the compiled wrapper in cwd.
// Same gate as judgeRuntime.test.ts. Run it with the production capability
// set (cap_drop ALL + SETUID/SETGID): root then cannot remove files a sandbox
// uid owns, which is exactly what the cleanup has to cope with.
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

const TOKEN = `scratch_${randomUUID().replaceAll('-', '')}`;
/** Shared directories a sandbox uid could reach on a stock image. */
const SHARED_DIRS = ['/tmp', '/var/tmp', '/run/lock', '/dev/shm', '/tmp/oj-submissions'];
/** The backend's lazily created upload staging dir (A9-02 pre-claim target). */
const UPLOADS_DIR = '/tmp/oj_uploads';
const MQUEUE_NAME = `/${TOKEN}_mq`;

/** Every path the probe below tries to create. */
const PROBE_TARGETS = [
  ...SHARED_DIRS.flatMap((dir) => [path.join(dir, `${TOKEN}_d`), path.join(dir, `${TOKEN}_f`)]),
  UPLOADS_DIR,
  path.join('/dev/mqueue', MQUEUE_NAME.slice(1)),
];

/**
 * Tries every way a program can leave something behind outside its
 * workspace: a world-writable directory (a pre-claim), a 1 MiB file (a disk
 * fill) in each shared directory, the upload staging dir, and a POSIX message
 * queue. It ignores failures and always prints "done", so the verdict stays
 * Accepted either way and the test can inspect what survived.
 */
const PROBE = `#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <mqueue.h>
#include <sys/stat.h>
int main() {
  static char buf[1 << 20];
  std::memset(buf, 'x', sizeof buf);
  const char* dirs[] = { ${SHARED_DIRS.map((dir) => JSON.stringify(dir)).join(', ')} };
  char p[512];
  for (const char* dir : dirs) {
    std::snprintf(p, sizeof p, "%s/${TOKEN}_d", dir);
    if (mkdir(p, 0777) == 0) chmod(p, 0777);
    std::snprintf(p, sizeof p, "%s/${TOKEN}_f", dir);
    if (FILE* f = std::fopen(p, "w")) { std::fwrite(buf, 1, sizeof buf, f); std::fclose(f); }
  }
  if (mkdir("${UPLOADS_DIR}", 0777) == 0) chmod("${UPLOADS_DIR}", 0777);
  mq_open("${MQUEUE_NAME}", O_CREAT | O_RDWR, 0666, nullptr);
  std::printf("done\\n");
}
`;

/** TMPDIR is set, writable, and is the directory the program runs from (its workspace). */
const CPP_TMPDIR_PROBE = `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <climits>
#include <libgen.h>
#include <unistd.h>
int main() {
  const char* tmp = std::getenv("TMPDIR");
  if (!tmp) { std::puts("unset"); return 0; }
  char tmpl[PATH_MAX];
  std::snprintf(tmpl, sizeof tmpl, "%s/probeXXXXXX", tmp);
  int fd = mkstemp(tmpl);
  if (fd < 0) { std::puts("unwritable"); return 0; }
  close(fd);
  unlink(tmpl);
  char self[PATH_MAX], real[PATH_MAX];
  ssize_t len = readlink("/proc/self/exe", self, sizeof self - 1);
  if (len <= 0 || !realpath(tmp, real)) { std::puts("unknown"); return 0; }
  self[len] = 0;
  std::puts(std::strcmp(dirname(self), real) == 0 ? "ok" : "elsewhere");
}
`;

const PY_TMPDIR_PROBE = `import os, sys, tempfile
d = os.environ.get("TMPDIR")
with tempfile.NamedTemporaryFile() as f:
    here = os.path.dirname(os.path.realpath(sys.argv[0]))
    print("ok" if d and os.path.dirname(f.name) == d and os.path.realpath(d) == here else "bad")
`;

/** Test hygiene: remove whatever a probe left behind, as its owner (root has no CAP_FOWNER here). */
function removeLeftovers(): void {
  for (const target of PROBE_TARGETS) {
    let owner: number;
    try {
      owner = fs.lstatSync(target).uid;
    } catch {
      continue;
    }
    if (POOL_UIDS.includes(owner)) {
      spawnSync('/usr/bin/rm', ['-rf', '--', target], { uid: owner, gid: owner, stdio: 'ignore', timeout: 5000 });
    }
  }
}

(enabled ? describe : describe.skip)('judged programs can only write inside their own workspace', () => {
  jest.setTimeout(60_000);
  const schema = `scratch_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  const uploadsDirExistedBefore = fs.existsSync(UPLOADS_DIR);
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
      `INSERT INTO users (username, password_hash, role) VALUES ('scratch-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    for (const [id, expected] of [['scratch-write', 'done'], ['scratch-tmpdir', 'ok']]) {
      await pool.query(
        'INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ($1, $1, 4000, 256, true)',
        [id],
      );
      await pool.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, $2, $3)',
        [id, '0\n', `${expected}\n`],
      );
    }
  });

  afterEach(() => removeLeftovers());

  afterAll(async () => {
    removeLeftovers();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judge(problemId: string, language: 'cpp' | 'python', code: string) {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
      [userId, problemId, code, language, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status, results FROM submissions WHERE id = $1', [id])).rows[0] as {
      overall_status: string;
      results: unknown;
    };
  }

  it('the image gives sandbox uids no world-writable /tmp, /var/tmp or /run/lock', () => {
    const modes = Object.fromEntries(['/tmp', '/var/tmp', '/run/lock'].map((dir) => [dir, fs.statSync(dir).mode & 0o7777]));
    expect(modes).toEqual({ '/tmp': 0o1755, '/var/tmp': 0o1755, '/run/lock': 0o1755 });
    const root = fs.lstatSync('/tmp/oj-submissions');
    expect({ dir: root.isDirectory(), uid: root.uid, mode: root.mode & 0o7777 }).toEqual({ dir: true, uid: 0, mode: 0o1733 });
  });

  it('nothing a submission writes outside its workspace survives it, and it cannot claim the upload staging dir', async () => {
    const row = await judge('scratch-write', 'cpp', PROBE);
    expect({ status: row.overall_status, results: row.overall_status === SUBMISSION_STATUS.ACCEPTED ? undefined : row.results })
      .toEqual({ status: SUBMISSION_STATUS.ACCEPTED, results: undefined });

    const survivors = PROBE_TARGETS.flatMap((target) => {
      try {
        const stat = fs.lstatSync(target);
        // A root-owned /tmp/oj_uploads that existed before the run is the backend's own.
        if (target === UPLOADS_DIR && uploadsDirExistedBefore && stat.uid === 0) return [];
        return [`${target} (uid ${stat.uid})`];
      } catch {
        return [];
      }
    });
    expect(survivors).toEqual([]);
  });

  it.each([
    ['cpp', CPP_TMPDIR_PROBE],
    ['python', PY_TMPDIR_PROBE],
  ] as const)('a %s program gets its own workspace as TMPDIR', async (language, code) => {
    const row = await judge('scratch-tmpdir', language, code);
    expect({ status: row.overall_status, results: row.overall_status === SUBMISSION_STATUS.ACCEPTED ? undefined : row.results })
      .toEqual({ status: SUBMISSION_STATUS.ACCEPTED, results: undefined });
  });
});
