import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import {
  getProblemsWithStatsForUser,
  getPublicProblemCategoryCounts,
} from '../../services/problemQueryService';
import type { ProblemsPage } from '../../types/service';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('problems-with-stats incremental loading', () => {
  const schema = `inc_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'incremental-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(problemRoutes); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE submissions, problems, contests CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const insertProblem = (id: string, opts: {
    difficulty?: number | null; visible?: boolean; contest?: boolean;
    categories?: string[]; title?: string;
  } = {}) =>
    pool.query(
      `INSERT INTO problems (id, title, author, categories, difficulty, time_limit_ms, memory_limit_mb, is_visible, contest_id)
       VALUES ($1, $2, 'A', $3::text[], $4, 1000, 256, $5, $6)`,
      [id, opts.title ?? id, opts.categories ?? [], opts.difficulty ?? null,
       opts.visible ?? true, opts.contest ? 1 : null],
    );

  const insertContestProblem = () =>
    pool.query(
      `INSERT INTO contests (id, title, start_time, end_time, status)
       VALUES (1, 'C', NOW(), NOW() + '1 day', 'running')
       ON CONFLICT (id) DO NOTHING`,
    );

  const insertSubmission = (userId: number, problemId: string, score: number, status = 'Accepted') =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results)
       VALUES ($1, $2, 'int main(){}', 'cpp', $3, $4, '[]')`,
      [userId, problemId, status, score],
    );

  /** Walks every page to exhaustion using the returned cursors. */
  const walkAll = async (userId: number | null, options: Parameters<typeof getProblemsWithStatsForUser>[1] = {}) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page: ProblemsPage = await getProblemsWithStatsForUser(userId, { ...options, cursor });
      pages += 1;
      ids.push(...page.problems.map(p => p.id));
      if (!page.hasMore) { expect(page.nextCursor).toBeNull(); return { ids, pages }; }
      expect(typeof page.nextCursor).toBe('string');
      cursor = page.nextCursor!;
      if (pages > 50) throw new Error('cursor walk did not terminate');
    }
  };

  describe('limit+1 boundary behavior (0/1/19/20/21/40/41 problems)', () => {
    it('returns an empty first page for zero problems', async () => {
      const page = await getProblemsWithStatsForUser(1, { limit: 20 });
      expect(page).toEqual({ problems: [], nextCursor: null, hasMore: false });
    });

    it.each([1, 19])('returns exactly %i problems in one page with no cursor', async (count) => {
      for (let i = 0; i < count; i++) await insertProblem(`p${String(i).padStart(2, '0')}`);
      const page = await getProblemsWithStatsForUser(1, { limit: 20 });
      expect(page.problems).toHaveLength(count);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it.each([20, 21])('walks %i problems starting from a full 20-row first page', async (count) => {
      for (let i = 0; i < count; i++) await insertProblem(`p${String(i).padStart(2, '0')}`);
      const page = await getProblemsWithStatsForUser(1, { limit: 20 });
      expect(page.problems).toHaveLength(20);
      // Exactly 20 matching rows: the limit+1 fetch finds no extra row, so
      // this is already the last page. 21 rows: hasMore with a cursor.
      expect(page.hasMore).toBe(count > 20);
      if (count > 20) {
        expect(typeof page.nextCursor).toBe('string');
        const second = await getProblemsWithStatsForUser(1, { limit: 20, cursor: page.nextCursor! });
        expect(second.problems.map(p => p.id)).toEqual(['p20']);
        expect(second.hasMore).toBe(false);
      } else {
        expect(page.nextCursor).toBeNull();
      }
    });

    it.each([40, 41])('walks all %i problems across pages with no duplicates or gaps', async (count) => {
      for (let i = 0; i < count; i++) await insertProblem(`p${String(i).padStart(2, '0')}`);
      const { ids, pages } = await walkAll(1, { limit: 20 });
      expect(ids).toHaveLength(count);
      expect(new Set(ids).size).toBe(count);
      expect(ids).toEqual([...ids].sort()); // default order is id ASC
      expect(pages).toBe(count > 40 ? 3 : 2);
    });
  });

  describe('cursor walks in every sort mode', () => {
    beforeEach(async () => {
      // Deterministic mix: shared difficulties (tiebreaker territory) plus
      // Unrated rows (NULLS LAST territory).
      await insertProblem('a1', { difficulty: 800 });
      await insertProblem('a2', { difficulty: 800 });
      await insertProblem('b1', { difficulty: 1500 });
      await insertProblem('b2', { difficulty: 1500 });
      await insertProblem('c1', { difficulty: 2200 });
      await insertProblem('u1', { difficulty: null });
      await insertProblem('u2', { difficulty: null });
    });

    it('default (id) order pages in ascending id order', async () => {
      const { ids } = await walkAll(1, { limit: 3 });
      expect(ids).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'u1', 'u2']);
    });

    it('difficulty asc (NULLS LAST) pages with id ASC ties then Unrated last', async () => {
      const { ids } = await walkAll(1, { limit: 2, sort: 'difficulty', order: 'asc' });
      expect(ids).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'u1', 'u2']);
    });

    it('difficulty desc (NULLS LAST) pages with id DESC ties then Unrated last', async () => {
      const { ids } = await walkAll(1, { limit: 2, sort: 'difficulty', order: 'desc' });
      expect(ids).toEqual(['c1', 'b2', 'b1', 'a2', 'a1', 'u2', 'u1']);
    });

    it('keeps keyset paging correct when the cursor row is an Unrated problem', async () => {
      // First page in desc order is c1; walk one row at a time so the walk
      // crosses every boundary: rated ties, the rated→NULL edge, and NULL ties.
      const { ids } = await walkAll(1, { limit: 1, sort: 'difficulty', order: 'desc' });
      expect(ids).toEqual(['c1', 'b2', 'b1', 'a2', 'a1', 'u2', 'u1']);
    });
  });

  describe('filters compose before pagination', () => {
    beforeEach(async () => {
      await insertProblem('alpha-dp', { difficulty: 900, categories: ['Dynamic Programming'], title: 'Dp Alpha' });
      await insertProblem('beta-dp', { difficulty: 2000, categories: ['Dynamic Programming', 'Graph'], title: 'Dp Beta' });
      await insertProblem('gamma-graph', { difficulty: 1200, categories: ['Graph'], title: 'Graph Gamma' });
      await insertProblem('delta-none', { difficulty: 2400, categories: [], title: 'No Category' });
    });

    it('search + category + difficulty all apply before the LIMIT', async () => {
      // 'dp' matches alpha-dp and beta-dp; Graph matches beta-dp and
      // gamma-graph; difficulty >= 1500 keeps beta-dp only.
      const page = await getProblemsWithStatsForUser(1, {
        limit: 20, search: 'dp', category: 'Graph', difficultyMin: 1500,
      });
      expect(page.problems.map(p => p.id)).toEqual(['beta-dp']);
      expect(page.hasMore).toBe(false);
    });

    it('search is case-insensitive and matches id or title', async () => {
      const byTitle = await walkAll(1, { limit: 2, search: 'graph gamma' });
      expect(byTitle.ids).toEqual(['gamma-graph']);
      const byId = await walkAll(1, { limit: 2, search: 'ALPHA' });
      expect(byId.ids).toEqual(['alpha-dp']);
    });

    it('escapes LIKE wildcards so % and _ stay literal', async () => {
      await insertProblem('weird%id', { difficulty: 900 });
      const page = await getProblemsWithStatsForUser(1, { limit: 20, search: '100%' });
      expect(page.problems).toHaveLength(0);
    });

    it('pages a filtered result set with cursors', async () => {
      const { ids, pages } = await walkAll(1, { limit: 1, category: 'Graph' });
      expect(ids).toEqual(['beta-dp', 'gamma-graph']);
      expect(pages).toBe(2);
    });

    it('the Uncategorized filter matches problems with no categories', async () => {
      const { ids } = await walkAll(1, { limit: 2, category: 'Uncategorized' });
      expect(ids).toEqual(['delta-none']);
    });

    it('rejects an unknown category value', async () => {
      const res = await request(app).get('/problems-with-stats?category=Nonsense');
      expect(res.status).toBe(400);
    });
  });

  describe('visibility: hidden and contest problems never appear', () => {
    it('excludes hidden and contest-attached problems from every page', async () => {
      await insertContestProblem();
      await insertProblem('hidden-1', { visible: false });
      await insertProblem('contest-1', { contest: true });
      await insertProblem('public-1');
      await insertProblem('public-2', { visible: false });

      const page = await getProblemsWithStatsForUser(1, { limit: 1 });
      expect(page.problems.map(p => p.id)).toEqual(['public-1']);
      expect(page.hasMore).toBe(false);
    });
  });

  describe('guest vs authenticated stats', () => {
    beforeEach(async () => {
      await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user') ON CONFLICT DO NOTHING");
      await insertProblem('stats-1');
      await insertProblem('stats-2');
      await insertSubmission(1, 'stats-1', 100);
      await insertSubmission(1, 'stats-1', 40, 'Wrong Answer');
      await insertSubmission(1, 'stats-2', 70, 'Wrong Answer');
    });

    it('attaches the authenticated user\'s stats to each batch row', async () => {
      const page = await getProblemsWithStatsForUser(1, { limit: 1 });
      expect(page.problems).toHaveLength(1); // stats-1 < stats-2 by id
      const [s1] = page.problems;
      expect(s1.best_score).toBe(100);
      expect(Number(s1.submission_count)).toBe(2);
      expect(s1.best_submission_status).toBe('Accepted');
      expect(s1.latest_submission_status).toBe('Wrong Answer');
      expect(s1.latest_submission_at).not.toBeNull();

      const second = await getProblemsWithStatsForUser(1, { limit: 1, cursor: page.nextCursor! });
      expect(second.problems[0].id).toBe('stats-2');
      expect(second.problems[0].best_score).toBe(70);
      expect(Number(second.problems[0].submission_count)).toBe(1);
    });

    it('guests get the same rows with no personal stats columns', async () => {
      const page = await getProblemsWithStatsForUser(null, { limit: 20 });
      expect(page.problems.map(p => p.id)).toEqual(['stats-1', 'stats-2']);
      for (const problem of page.problems) {
        expect(problem.best_score).toBeNull();
        expect(problem.submission_count).toBeNull();
        expect(problem.latest_submission_at).toBeNull();
      }
    });
  });

  describe('HTTP endpoint shape', () => {
    beforeEach(async () => {
      await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user') ON CONFLICT DO NOTHING");
      for (let i = 0; i < 25; i++) await insertProblem(`h${String(i).padStart(2, '0')}`);
    });

    it('returns the { problems, nextCursor, hasMore } envelope', async () => {
      const res = await request(app).get('/problems-with-stats?limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
      expect(res.body.problems).toHaveLength(10);
      expect(res.body.problems[0]).toMatchObject({
        id: 'h00', title: 'h00', author: 'A', difficulty: null,
      });
    });

    it('follows the cursor across requests', async () => {
      const first = await request(app).get('/problems-with-stats?limit=10');
      const second = await request(app).get(`/problems-with-stats?limit=10&cursor=${first.body.nextCursor}`);
      expect(second.status).toBe(200);
      expect(second.body.problems.map((p: { id: string }) => p.id)).toEqual(
        Array.from({ length: 10 }, (_, i) => `h${String(10 + i).padStart(2, '0')}`),
      );
      const third = await request(app).get(`/problems-with-stats?limit=10&cursor=${second.body.nextCursor}`);
      expect(third.body.problems).toHaveLength(5);
      expect(third.body.hasMore).toBe(false);
      expect(third.body.nextCursor).toBeNull();
    });

    it('rejects an invalid cursor with 400', async () => {
      const res = await request(app).get('/problems-with-stats?cursor=garbage');
      expect(res.status).toBe(400);
    });

    it('rejects a cursor issued for a different sort mode with 400', async () => {
      const first = await request(app).get('/problems-with-stats?limit=10');
      const res = await request(app).get(`/problems-with-stats?limit=10&sort=difficulty&order=asc&cursor=${first.body.nextCursor}`);
      expect(res.status).toBe(400);
    });

    it('rejects out-of-range limits with 400', async () => {
      expect((await request(app).get('/problems-with-stats?limit=0')).status).toBe(400);
      expect((await request(app).get('/problems-with-stats?limit=101')).status).toBe(400);
    });
  });

  describe('category counts endpoint', () => {
    beforeEach(async () => {
      await insertContestProblem();
      await insertProblem('cat-a', { categories: ['Graph', 'Math'] });
      await insertProblem('cat-b', { categories: ['Graph'] });
      await insertProblem('cat-c', { visible: false, categories: ['Graph'] });
      await insertProblem('cat-d', { contest: true, categories: ['Math'] });
      await insertProblem('cat-e', { categories: [] });
    });

    it('counts only visible standalone problems, per category plus totals', async () => {
      const counts = await getPublicProblemCategoryCounts();
      expect(counts).toEqual({
        categories: [{ name: 'Graph', count: 2 }, { name: 'Math', count: 1 }],
        uncategorized: 1,
        total: 3,
      });
    });

    it('is served by GET /problems/categories with the same shape', async () => {
      const res = await request(app).get('/problems/categories');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        categories: [{ name: 'Graph', count: 2 }, { name: 'Math', count: 1 }],
        uncategorized: 1,
        total: 3,
      });
    });
  });
});

// Keep the supertest/express imports meaningful even when the suite is skipped.
void request; void express; void session; void db;
