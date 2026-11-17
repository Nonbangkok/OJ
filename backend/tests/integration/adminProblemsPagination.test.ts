import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { attachRequestUser } from '../../middleware/requestContext';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getAdminProblemsPage, updateAdminProblemsVisibility } from '../../services/problemQueryService';
import type { AdminProblemsPage } from '../../services/problemQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('admin problems list pagination', () => {
  const schema = `adm_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'admin-list-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(attachRequestUser);
  app.use(problemRoutes); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problems, collections, contests CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const insertProblem = (id: string, opts: {
    visible?: boolean; contest?: boolean; collection?: number | null; author?: string | null; title?: string;
  } = {}) =>
    pool.query(
      `INSERT INTO problems (id, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb, is_visible, contest_id)
       VALUES ($1, $2, $3, '{}', NULL, $4, 1000, 256, $5, $6)`,
      [id, opts.title ?? id, opts.author === undefined ? 'A' : opts.author,
       opts.collection ?? null, opts.visible ?? true, opts.contest ? 1 : null],
    );

  const insertContest = () =>
    pool.query(
      `INSERT INTO contests (id, title, start_time, end_time, status)
       VALUES (1, 'C', NOW(), NOW() + '1 day', 'running') ON CONFLICT (id) DO NOTHING`,
    );

  const insertCollection = (name: string) =>
    pool.query('INSERT INTO collections (name) VALUES ($1) RETURNING id', [name]);

  /** Walks every page to exhaustion using the returned cursors. */
  const walkAll = async (options: Parameters<typeof getAdminProblemsPage>[0] = {}) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page: AdminProblemsPage = await getAdminProblemsPage({ ...options, cursor });
      pages += 1;
      ids.push(...page.problems.map(p => p.id));
      if (!page.hasMore) { expect(page.nextCursor).toBeNull(); return { ids, pages }; }
      expect(typeof page.nextCursor).toBe('string');
      cursor = page.nextCursor!;
      if (pages > 50) throw new Error('cursor walk did not terminate');
    }
  };

  describe('limit+1 boundary behavior', () => {
    it('returns an empty first page for zero problems', async () => {
      const page = await getAdminProblemsPage({ limit: 25 });
      expect(page.problems).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it.each([24, 25, 26])('pages %i problems with a 25-row batch', async (count) => {
      for (let i = 0; i < count; i++) await insertProblem(`p${String(i).padStart(2, '0')}`);
      const page = await getAdminProblemsPage({ limit: 25 });
      expect(page.problems).toHaveLength(Math.min(count, 25));
      expect(page.hasMore).toBe(count > 25);
      if (count > 25) {
        const second = await getAdminProblemsPage({ limit: 25, cursor: page.nextCursor! });
        expect(second.problems.map(p => p.id)).toEqual(['p25']);
        expect(second.hasMore).toBe(false);
      } else {
        expect(page.nextCursor).toBeNull();
      }
    });

    it('walks all pages with no duplicates or gaps in id ASC order', async () => {
      for (let i = 0; i < 60; i++) await insertProblem(`p${String(i).padStart(2, '0')}`);
      const { ids, pages } = await walkAll({ limit: 25 });
      expect(ids).toHaveLength(60);
      expect(new Set(ids).size).toBe(60);
      expect(ids).toEqual([...ids].sort());
      expect(pages).toBe(3);
    });
  });

  describe('admin semantics: visible + hidden + contest problems all included', () => {
    it('includes hidden and contest-attached problems on every page', async () => {
      await insertContest();
      for (let i = 0; i < 30; i++) await insertProblem(`h${String(i).padStart(2, '0')}`, { visible: false });
      await insertProblem('contest-1', { contest: true });

      const page = await getAdminProblemsPage({ limit: 10 });
      // Order is id ASC: contest-1 sorts before h00..h29. The batch mixes a
      // visible contest problem with hidden problems — exactly the admin view.
      expect(page.problems[0].id).toBe('contest-1');
      expect(page.problems).toHaveLength(10);
      expect(page.problems[1]).toMatchObject({ id: 'h00', is_visible: false });
      const { ids } = await walkAll({ limit: 10 });
      expect(ids).toEqual(['contest-1', ...Array.from({ length: 30 }, (_, i) => `h${String(i).padStart(2, '0')}`)]);
    });
  });

  describe('filter-wide visibility scope', () => {
    it('updates all eligible matches independently of loaded pages and excludes contest-attached problems', async () => {
      await insertContest();
      for (let i = 0; i < 100; i++) await insertProblem(`p${String(i).padStart(3, '0')}`);
      await insertProblem('contest-p', { contest: true });

      const first = await getAdminProblemsPage({ limit: 20 });
      expect(first.problems).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      expect(first.bulkEligibleCount).toBe(100);
      // Loading another page must not affect the server-side action scope.
      await getAdminProblemsPage({ limit: 20, cursor: first.nextCursor! });

      expect(await updateAdminProblemsVisibility({}, false)).toEqual({ updatedCount: 100 });
      const state = await pool.query<{ is_visible: boolean; contest_id: number | null }>(
        'SELECT is_visible, contest_id FROM problems',
      );
      expect(state.rows.filter(row => row.contest_id === null && !row.is_visible)).toHaveLength(100);
      expect(state.rows.find(row => row.contest_id !== null)?.is_visible).toBe(true);
    });

    it('search scope changes exactly matching rows across pages', async () => {
      for (let i = 0; i < 100; i++) await insertProblem(`all-${String(i).padStart(3, '0')}`, {
        title: i < 30 ? `01_Expr ${i}` : `Other ${i}`,
      });
      const first = await getAdminProblemsPage({ limit: 20, search: '01_Expr' });
      expect(first.problems).toHaveLength(20);
      expect(first.bulkEligibleCount).toBe(30);
      expect(await updateAdminProblemsVisibility({ search: '01_Expr' }, false)).toEqual({ updatedCount: 30 });
      const hidden = await pool.query<{ id: string }>('SELECT id FROM problems WHERE is_visible = false');
      expect(hidden.rows).toHaveLength(30);
      expect(hidden.rows.every(row => row.id.startsWith('all-'))).toBe(true);
    });

    it('collection-only and author-only scopes leave other groups unchanged', async () => {
      const cedt = await insertCollection('CEDT');
      const other = await insertCollection('Other');
      const cedtId = (cedt.rows[0] as { id: number }).id;
      const otherId = (other.rows[0] as { id: number }).id;
      for (const [id, collection, author] of [
        ['cedt-a', cedtId, 'Alice'], ['cedt-b', cedtId, 'Bob'],
        ['other-a', otherId, 'Alice'], ['other-b', otherId, 'Carol'],
      ] as const) await insertProblem(id, { collection, author, visible: false });

      expect((await getAdminProblemsPage({ collection: cedtId, limit: 1 })).bulkEligibleCount).toBe(2);
      expect(await updateAdminProblemsVisibility({ collection: cedtId }, true)).toEqual({ updatedCount: 2 });
      let states = await pool.query<{ id: string; is_visible: boolean }>('SELECT id, is_visible FROM problems ORDER BY id');
      expect(states.rows.map(row => row.is_visible)).toEqual([true, true, false, false]);
      expect(await updateAdminProblemsVisibility({ author: 'Alice' }, false)).toEqual({ updatedCount: 2 });
      states = await pool.query<{ id: string; is_visible: boolean }>('SELECT id, is_visible FROM problems ORDER BY id');
      expect(states.rows).toEqual([
        { id: 'cedt-a', is_visible: false },
        { id: 'cedt-b', is_visible: true },
        { id: 'other-a', is_visible: false },
        { id: 'other-b', is_visible: false },
      ]);
    });

    it('composes collection, author, and other filters and preserves the pre-update visibility scope', async () => {
      const cedt = await insertCollection('CEDT');
      const other = await insertCollection('Other');
      const cedtId = (cedt.rows[0] as { id: number }).id;
      const otherId = (other.rows[0] as { id: number }).id;
      await insertProblem('cedt-alice-hidden', { collection: cedtId, author: 'Alice', visible: false, title: 'Graph match' });
      await insertProblem('cedt-alice-visible', { collection: cedtId, author: 'Alice', visible: true, title: 'Graph match' });
      await insertProblem('cedt-bob-hidden', { collection: cedtId, author: 'Bob', visible: false, title: 'Graph match' });
      await insertProblem('other-alice-hidden', { collection: otherId, author: 'Alice', visible: false, title: 'Graph match' });

      const filters = { search: 'Graph', collection: cedtId, author: 'Alice', visibility: 'hidden' as const };
      const page = await getAdminProblemsPage({ ...filters, limit: 1 });
      expect(page.bulkEligibleCount).toBe(1);
      expect(await updateAdminProblemsVisibility(filters, true)).toEqual({ updatedCount: 1 });
      const refreshedHidden = await getAdminProblemsPage({ ...filters, limit: 10 });
      expect(refreshedHidden.problems).toEqual([]);

      const states = await pool.query<{ id: string; is_visible: boolean }>('SELECT id, is_visible FROM problems ORDER BY id');
      expect(states.rows).toEqual([
        { id: 'cedt-alice-hidden', is_visible: true },
        { id: 'cedt-alice-visible', is_visible: true },
        { id: 'cedt-bob-hidden', is_visible: false },
        { id: 'other-alice-hidden', is_visible: false },
      ]);
    });
  });

  describe('filters compose before pagination', () => {
    beforeEach(async () => {
      const collection = await insertCollection('Chapter 1');
      const collectionId = (collection.rows[0] as { id: number }).id;
      await insertProblem('alpha-dp', { title: 'Dp Alpha', author: 'Alice' });
      await insertProblem('beta-dp', { title: 'Dp Beta', author: 'Bob' });
      await insertProblem('gamma-graph', { title: 'Graph Gamma', author: 'Alice', collection: collectionId });
      await insertProblem('delta-none', { title: 'No Collection', author: null, collection: null });
      await insertProblem('epsilon-blank', { title: 'Blank Author', author: '   ', collection: collectionId });
      await insertProblem('zeta-hidden', { title: 'Hidden Zeta', author: 'Alice', visible: false });
    });

    it('search matches id or title case-insensitively before the LIMIT', async () => {
      const byTitle = await walkAll({ limit: 1, search: 'graph gamma' });
      expect(byTitle.ids).toEqual(['gamma-graph']);
      const byId = await walkAll({ limit: 1, search: 'ALPHA' });
      expect(byId.ids).toEqual(['alpha-dp']);
    });

    it('escapes LIKE wildcards so % stays literal', async () => {
      await insertProblem('weird%id');
      const page = await getAdminProblemsPage({ limit: 25, search: '100%' });
      expect(page.problems).toHaveLength(0);
    });

    it('collection filter: a specific collection, and no collection', async () => {
      const collection = await pool.query<{ id: number }>('SELECT id FROM collections LIMIT 1');
      const inCollection = await walkAll({ limit: 2, collection: collection.rows[0].id });
      expect(inCollection.ids).toEqual(['epsilon-blank', 'gamma-graph']);

      const noCollection = await walkAll({ limit: 2, collection: 'none' });
      expect(noCollection.ids).toEqual(['alpha-dp', 'beta-dp', 'delta-none', 'zeta-hidden']);
    });

    it('visibility filter keeps only that slice (hidden problems stay queryable)', async () => {
      const hidden = await walkAll({ limit: 2, visibility: 'hidden' });
      expect(hidden.ids).toEqual(['zeta-hidden']);
      const visible = await walkAll({ limit: 2, visibility: 'visible' });
      expect(visible.ids).toEqual(['alpha-dp', 'beta-dp', 'delta-none', 'epsilon-blank', 'gamma-graph']);
    });

    it('author filter matches exact trimmed name; none matches empty/NULL authors', async () => {
      const alice = await walkAll({ limit: 2, author: 'Alice' });
      expect(alice.ids).toEqual(['alpha-dp', 'gamma-graph', 'zeta-hidden']);
      const none = await walkAll({ limit: 2, author: 'none' });
      expect(none.ids).toEqual(['delta-none', 'epsilon-blank']);
    });

    it('pages a FILTERED result set with cursors (filter + pagination compose)', async () => {
      for (let i = 0; i < 5; i++) await insertProblem(`alice-${i}`, { author: 'Alice' });
      const first = await getAdminProblemsPage({ limit: 3, author: 'Alice' });
      expect(first.problems.map(p => p.id)).toEqual(['alice-0', 'alice-1', 'alice-2']);
      expect(first.hasMore).toBe(true);
      const second = await getAdminProblemsPage({ limit: 3, author: 'Alice', cursor: first.nextCursor! });
      expect(second.problems.map(p => p.id)).toEqual(['alice-3', 'alice-4', 'alpha-dp']);
      const third = await getAdminProblemsPage({ limit: 3, author: 'Alice', cursor: second.nextCursor! });
      expect(third.problems.map(p => p.id)).toEqual(['gamma-graph', 'zeta-hidden']);
      expect(third.hasMore).toBe(false);
    });

    it('carries the author aggregate (whole pool) alongside every page', async () => {
      const page = await getAdminProblemsPage({ limit: 1, author: 'Alice' });
      // Options cover the whole pool even though the page is Alice-only.
      expect(page.authors.map(a => a.name)).toEqual(['Alice', 'Bob']);
      expect(page.hasUnauthoredProblems).toBe(true);
    });
  });

  describe('HTTP endpoint shape', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) await insertProblem(`h${String(i).padStart(2, '0')}`);
    });

    it('returns the paginated results plus the eligible filtered count', async () => {
      const res = await request(app).get('/admin/problems?limit=10').set('x-test-role', 'admin');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ hasMore: true, nextCursor: expect.any(String), hasUnauthoredProblems: false, bulkEligibleCount: 25 });
      expect(res.body.problems).toHaveLength(10);
      expect(res.body.problems[0]).toMatchObject({ id: 'h00', title: 'h00', author: 'A' });
      expect(res.body.authors).toEqual([{ name: 'A' }]);
    });

    it('follows the cursor across requests', async () => {
      const first = await request(app).get('/admin/problems?limit=10').set('x-test-role', 'admin');
      const second = await request(app).get(`/admin/problems?limit=10&cursor=${first.body.nextCursor}`).set('x-test-role', 'admin');
      expect(second.status).toBe(200);
      expect(second.body.problems.map((p: { id: string }) => p.id)).toEqual(
        Array.from({ length: 10 }, (_, i) => `h${String(10 + i).padStart(2, '0')}`),
      );
      const third = await request(app).get(`/admin/problems?limit=10&cursor=${second.body.nextCursor}`).set('x-test-role', 'admin');
      expect(third.body.problems).toHaveLength(5);
      expect(third.body.hasMore).toBe(false);
      expect(third.body.nextCursor).toBeNull();
    });

    it('applies query filters through the endpoint', async () => {
      const res = await request(app).get('/admin/problems?limit=5&search=h1&visibility=visible').set('x-test-role', 'admin');
      expect(res.status).toBe(200);
      // ids are zero-padded (h00..h24), so 'h1' matches h10..h19 by id ASC.
      expect(res.body.problems.map((p: { id: string }) => p.id)).toEqual(['h10', 'h11', 'h12', 'h13', 'h14']);
      expect(res.body.hasMore).toBe(true);
    });

    it('rejects an invalid cursor with 400', async () => {
      const res = await request(app).get('/admin/problems?cursor=garbage').set('x-test-role', 'admin');
      expect(res.status).toBe(400);
    });

    it('rejects out-of-range limits with 400', async () => {
      expect((await request(app).get('/admin/problems?limit=0').set('x-test-role', 'admin')).status).toBe(400);
      expect((await request(app).get('/admin/problems?limit=101').set('x-test-role', 'admin')).status).toBe(400);
    });

    it('rejects unknown query parameters with 400 (strict schema)', async () => {
      const res = await request(app).get('/admin/problems?bogus=1').set('x-test-role', 'admin');
      expect(res.status).toBe(400);
    });

    it('requires staff/admin (401 without a session, 403 as user)', async () => {
      expect((await request(app).get('/admin/problems')).status).toBe(401);
      expect((await request(app).get('/admin/problems').set('x-test-role', 'user')).status).toBe(403);
      expect((await request(app).get('/admin/problems').set('x-test-role', 'staff')).status).toBe(200);
    });
  });

  describe('management views, health, filters and sorting', () => {
    const PDF = Buffer.from('%PDF-1.4 test');
    /** ready: PDF + tests; bare: neither; header-nograder: header with tests and PDF but no grader .cpp */
    const seed = async () => {
      await insertContest();
      await pool.query(`INSERT INTO problems (id, title, author, categories, difficulty, time_limit_ms, memory_limit_mb, is_visible, contest_id, problem_type, submission_filename, problem_pdf)
        VALUES
        ('a-ready', 'Zeta', 'A', '{Graph}', 1500, 1000, 256, true, NULL, 'standard', NULL, $1),
        ('b-bare', 'Alpha', 'A', '{Math}', 900, 1000, 256, true, NULL, 'standard', NULL, NULL),
        ('c-hidden', 'Gamma', 'A', '{Graph,Math}', 2400, 1000, 256, false, NULL, 'standard', NULL, $1),
        ('d-contest', 'Delta', 'A', '{}', NULL, 1000, 256, false, 1, 'standard', NULL, $1),
        ('e-header', 'Beta', 'A', '{}', 1100, 1000, 256, true, NULL, 'header', 'student.h', $1),
        ('f-header-ok', 'Epsilon', 'A', '{}', 1200, 1000, 256, true, NULL, 'header', 'student.h', $1)`, [PDF]);
      for (const id of ['a-ready', 'c-hidden', 'd-contest', 'e-header', 'f-header-ok']) {
        await pool.query("INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, 1, '1', '1'), ($1, 2, '2', '2')", [id]);
      }
      await pool.query("INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('a-ready', 3, '3', '3')");
      await pool.query("INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('f-header-ok', 'grader', 'main.cpp', 'x'), ('e-header', 'starter', 'student.h', 'x')");
    };
    const ids = (page: AdminProblemsPage) => page.problems.map((p) => p.id);

    it('each row carries its health facts', async () => {
      await seed();
      const page = await getAdminProblemsPage({ limit: 25 });
      const row = (id: string) => page.problems.find((p) => p.id === id)!;
      expect(row('a-ready')).toMatchObject({ has_pdf: true, testcase_count: 3, has_grader: false });
      expect(row('b-bare')).toMatchObject({ has_pdf: false, testcase_count: 0 });
      expect(row('f-header-ok')).toMatchObject({ has_grader: true });
      expect(row('e-header')).toMatchObject({ has_grader: false });
    });

    it('views: needs attention, hidden, in contest, header', async () => {
      await seed();
      expect(ids(await getAdminProblemsPage({ view: 'attention' }))).toEqual(['b-bare', 'e-header']);
      expect(ids(await getAdminProblemsPage({ view: 'hidden' }))).toEqual(['c-hidden']);
      expect(ids(await getAdminProblemsPage({ view: 'in_contest' }))).toEqual(['d-contest']);
      expect(ids(await getAdminProblemsPage({ view: 'header' }))).toEqual(['e-header', 'f-header-ok']);
    });

    it('carries the exact total and per-view counts under the other filters', async () => {
      await seed();
      const all = await getAdminProblemsPage({ limit: 2 });
      expect(all.total).toBe(6);
      expect(all.viewCounts).toEqual({ all: 6, attention: 2, hidden: 1, in_contest: 1, header: 2 });
      const graph = await getAdminProblemsPage({ category: 'Graph', view: 'hidden' });
      expect(graph.total).toBe(1);
      expect(graph.viewCounts).toEqual({ all: 2, attention: 0, hidden: 1, in_contest: 0, header: 0 });
    });

    it('filters by difficulty band, categories (any) and type', async () => {
      await seed();
      expect(ids(await getAdminProblemsPage({ difficultyMin: 1100, difficultyMax: 1500 }))).toEqual(['a-ready', 'e-header', 'f-header-ok']);
      expect(ids(await getAdminProblemsPage({ category: 'Math' }))).toEqual(['b-bare', 'c-hidden']);
      expect(ids(await getAdminProblemsPage({ category: 'Uncategorized' }))).toEqual(['d-contest', 'e-header', 'f-header-ok']);
      expect(ids(await getAdminProblemsPage({ type: 'header' }))).toEqual(['e-header', 'f-header-ok']);
    });

    it.each([
      ['title', 'asc', ['b-bare', 'e-header', 'd-contest', 'f-header-ok', 'c-hidden', 'a-ready']],
      ['difficulty', 'desc', ['c-hidden', 'a-ready', 'f-header-ok', 'e-header', 'b-bare', 'd-contest']],
      ['tests', 'desc', ['a-ready', 'c-hidden', 'd-contest', 'e-header', 'f-header-ok', 'b-bare']],
    ] as const)('sorts by %s %s and pages through it without gaps', async (sort, order, expected) => {
      await seed();
      const { ids: walked, pages } = await walkAll({ sort, order, limit: 2 });
      expect(walked).toEqual(expected);
      expect(pages).toBe(3);
    });

    it('validates view, sort and filters through the endpoint', async () => {
      await seed();
      const ok = await request(app).get('/admin/problems?view=attention&sort=difficulty&order=desc&type=header&category=Graph,Math&difficultyMin=800&difficultyMax=3500').set('x-test-role', 'admin');
      expect(ok.status).toBe(200);
      for (const bad of ['view=broken', 'sort=price', 'type=interactive', 'difficultyMin=850', 'category=Nonsense', 'order=desc']) {
        expect((await request(app).get(`/admin/problems?${bad}`).set('x-test-role', 'admin')).status).toBe(400);
      }
    });

    it('bulk visibility honours the same view and filters', async () => {
      await seed();
      const { updatedCount } = await updateAdminProblemsVisibility({ view: 'attention' }, false);
      expect(updatedCount).toBe(2);
      const hidden = (await pool.query('SELECT id FROM problems WHERE is_visible = false ORDER BY id')).rows.map((r) => r.id);
      expect(hidden).toEqual(['b-bare', 'c-hidden', 'd-contest', 'e-header']);
    });
  });
});

// Keep the supertest/express imports meaningful even when the suite is skipped.
void request; void express; void session; void db;
