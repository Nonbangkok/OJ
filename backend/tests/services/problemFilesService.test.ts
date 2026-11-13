import * as db from '../../db';
import {
  listProblemFiles,
  getProblemFiles,
  getProblemFile,
  replaceProblemFiles,
  getHeaderJudgeSpec,
  hasGraderSource,
  appendStarterZip,
  sendStarterZip,
  starterZipFilename,
} from '../../services/problemFilesService';
import { AppError } from '../../middleware/errorHandler';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const query = db.query as jest.Mock;

const makeClient = (submissionFilename: string | null = 'student.h') => {
  const q = jest.fn(async (sql: string) => {
    if (/FROM problems/i.test(sql)) return { rows: [{ submission_filename: submissionFilename }] };
    return { rows: [], rowCount: 0 };
  });
  return { query: q } as unknown as import('pg').PoolClient & { query: jest.Mock };
};

describe('problemFilesService', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('listProblemFiles reads sizes without content', async () => {
    query.mockResolvedValueOnce({ rows: [{ role: 'grader', filename: 'a.cpp', bytes: 5 }] });
    const rows = await listProblemFiles('p1');
    expect(rows).toEqual([{ role: 'grader', filename: 'a.cpp', bytes: 5 }]);
    expect(query.mock.calls[0][0]).toContain('OCTET_LENGTH');
    expect(query.mock.calls[0][0]).not.toMatch(/\bcontent\s*,|,\s*content\b/i);
  });

  it('getProblemFiles uses db.query without a client, and the client when given', async () => {
    query.mockResolvedValueOnce({ rows: [{ filename: 'a.h', content: Buffer.from('x') }] });
    const files = await getProblemFiles('p1', 'starter');
    expect(files).toEqual([{ filename: 'a.h', content: Buffer.from('x') }]);
    expect(query.mock.calls[0][0]).toContain('ORDER BY filename');
    expect(query.mock.calls[0][1]).toEqual(['p1', 'starter']);

    const client = makeClient();
    await getProblemFiles('p1', 'grader', client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('getProblemFile returns a buffer or null', async () => {
    query.mockResolvedValueOnce({ rows: [{ content: Buffer.from('hi') }] });
    expect(await getProblemFile('p1', 'starter', 'a.h')).toEqual(Buffer.from('hi'));
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getProblemFile('p1', 'starter', 'zz.h')).toBeNull();
  });

  describe('replaceProblemFiles', () => {
    it('DELETEs the role set then INSERTs one row per file on the given client', async () => {
      const client = makeClient();
      await replaceProblemFiles(client, 'p1', 'grader', [
        { filename: 'main.cpp', content: Buffer.from('int main(){}') },
        { filename: 'util.h', content: Buffer.from('') },
      ]);
      const sqls = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
      const del = sqls.findIndex((s) => /DELETE FROM problem_files/i.test(s));
      const inserts = sqls.filter((s) => /INSERT INTO problem_files/i.test(s));
      expect(del).toBeGreaterThanOrEqual(0);
      expect(inserts).toHaveLength(2);
      expect(sqls.findIndex((s) => /INSERT INTO problem_files/i.test(s))).toBeGreaterThan(del);
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects an invalid set with AppError 400 and no write', async () => {
      const client = makeClient();
      const bad = [{ filename: 'only.h', content: Buffer.from('') }];
      await expect(replaceProblemFiles(client, 'p1', 'grader', bad)).rejects.toMatchObject({ statusCode: 400 });
      await expect(replaceProblemFiles(client, 'p1', 'grader', bad)).rejects.toBeInstanceOf(AppError);
      const sqls = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(sqls.some((s) => /INSERT|DELETE/i.test(s))).toBe(false);
    });

    it('rejects a grader file colliding with the problem submission filename', async () => {
      const client = makeClient('student.h');
      await expect(
        replaceProblemFiles(client, 'p1', 'grader', [
          { filename: 'main.cpp', content: Buffer.from('') },
          { filename: 'student.h', content: Buffer.from('') },
        ]),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getHeaderJudgeSpec', () => {
    it('returns null when the problem is missing', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      expect(await getHeaderJudgeSpec('nope')).toBeNull();
    });

    it('returns empty graderFiles for a standard problem without reading files', async () => {
      query.mockResolvedValueOnce({ rows: [{ problem_type: 'standard', submission_filename: null }] });
      expect(await getHeaderJudgeSpec('p1')).toEqual({
        problemType: 'standard', submissionFilename: null, graderFiles: [],
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('loads grader files for a header problem', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ problem_type: 'header', submission_filename: 'student.h' }] })
        .mockResolvedValueOnce({ rows: [{ filename: 'main.cpp', content: Buffer.from('x') }] });
      const spec = await getHeaderJudgeSpec('p1');
      expect(spec?.problemType).toBe('header');
      expect(spec?.submissionFilename).toBe('student.h');
      expect(spec?.graderFiles).toEqual([{ filename: 'main.cpp', content: Buffer.from('x') }]);
    });
  });

  it('hasGraderSource matches .cpp grader files case-insensitively', async () => {
    query.mockResolvedValueOnce({ rows: [{ exists: true }] });
    expect(await hasGraderSource('p1')).toBe(true);
    // validateProblemFileSet and headerPreparePlan both lower-case the
    // extension, so a grader uploaded as `main.CPP` is accepted and compiled.
    // A case-sensitive LIKE here would make such a problem permanently
    // unsubmittable ("not ready for submissions yet").
    expect(query.mock.calls[0][0]).toContain("LOWER(filename) LIKE '%.cpp'");
    query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    expect(await hasGraderSource('p1')).toBe(false);
  });

  describe('starter ZIP attachment name', () => {
    // Problem ids are an unrestricted VARCHAR(50): a quote inside one would
    // otherwise close the Content-Disposition filename and let the id dictate
    // an arbitrary saved filename (or inject header syntax).
    it.each([
      ['plain-01', 'plain-01-starter.zip'],
      ['ev"il', 'ev_il-starter.zip'],
      ['a"; filename="pwn.exe', 'a_filename_pwn.exe-starter.zip'],
      ['../../etc/passwd', 'etc_passwd-starter.zip'],
      ['bad\r\nX-Evil: 1', 'bad_X-Evil_1-starter.zip'],
      ['\u0e42\u0e08\u0e17\u0e22\u0e4c', 'problem-starter.zip'],
    ])('sanitizes %p', (problemId, expected) => {
      expect(starterZipFilename(problemId)).toBe(expected);
    });

    it('sendStarterZip sets the sanitized name on the response header', async () => {
      const headers: Record<string, string> = {};
      const res = {
        setHeader: (name: string, value: string) => { headers[name] = value; },
        on: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        destroy: jest.fn(),
        writableEnded: false,
      };
      await sendStarterZip(res as never, 'ev"il', [{ filename: 'a.h', content: Buffer.from('1') }]);
      expect(headers['Content-Disposition']).toBe('attachment; filename="ev_il-starter.zip"');
      expect(headers['Content-Disposition']).not.toContain('ev"il');
    });
  });

  it('appendStarterZip appends each file by name', () => {
    const archive = { append: jest.fn() };
    appendStarterZip(archive as never, [
      { filename: 'a.h', content: Buffer.from('1') },
      { filename: 'b.cpp', content: Buffer.from('2') },
    ]);
    expect(archive.append).toHaveBeenCalledTimes(2);
    expect(archive.append).toHaveBeenCalledWith(Buffer.from('1'), { name: 'a.h' });
  });
});
