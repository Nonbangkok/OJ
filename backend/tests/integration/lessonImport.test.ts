import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getAdminLessonOverview, importLessonBundle, previewLessonImport, setLessonTrackVisibility } from '../../services/lessonImportService';
import {
  findVisibleLessonId,
  getLearnLesson,
  getLearnTrack,
  getLearnTracks,
  getLessonAsset,
  setLessonCompleted,
} from '../../services/lessonQueryService';
import { buildLessonBundle, lessonBundleEntries, PNG_1PX, sampleTracks, zipOf } from '../fixtures/lessonBundle';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('lessons import and Learn reads (Postgres)', () => {
  const schema = `lesson_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const guest = { userId: null, isStaff: false };
  let learner: { userId: number; isStaff: false };
  let staff: { userId: number; isStaff: true };

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE lesson_imports, lesson_tracks, problems, users, contests RESTART IDENTITY CASCADE`);
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
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
    const users = await pool.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, role) VALUES ('nattapat', 'x', 'user'), ('pim', 'x', 'staff') RETURNING id`,
    );
    learner = { userId: users.rows[0].id, isStaff: false };
    staff = { userId: users.rows[1].id, isStaff: true };
    await pool.query(
      `INSERT INTO problems (id, title, is_visible, difficulty) VALUES
         ('P0001', 'Count Steps', true, 800), ('P0002', 'Range Sum', true, 900), ('P0003', 'Subarray Sum K', true, 1300)`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const importSample = async (tracks = sampleTracks(), confirmRemovals = false) =>
    importLessonBundle(await buildLessonBundle(tracks), { userId: staff.userId, confirmRemovals });

  it('previews a first import without writing anything', async () => {
    const plan = await previewLessonImport(await buildLessonBundle(sampleTracks()));
    expect(plan.issues).toEqual([]);
    expect(plan.lessons.added.map((l) => l.slug)).toEqual(['time-complexity', 'prefix-sums', 'bfs']);
    expect(plan.tracks.added).toEqual(['foundations', 'graphs']);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM lessons')).rows[0].n).toBe(0);
  });

  it('imports tracks, modules, lessons, problems and assets, and records the import', async () => {
    const result = await importSample();
    expect(result.kind).toBe('imported');

    const overview = await getAdminLessonOverview();
    expect(overview.tracks.map((t) => [t.slug, t.module_count, t.lesson_count])).toEqual([['foundations', 1, 2], ['graphs', 1, 1]]);
    expect(overview.imports[0]).toMatchObject({ imported_by: 'pim', source_commit: 'a1b2c3d', added: 3, changed: 0, removed: 0 });

    const problems = await pool.query('SELECT problem_id, position, role FROM lesson_problems ORDER BY problem_id');
    expect(problems.rows).toEqual([
      { problem_id: 'P0001', position: 1, role: 'example' },
      { problem_id: 'P0002', position: 1, role: 'example' },
      { problem_id: 'P0003', position: 2, role: 'practice' },
    ]);
    expect(await getLessonAsset('prefix-sums', 'figure-1.png', guest)).toEqual({ mimeType: 'image/png', data: PNG_1PX });
  });

  it('refuses a bundle that names a problem this grader does not have', async () => {
    const tracks = sampleTracks();
    tracks[1].modules[0].lessons[0].body += '\n\n:::problem P9999';
    const result = await importSample(tracks);
    expect(result.kind).toBe('invalid');
    expect(result.plan.issues).toEqual([{ path: 'graphs/01-traversal/bfs.md', message: 'problem "P9999" does not exist in this grader' }]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM lessons')).rows[0].n).toBe(0);
  });

  it('keeps progress across re-imports, diffs by slug, and needs confirmation to delete completed lessons', async () => {
    await importSample();
    const bfsId = (await findVisibleLessonId('bfs', learner))!;
    await setLessonCompleted(learner.userId, bfsId, true);
    const prefixId = (await findVisibleLessonId('prefix-sums', learner))!;
    await setLessonCompleted(learner.userId, prefixId, true);

    const edited = sampleTracks();
    edited[0].modules[0].lessons[1].body += '\n\nแก้นิดหน่อย';
    edited[1].modules[0].lessons = [{ slug: 'dfs', title: 'DFS', body: 'ลงลึกก่อน แล้วค่อยถอย' }];

    const blocked = await importSample(edited);
    expect(blocked.kind).toBe('needs_confirmation');
    expect(blocked.plan.lessons).toMatchObject({
      added: [expect.objectContaining({ slug: 'dfs' })],
      changed: [expect.objectContaining({ slug: 'prefix-sums' })],
      removed: [expect.objectContaining({ slug: 'bfs', usersWithProgress: 1 })],
      unchanged: 1,
    });
    expect(await findVisibleLessonId('bfs', learner)).toBe(bfsId);

    const applied = await importSample(edited, true);
    expect(applied.kind).toBe('imported');
    expect(await findVisibleLessonId('bfs', learner)).toBeNull();
    expect(await findVisibleLessonId('prefix-sums', learner)).toBe(prefixId);
    const progress = await pool.query('SELECT lesson_id FROM lesson_progress WHERE user_id = $1', [learner.userId]);
    expect(progress.rows).toEqual([{ lesson_id: prefixId }]);

    const unchanged = await importSample(edited);
    expect(unchanged.kind).toBe('imported');
    expect(unchanged.plan.lessons).toMatchObject({ added: [], changed: [], removed: [], unchanged: 3 });
  });

  it('removes tracks and modules the bundle no longer has', async () => {
    await importSample();
    const onlyFoundations = sampleTracks().slice(0, 1);
    const result = await importSample(onlyFoundations);
    expect(result.kind).toBe('imported');
    expect(result.plan.tracks.removed).toEqual(['graphs']);
    expect((await pool.query('SELECT slug FROM lesson_tracks')).rows).toEqual([{ slug: 'foundations' }]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM lesson_modules')).rows[0].n).toBe(1);
  });

  it('moves a lesson between modules without losing its progress', async () => {
    await importSample();
    const id = (await findVisibleLessonId('bfs', learner))!;
    await setLessonCompleted(learner.userId, id, true);
    const moved = sampleTracks();
    moved[0].modules[0].lessons.push(moved[1].modules[0].lessons[0]);
    moved.pop();
    const result = await importSample(moved);
    expect(result.kind).toBe('imported');
    expect(await findVisibleLessonId('bfs', learner)).toBe(id);
    const track = await getLearnTrack('foundations', learner);
    expect(track!.modules[0].lessons.map((l) => [l.slug, l.completed])).toEqual([
      ['time-complexity', false], ['prefix-sums', false], ['bfs', true],
    ]);
  });

  it('serves tracks, progress counts and the next lesson to continue', async () => {
    await importSample();
    expect((await getLearnTracks(guest)).tracks.map((t) => [t.slug, t.lessonCount, t.completedCount]))
      .toEqual([['foundations', 2, null], ['graphs', 1, null]]);

    await setLessonCompleted(learner.userId, (await findVisibleLessonId('time-complexity', learner))!, true);
    const mine = await getLearnTracks(learner);
    expect(mine.tracks[0].completedCount).toBe(1);
    expect(mine.continueLesson).toEqual({
      trackSlug: 'foundations', trackTitle: 'Foundations', moduleTitle: 'Complexity',
      lessonSlug: 'prefix-sums', lessonTitle: 'Prefix Sums', minutes: 12,
    });
  });

  it('derives problem status and hides contest problems from learners', async () => {
    await importSample();
    await pool.query(
      `INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded) VALUES ($1, 'P0002', 10)`,
      [learner.userId],
    );
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results) VALUES
         ($1, 'P0002', 'x', 'cpp', 'Accepted', 100, '[{"testCase":1,"status":"Accepted"},{"testCase":2,"status":"Accepted"}]'),
         ($1, 'P0002', 'x', 'cpp', 'Wrong Answer', 50, '[{"testCase":1,"status":"Accepted"},{"testCase":2,"status":"Wrong Answer"}]')`,
      [learner.userId],
    );
    const contest = await pool.query<{ id: number }>(
      `INSERT INTO contests (title, start_time, end_time, status) VALUES ('Weekly', NOW(), NOW() + interval '1 hour', 'running') RETURNING id`,
    );
    await pool.query(`UPDATE problems SET contest_id = $1 WHERE id = 'P0003'`, [contest.rows[0].id]);

    const lesson = (await getLearnLesson('prefix-sums', learner))!;
    expect(lesson.lesson.html).toContain('data-lesson="solution" data-problem="P0002"');
    expect(lesson.lesson.completed).toBe(false);
    expect(lesson.previous).toEqual({ slug: 'time-complexity', title: 'Time Complexity' });
    expect(lesson.next).toBeNull();
    expect(lesson.module).toEqual({ slug: 'complexity', title: 'Complexity', lessonCount: 2, completedCount: 0 });
    expect(lesson.problems).toEqual([
      {
        position: 1, role: 'example', available: true, id: 'P0002', title: 'Range Sum', difficulty: 900,
        problemType: 'standard', status: 'solved', bestScore: 100, caseStatuses: ['Accepted', 'Accepted'],
      },
      {
        position: 2, role: 'practice', available: false, id: null, title: null, difficulty: null,
        problemType: null, status: null, bestScore: null, caseStatuses: null,
      },
    ]);

    const asStaff = (await getLearnLesson('prefix-sums', staff))!;
    expect(asStaff.problems[1]).toMatchObject({ available: false, unavailableReason: 'in_contest', id: 'P0003', status: 'not_tried' });

    const asGuest = (await getLearnLesson('prefix-sums', guest))!;
    expect(asGuest.problems[0]).toMatchObject({ id: 'P0002', status: null, bestScore: null, caseStatuses: null });
    expect(asGuest.lesson.completed).toBeNull();
  });

  it('follows problem renames and drops deleted problems from lessons', async () => {
    await importSample();
    await pool.query(`UPDATE problems SET id = 'P0002-renamed' WHERE id = 'P0002'`);
    await pool.query(`DELETE FROM problems WHERE id = 'P0003'`);
    const lesson = (await getLearnLesson('prefix-sums', staff))!;
    expect(lesson.problems.map((p) => p.id)).toEqual(['P0002-renamed']);
  });

  it('hides a hidden track and everything in it from non-staff', async () => {
    await importSample();
    const trackId = (await pool.query<{ id: number }>(`SELECT id FROM lesson_tracks WHERE slug = 'graphs'`)).rows[0].id;
    expect(await setLessonTrackVisibility(trackId, false)).toBe(true);
    expect(await setLessonTrackVisibility(99999, false)).toBe(false);

    expect((await getLearnTracks(learner)).tracks.map((t) => t.slug)).toEqual(['foundations']);
    expect(await getLearnTrack('graphs', learner)).toBeNull();
    expect(await getLearnLesson('bfs', learner)).toBeNull();
    expect(await findVisibleLessonId('bfs', learner)).toBeNull();
    expect((await getLearnTrack('graphs', staff))!.track.isVisible).toBe(false);

    // A re-import keeps the staff's visibility choice.
    await importSample();
    expect(await getLearnTrack('graphs', learner)).toBeNull();
  });

  it('marks and unmarks completion idempotently', async () => {
    await importSample();
    const id = (await findVisibleLessonId('bfs', learner))!;
    const first = await setLessonCompleted(learner.userId, id, true);
    const again = await setLessonCompleted(learner.userId, id, true);
    expect(again).toEqual(first);
    expect(await setLessonCompleted(learner.userId, id, false)).toBeNull();
    expect(await setLessonCompleted(learner.userId, id, false)).toBeNull();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM lesson_progress')).rows[0].n).toBe(0);
  });

  it('rolls back everything when a write fails part-way', async () => {
    await importSample();
    const entries = lessonBundleEntries(sampleTracks());
    entries['graphs/01-traversal/bfs.md'] = 'เปลี่ยนแล้ว';
    const zip = await zipOf(entries);
    const original = (db.withTransaction as jest.Mock).getMockImplementation()!;
    (db.withTransaction as jest.Mock).mockImplementationOnce(async (body: (client: pg.PoolClient) => Promise<unknown>) =>
      original(async (client: pg.PoolClient) => {
        const failing = Object.create(client) as pg.PoolClient;
        failing.query = ((text: string, values?: unknown[]) => (
          String(text).includes('INSERT INTO lesson_imports')
            ? Promise.reject(new Error('disk full'))
            : client.query(text, values))) as pg.PoolClient['query'];
        return body(failing);
      }));
    await expect(importLessonBundle(zip, { userId: staff.userId, confirmRemovals: false })).rejects.toThrow('disk full');
    const bfs = await pool.query(`SELECT source_md FROM lessons WHERE slug = 'bfs'`);
    expect(bfs.rows[0].source_md).toContain('เดินทีละชั้น');
  });
});
