import { randomUUID } from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { ZipArchive } from 'archiver';
import * as db from '../../db';
import { processBatchUpload } from '../../services/batchUploadService';
import { diskUpload } from '../../middleware/upload';
import adminRouter from '../../controllers/adminController';
import { errorHandler } from '../../middleware/errorHandler';
import type { SpawnCommand } from '../../utils/runCommand';
import { backendWorkRoot } from '../../utils/privateTemp';

// A1-01 / A2-01 / A4-03 / A9-02 / A2-05: the backend's most sensitive
// transient files (extracted batch ZIPs with grader/ and hidden testcases,
// multer uploads incl. DB dumps, pg_dump exports) used to sit under the
// shared /tmp at default 0755/0644 modes. Judged programs run as an
// unprivileged pool uid in the same container with no filesystem
// confinement, so they could list /tmp and read them. While the backend holds
// such a file, no copy of its content may be reachable for an "other" uid
// that discovers files by listing directories; the private work root
// (utils/privateTemp) is 0700, so the walk below cannot enter it.

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { query: jest.fn(), connect: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../../scripts/migrate', () => ({ runMigrationsFromPool: jest.fn().mockResolvedValue([]) }));
jest.mock('../../middleware/auth', () => {
  const asAdmin = (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, username: 'admin', role: 'admin', hasAvatar: false };
    next();
  };
  return { requireAuth: asAdmin, requireAdmin: asAdmin, requireStaffOrAdmin: asAdmin };
});
const mockRunCommand = jest.fn();
jest.mock('../../utils/runCommand', () => ({
  runCommand: (command: unknown) => mockRunCommand(command),
}));

/**
 * Every file an unprivileged uid that is neither owner nor group could
 * discover by readdir() and then open: the root(s) are treated as world
 * listable (production /tmp is 1777), every directory below must be o+rx to
 * be listed and the file o+r to be read. Returns those whose content
 * includes `marker`.
 */
// Big caches that never hold backend staging files (jest's own cache lives in
// os.tmpdir()); skipping them keeps the walk fast without hiding a leak.
const SKIP_DIRS = /^(jest_|node-compile-cache$|node_modules$|playwright-)/;

function worldReachableFilesContaining(marker: string): string[] {
  const roots = [...new Set([os.tmpdir(), '/tmp'].map((p) => fs.realpathSync(p)))];
  const hits: string[] = [];
  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.test(entry.name)) continue;
      const entryPath = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth < 6 && (stat.mode & 0o005) === 0o005) visit(entryPath, depth + 1);
      } else if (stat.isFile() && (stat.mode & 0o004) !== 0 && stat.size <= 8 * 1024 * 1024) {
        try {
          if (fs.readFileSync(entryPath).includes(marker)) hits.push(entryPath);
        } catch {
          // vanished between lstat and read
        }
      }
    }
  };
  for (const root of roots) visit(root, 0);
  return hits;
}

// The walk reads every world-reachable file under the temp roots; on a busy
// shared host that can take longer than the default 30 s.
jest.setTimeout(120_000);

let privateDir: string;

/** Poll `check` for up to a second: cleanup runs just after the response ends. */
async function eventually(check: () => boolean): Promise<boolean> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  return check();
}

beforeAll(() => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-privacy-'));
  fs.chmodSync(privateDir, 0o700);
});

afterAll(() => {
  fs.rmSync(privateDir, { recursive: true, force: true });
});

async function makeZip(entries: Record<string, string | Buffer>): Promise<string> {
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

describe('backend temp files are not readable by other uids', () => {
  it('batch import does not expose extracted grader/ and hidden testcase files while it runs', async () => {
    const marker = `SECRET_${randomUUID()}`;
    const zipPath = await makeZip({
      'p-g1/config.json': JSON.stringify({
        id: 'p-g1', title: 'Probe title', author: 'Probe author', time_limit_ms: 1000, memory_limit_mb: 256,
        problem_type: 'header', submission_filename: 'student.h',
      }),
      'p-g1/grader/main.cpp': `// ${marker} secret grader\nint main() {}\n`,
      'p-g1/testcases/1.in': '1\n',
      'p-g1/testcases/1.out': `${marker}-expected\n`,
    });

    // The per-problem transaction is the hold point: by then the archive has
    // been fully read, exactly when a polling submission would look.
    let seen: string[] | null = null;
    (db.withTransaction as jest.Mock).mockImplementation(async () => {
      seen = worldReachableFilesContaining(marker);
      throw new Error('hold: stop after scan');
    });

    const result = await processBatchUpload(zipPath);

    expect(result.errors).toEqual([{ directory: 'p-g1', message: 'hold: stop after scan' }]);
    expect(seen).toEqual([]);
  });

  it('disk-backed uploads (batch ZIPs, chunk parts, DB dumps) are staged where other uids cannot read them', async () => {
    const marker = `SECRET_${randomUUID()}`;
    let seen: string[] | null = null;
    const app = express();
    app.post('/upload', diskUpload.single('databaseDump'), (req: Request, res: Response) => {
      seen = worldReachableFilesContaining(marker);
      fs.rmSync(req.file!.path, { force: true });
      res.json({ ok: true });
    });

    await request(app)
      .post('/upload')
      .attach('databaseDump', Buffer.from(`-- PostgreSQL dump\nCOPY public.problem_files ${marker}\n`), 'dump.sql')
      .expect(200);

    expect(seen).toEqual([]);
  });

  it('A9-02: uploads are staged in a private work-root directory, not a predictable /tmp path another uid can pre-create', async () => {
    let staging: { dir: string; uid: number; mode: number } | null = null;
    const app = express();
    app.post('/upload', diskUpload.single('problemsZip'), (req: Request, res: Response) => {
      const dir = path.dirname(req.file!.path);
      const stat = fs.lstatSync(dir);
      staging = { dir, uid: stat.uid, mode: stat.mode & 0o777 };
      fs.rmSync(req.file!.path, { force: true });
      res.json({ ok: true });
    });

    await request(app).post('/upload').attach('problemsZip', Buffer.from('PK'), 'problems.zip').expect(200);

    expect(staging).not.toBeNull();
    const { dir, uid, mode } = staging!;
    expect(path.dirname(dir)).toBe(backendWorkRoot());
    expect(path.basename(dir)).toMatch(/^uploads-[A-Za-z0-9]{6}$/);
    expect({ uid, mode }).toEqual({ uid: process.getuid!(), mode: 0o700 });
  });

  it('database export does not write the dump where other uids can read it', async () => {
    const marker = `SECRET_${randomUUID()}`;
    let seen: string[] | null = null;
    let target: string | undefined;
    mockRunCommand.mockImplementation(async (command: SpawnCommand) => {
      // Emulate pg_dump -F p -f <target>: fopen("w") => mode 0666 & ~umask.
      target = command.args[command.args.indexOf('-f') + 1];
      fs.writeFileSync(target, `-- PostgreSQL database dump\nCOPY public.problem_files ${marker}\n`);
      seen = worldReachableFilesContaining(marker);
    });
    const app = express();
    app.use(express.json());
    app.use(adminRouter);
    app.use(errorHandler);

    const response = await request(app).post('/admin/database/export').expect(200);

    expect(response.text).toContain(marker);
    expect(target).toBeDefined();
    expect(seen).toEqual([]);
    // The dump and its private directory are removed once the download ends.
    await expect(eventually(() => !fs.existsSync(path.dirname(target!)))).resolves.toBe(true);
  });

  it('A2-05: a failed pg_dump leaves neither the partial dump nor its directory behind', async () => {
    let target: string | undefined;
    mockRunCommand.mockImplementation(async (command: SpawnCommand) => {
      target = command.args[command.args.indexOf('-f') + 1];
      fs.writeFileSync(target, '-- PostgreSQL database dump\nCOPY public.users (partial');
      throw new Error('pg_dump exited with code 1');
    });
    const app = express();
    app.use(express.json());
    app.use(adminRouter);
    app.use(errorHandler);

    await request(app).post('/admin/database/export').expect(500);

    expect(target).toBeDefined();
    expect(fs.existsSync(target!)).toBe(false);
    expect(fs.existsSync(path.dirname(target!))).toBe(false);
  });

  it('a nested input/output testcase ZIP is extracted where other uids cannot read it', async () => {
    const marker = `SECRET_${randomUUID()}`;
    const innerZip = await makeZip({
      'cases/input/1.in': `${marker}-input\n`,
      'cases/output/1.out': `${marker}-expected\n`,
    });
    const zipPath = await makeZip({
      'p-inner/config.json': JSON.stringify({
        id: 'p-inner', title: 'Inner', author: 'Probe author', time_limit_ms: 1000, memory_limit_mb: 256,
      }),
      'p-inner/tests.zip': fs.readFileSync(innerZip),
    });

    // Scan while the extracted testcases are being stored, i.e. while both
    // the batch tree and the inner extraction exist on disk.
    let seen: string[] | null = null;
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO testcases')) seen ??= worldReachableFilesContaining(marker);
        return { rows: [], rowCount: 1 };
      }),
    };
    (db.withTransaction as jest.Mock).mockImplementation(async (body: (c: typeof client) => Promise<unknown>) => body(client));

    const result = await processBatchUpload(zipPath);

    expect(result).toMatchObject({ added: ['p-inner'], errors: [] });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO testcases'), expect.anything());
    expect(seen).toEqual([]);
  });
});
