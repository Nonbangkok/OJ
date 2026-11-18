import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import pg from 'pg';
import { ZipArchive } from 'archiver';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processSubmission } from '../../services/submissionService';
import { processBatchUpload } from '../../services/batchUploadService';
import { diskUpload } from '../../middleware/upload';
import { buildDatabaseExportCommand, buildDatabaseExportFilePath } from '../../services/adminSystemService';
import { runCommand } from '../../utils/runCommand';
import { initBackendWorkRoot, removePrivateTemp } from '../../utils/privateTemp';
import { ChunkedBatchUploadService } from '../../services/chunkedBatchUploadService';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

// A1-01 / A2-01 / A4-03 / A9-02 end to end: drives the REAL judge (sandbox
// uid, time_wrapper, seccomp) with an attacker submission while the backend
// holds sensitive temp files, and checks that a directory a sandbox uid
// created is never accepted as a backend temp root. Needs the backend image:
// linux, root, the compiled wrapper in cwd. Same gate as judgeRuntime.test.ts.
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

const MARKER = `TMPLEAK_${randomUUID().replaceAll('-', '')}`;
const reversed = (s: string): string => [...s].reverse().join('');
const SANDBOX_UID = 60007;

/**
 * The attacker: walks /tmp like any submission can (opendir/readdir/open) and
 * looks for MARKER. The marker is stored reversed so neither the source nor
 * the binary contains it. A hit is printed to stderr followed by abort(): the
 * Runtime Error output is shown to the submitter, i.e. the leak channel.
 */
const PROBE_READ = `#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>
static std::string marker, leak;
static void scan(const std::string& dir, int depth) {
  if (depth > 6 || !leak.empty()) return;
  DIR* d = opendir(dir.c_str());
  if (!d) return;
  while (dirent* e = readdir(d)) {
    std::string name = e->d_name;
    if (name == "." || name == ".." || name.rfind("jest_", 0) == 0 || name == "node-compile-cache") continue;
    std::string p = dir + "/" + name;
    struct stat st;
    if (lstat(p.c_str(), &st) != 0) continue;
    if (S_ISDIR(st.st_mode)) { scan(p, depth + 1); continue; }
    if (!S_ISREG(st.st_mode)) continue;
    int fd = open(p.c_str(), O_RDONLY);
    if (fd < 0) continue;
    std::string data; char buf[65536]; ssize_t r;
    while (data.size() < (8u << 20) && (r = read(fd, buf, sizeof buf)) > 0) data.append(buf, r);
    close(fd);
    if (data.find(marker) != std::string::npos) { leak = p; break; }
  }
  closedir(d);
}
int main() {
  marker = "${reversed(MARKER)}";
  std::reverse(marker.begin(), marker.end());
  scan("/tmp", 0);
  if (leak.empty()) { std::printf("clean\\n"); return 0; }
  std::fprintf(stderr, "LEAK %s\\n", leak.c_str());
  std::abort();
}
`;

(enabled ? describe : describe.skip)('judged programs cannot reach backend temp files', () => {
  jest.setTimeout(120_000); // compiles and judges real submissions; slow on a loaded host
  const schema = `tmppriv_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  let userId: number;
  let privateDir: string;
  /** One-shot hook: the next withTransaction call runs this instead of a transaction, then fails. */
  let holdNextTransaction: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-privacy-'));
    fs.chmodSync(privateDir, 0o700);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (db.withTransaction as jest.Mock).mockImplementation(async (body: (client: pg.PoolClient) => Promise<unknown>) => {
      const hold = holdNextTransaction;
      if (hold) {
        holdNextTransaction = null;
        await hold();
        throw new Error('hold');
      }
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
      `INSERT INTO users (username, password_hash, role) VALUES ('tmp-attacker', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    for (const [id, expected] of [['tmpread', 'clean']]) {
      await pool.query(
        'INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ($1, $1, 4000, 256, true)',
        [id],
      );
      await pool.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, $2, $3)',
        [id, '0\n', `${expected}\n`],
      );
    }
    // A secret that a full database export carries (problem_files / testcases rows).
    await pool.query(
      `INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
       VALUES ('tmpsecret', 'tmpsecret', 1000, 256, false, 'header', 'student.h')`,
    );
    await pool.query(
      `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('tmpsecret', 'grader', 'main.cpp', $1)`,
      [Buffer.from(`// ${MARKER}\n`)],
    );
    // problem_files is bytea (hex in a plain dump); the hidden expected
    // output is text, so the marker appears verbatim in the dump.
    await pool.query(
      `INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('tmpsecret', 1, '1\n', $1)`,
      [`${MARKER}-expected\n`],
    );
  });

  afterAll(async () => {
    fs.rmSync(privateDir, { recursive: true, force: true });
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function judge(problemId: string, code: string) {
    const inserted = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
       VALUES ($1, $2, $3, 'cpp', $4, 0) RETURNING id`,
      [userId, problemId, code, SUBMISSION_STATUS.PENDING],
    );
    const id = inserted.rows[0].id as number;
    await processSubmission(id);
    return (await pool.query('SELECT overall_status, results FROM submissions WHERE id = $1', [id])).rows[0] as {
      overall_status: string;
      results: Array<{ status: string; output?: string }>;
    };
  }

  const expectNoLeak = (row: { overall_status: string; results: Array<{ status: string; output?: string }> }): void => {
    expect({ status: row.overall_status, output: row.results[0]?.output }).toEqual({
      status: SUBMISSION_STATUS.ACCEPTED,
      output: undefined,
    });
  };

  async function makeZip(entries: Record<string, string>): Promise<string> {
    const zipPath = path.join(privateDir, `batch-${randomUUID()}.zip`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath, { mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
      void archive.finalize().catch(reject);
    });
    return zipPath;
  }

  async function uploadWhile(onFile: (file: Express.Multer.File) => Promise<void>): Promise<number> {
    const app = express();
    app.post('/upload', diskUpload.single('databaseDump'), async (req: Request, res: Response) => {
      try {
        await onFile(req.file!);
      } finally {
        fs.rmSync(req.file!.path, { force: true });
      }
      res.json({ ok: true });
    });
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(500).end(); });
    const response = await request(app)
      .post('/upload')
      .attach('databaseDump', Buffer.from(`-- PostgreSQL dump\nCOPY public.problem_files ${MARKER}\n`), 'dump.sql');
    return response.status;
  }

  it('A1-01/A4-03: a submission judged during a batch import cannot read the extracted grader/ and testcases', async () => {
    const zipPath = await makeZip({
      'p-secret/config.json': JSON.stringify({
        id: 'p-secret', title: 'Probe title', author: 'Probe author', time_limit_ms: 1000, memory_limit_mb: 256,
        problem_type: 'header', submission_filename: 'student.h',
      }),
      'p-secret/grader/main.cpp': `// ${MARKER} secret grader\nint main() {}\n`,
      'p-secret/testcases/1.in': '1\n',
      'p-secret/testcases/1.out': `${MARKER}-expected\n`,
    });
    const seen: { row?: Awaited<ReturnType<typeof judge>> } = {};
    holdNextTransaction = async () => { seen.row = await judge('tmpread', PROBE_READ); };

    const result = await processBatchUpload(zipPath);

    expect(result.errors).toEqual([{ directory: 'p-secret', message: 'hold' }]);
    expect(seen.row).toBeDefined();
    expectNoLeak(seen.row!);
  });

  it('A1-01/A2-01/A4-03: a submission judged during a disk upload cannot read the staged upload', async () => {
    const seen: { row?: Awaited<ReturnType<typeof judge>> } = {};
    const status = await uploadWhile(async () => { seen.row = await judge('tmpread', PROBE_READ); });

    expect(status).toBe(200);
    expect(seen.row).toBeDefined();
    expectNoLeak(seen.row!);
  });

  it('A2-01/A4-03: a submission judged during a database export cannot read the dump', async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL!);
    const dumpPath = buildDatabaseExportFilePath(Date.now());
    const command = buildDatabaseExportCommand(
      dumpPath,
      url.pathname.slice(1),
      decodeURIComponent(url.username),
      url.hostname,
      url.port || '5432',
      decodeURIComponent(url.password),
    );
    try {
      await runCommand(command);
      expect(fs.readFileSync(dumpPath).includes(MARKER)).toBe(true);
      expectNoLeak(await judge('tmpread', PROBE_READ));
    } finally {
      await removePrivateTemp(path.dirname(dumpPath));
    }
  });

  it('A9-02: a directory a sandbox uid created first is refused as OJ_WORK_DIR and as a chunk upload root', async () => {
    // A world-writable parent we own, so the sandbox uid can create inside it
    // and root can still remove what it made.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-claim-'));
    fs.chmodSync(parent, 0o777);
    const claimed = path.join(parent, 'claimed');
    try {
      const made = spawnSync('./scripts/time_wrapper', ['/bin/mkdir', '64', '2', String(SANDBOX_UID), '-m', '777', claimed]);
      expect(made.status).toBe(0);
      expect(fs.lstatSync(claimed).uid).toBe(SANDBOX_UID);

      expect(() => initBackendWorkRoot({ configuredDir: claimed })).toThrow(`owned by uid ${SANDBOX_UID}`);

      // Root lacks CAP_FOWNER here, so chmod would fail with EPERM; the old
      // code swallowed that and wrote sessions into the attacker's directory.
      const service = new ChunkedBatchUploadService({ sessionRoot: claimed, assembledRoot: privateDir });
      await expect(service.createSession({ userId, fileName: 'problems.zip', fileSize: 3, totalChunks: 1 }))
        .rejects.toThrow(`owned by uid ${SANDBOX_UID}`);
      expect(fs.readdirSync(claimed)).toEqual([]);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
