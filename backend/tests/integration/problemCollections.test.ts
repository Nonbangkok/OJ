import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import {
  createCollection,
  deleteCollection,
  listCollections,
  setCollectionVisibility,
  updateCollection,
} from '../../services/collectionQueryService';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblem, getAdminProblems, updateProblem } from '../../services/problemQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('problem collections integration', () => {
  const schema = `coll_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const database = { pool, query: pool.query.bind(pool) };

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE problems, collections CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const seedProblem = (id: string, visible = true) =>
    pool.query(
      `INSERT INTO problems (id, title, is_visible) VALUES ($1, $1, $2)`,
      [id, visible],
    );

  it('creates, renames, and rejects duplicate collection names', async () => {
    const created = await createCollection('Chapter 1');
    expect(created.kind).toBe('created');

    const dup = await createCollection('Chapter 1');
    expect(dup.kind).toBe('duplicate_name');

    const renamed = await updateCollection((created as { collection: { id: number } }).collection.id, 'Chapter One');
    expect(renamed.kind).toBe('updated');
    expect((renamed as { collection: { name: string } }).collection.name).toBe('Chapter One');

    const missing = await updateCollection(99999, 'Nope');
    expect(missing.kind).toBe('not_found');
  });

  it('derives All Visible / All Hidden / Mixed / Empty from member problems', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');
    const c = await createCollection('C');
    const e = await createCollection('Empty');
    const idOf = (r: unknown) => (r as { collection: { id: number } }).collection.id;
    await seedProblem('a1'); await seedProblem('a2');
    await pool.query(`UPDATE problems SET collection_id=$1 WHERE id IN ('a1','a2')`, [idOf(a)]);
    await seedProblem('b1', false); await seedProblem('b2', false);
    await pool.query(`UPDATE problems SET collection_id=$1 WHERE id IN ('b1','b2')`, [idOf(b)]);
    await seedProblem('c1', true); await seedProblem('c2', false);
    await pool.query(`UPDATE problems SET collection_id=$1 WHERE id IN ('c1','c2')`, [idOf(c)]);

    const byName = new Map((await listCollections()).map((col) => [col.name, col]));
    expect(byName.get('A')).toMatchObject({ problem_count: 2, status: 'all_visible' });
    expect(byName.get('B')).toMatchObject({ problem_count: 2, status: 'all_hidden' });
    expect(byName.get('C')).toMatchObject({ problem_count: 2, status: 'mixed' });
    expect(byName.get('Empty')).toMatchObject({ problem_count: 0, status: 'empty' });
  });

  it('flips the existing visibility column for every problem in one action', async () => {
    const created = await createCollection('D');
    const id = (created as { collection: { id: number } }).collection.id;
    await seedProblem('d1', true); await seedProblem('d2', false); await seedProblem('d3', true);
    await pool.query(`UPDATE problems SET collection_id=$1 WHERE id LIKE 'd%'`, [id]);

    const hidden = await setCollectionVisibility(id, false);
    expect(hidden).toBe(3);
    let rows = await pool.query(`SELECT COUNT(*) FROM problems WHERE collection_id=$1 AND is_visible`, [id]);
    expect(Number(rows.rows[0].count)).toBe(0);

    const shown = await setCollectionVisibility(id, true);
    expect(shown).toBe(3);
    rows = await pool.query(`SELECT COUNT(*) FROM problems WHERE collection_id=$1 AND NOT is_visible`, [id]);
    expect(Number(rows.rows[0].count)).toBe(0);
  });

  it('deleting a collection detaches its problems instead of deleting them', async () => {
    const created = await createCollection('E');
    const id = (created as { collection: { id: number } }).collection.id;
    await seedProblem('e1'); await seedProblem('e2');
    await pool.query(`UPDATE problems SET collection_id=$1 WHERE id LIKE 'e%'`, [id]);

    expect(await deleteCollection(id)).toBe(true);
    const survivors = await pool.query(`SELECT COUNT(*) FROM problems WHERE id LIKE 'e%' AND collection_id IS NULL`);
    expect(Number(survivors.rows[0].count)).toBe(2);
    expect(await deleteCollection(id)).toBe(false);
  });

  it('a problem carries at most one collection through create and update', async () => {
    const a = await createCollection('F');
    const b = await createCollection('G');
    const idA = (a as { collection: { id: number } }).collection.id;
    const idB = (b as { collection: { id: number } }).collection.id;

    await createProblem({ id: 'f1', title: 'F One', author: 'x', categories: [], collection_id: idA, time_limit_ms: 1000, memory_limit_mb: 256 } as never);
    let rows = (await getAdminProblems()).find((p) => p.id === 'f1');
    expect(rows?.collection_id).toBe(idA);
    expect(rows?.collection_name).toBe('F');

    // Reassign to another collection.
    await updateProblem('f1', { id: 'f1', collection_id: idB } as never);
    rows = (await getAdminProblems()).find((p) => p.id === 'f1');
    expect(rows?.collection_id).toBe(idB);

    // Clear back to no collection.
    await updateProblem('f1', { id: 'f1', collection_id: null } as never);
    rows = (await getAdminProblems()).find((p) => p.id === 'f1');
    expect(rows?.collection_id).toBeNull();
    expect(rows?.collection_name).toBeNull();
  });

  it('leaves categories untouched when a collection is assigned', async () => {
    const created = await createCollection('H');
    const id = (created as { collection: { id: number } }).collection.id;
    await createProblem({ id: 'h1', title: 'H One', author: 'x', categories: ['Math', 'Graph'], collection_id: id, time_limit_ms: 1000, memory_limit_mb: 256 } as never);

    const row = (await getAdminProblems()).find((p) => p.id === 'h1');
    expect([...(row?.categories ?? [])].sort()).toEqual(['Graph', 'Math']);
    expect(row?.collection_id).toBe(id);
  });
});
