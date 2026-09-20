import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import archiver from 'archiver';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import * as db from '../../db';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblemDraft } from '../../services/authoringDraftQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { query: jest.fn(), connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('manual testcase HTTP workflow against PostgreSQL', () => {
  const schema = `manual_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let id: string;
  let base: string;
  beforeAll(async () => { await adminPool.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    const draft = await createProblemDraft({ problem_id: 'test', title: 'Fixture', author_profile_id: null,
      author_aka_name: 'A', author_real_name: 'Author', language: 'Thai', country_code: 'THA',
      categories: [],
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null }, database);
    id = draft.id; base = `/admin/authoring/drafts/${id}/testcases`;
  });
  afterAll(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  function app(role = 'admin') {
    const a = express(); a.use(express.json());
    a.use(session({ secret: 'manual-test', resave: false, saveUninitialized: false }));
    a.use((req, _res, next) => { if (role) { req.session.userId = 1; req.session.role = role; } next(); });
    a.use(require('../../controllers/authoringTestcaseController').default); a.use(errorHandler); return a;
  }
  const stored = () => pool.query('SELECT revision, status, verified_revision FROM problem_drafts WHERE id=$1', [id]);
  const cases = () => pool.query('SELECT * FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number', [id]);

  it('appends input, attaches output later, invalidates ready, lists metadata and returns exact single contents', async () => {
    await pool.query("UPDATE problem_drafts SET status='ready', verified_revision=1 WHERE id=$1", [id]);
    const a = app();
    const upload = await request(a).post(base).field('expectedRevision', '1').attach('input', Buffer.from(' 3\r\n'), '3.in');
    expect(upload.status).toBe(201);
    expect((await stored()).rows[0]).toEqual({ revision: 2, status: 'draft', verified_revision: null });
    const row = (await cases()).rows[0];
    expect(row).toEqual(expect.objectContaining({ input_data: ' 3\r\n', output_data: null, source: 'uploaded', source_revision: 2 }));
    const attach = await request(a).patch(`${base}/${row.id}`).field('expectedRevision', '2').attach('output', Buffer.from(' 9\n'), '3.out');
    expect(attach.status).toBe(200);
    expect((await cases()).rows[0].output_data).toBe(' 9\n');
    const list = await request(a).get(base);
    expect(list.status).toBe(200);
    expect(list.body.testcases[0]).toEqual(expect.objectContaining({ id: row.id, inputBytes: 4, outputBytes: 3, hasOutput: true }));
    expect(JSON.stringify(list.body)).not.toContain(' 3');
    const single = await request(a).get(`${base}/${row.id}`);
    expect(single.body).toEqual(expect.objectContaining({ input: ' 3\r\n', output: ' 9\n' }));
    expect((await request(a).patch(`${base}/${row.id}`).field('expectedRevision', '3').attach('input', Buffer.from('changed\n'), 'new.in')).status).toBe(200);
    expect((await cases()).rows[0]).toEqual(expect.objectContaining({ original_input_filename: 'new.in', output_data: null }));
    expect((await request(a).delete(`${base}/${row.id}`).send({ expectedRevision: 4 })).status).toBe(200);
    expect((await cases()).rows).toEqual([]);
    expect((await stored()).rows[0].revision).toBe(5);
  });

  it('rejects stale simultaneous edits and published drafts without replacing their cases', async () => {
    const a = app();
    const results = await Promise.all(['1.in', '2.in'].map(name => request(a).post(base)
      .field('expectedRevision', '1').attach('input', Buffer.from(name), name)));
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const row = (await cases()).rows[0];
    expect((await cases()).rows).toHaveLength(1);
    await pool.query("UPDATE problem_drafts SET status='published' WHERE id=$1", [id]);
    const response = await request(a).delete(`${base}/${row.id}`).send({ expectedRevision: 2 });
    expect(response.status).toBe(409); expect(response.body.code).toBe('draft_published');
    expect((await stored()).rows[0].revision).toBe(2);
    expect((await cases()).rows).toHaveLength(1);
  });

  it('replaces ZIP sets atomically and leaves previous data on malformed or ambiguous uploads', async () => {
    const a = app();
    await request(a).post(base).field('expectedRevision', '1').attach('input', Buffer.from('old'), 'old.in');
    async function zip(entries: [string, string][]) {
      const z = archiver('zip'); const chunks: Buffer[] = []; z.on('data', chunk => chunks.push(chunk));
      entries.forEach(([name, value]) => z.append(value, { name })); await z.finalize(); return Buffer.concat(chunks);
    }
    const bad = await request(a).post(base).field('expectedRevision', '2').attach('archive', await zip([['1.out', 'orphan']]), 'bad.zip');
    expect(bad.status).toBe(400); expect((await cases()).rows[0].input_data).toBe('old');
    const good = await request(a).post(base).field('expectedRevision', '2')
      .attach('archive', await zip([['10.in', 'ten'], ['2.in', 'two'], ['2.out', 'TWO']]), 'cases.zip');
    expect(good.status).toBe(201);
    expect((await cases()).rows.map(r => [r.case_number, r.input_data, r.output_data])).toEqual([[1, 'two', 'TWO'], [2, 'ten', null]]);
    expect((await stored()).rows[0].revision).toBe(3);
    // The first case is inserted before the lazy reader discovers invalid data in the second.
    const lateFailure = await request(a).post(base).field('expectedRevision', '3')
      .attach('archive', await zip([['1.in', 'new'], ['2.in', 'invalid\0text']]), 'late.zip');
    expect(lateFailure.status).toBe(400);
    expect((await stored()).rows[0].revision).toBe(3);
    expect((await cases()).rows.map(r => r.input_data)).toEqual(['two', 'ten']);
  });

  it('cleans per-request disk uploads after success and invalid payloads', async () => {
    const before = (await readdir(os.tmpdir())).filter(n => n.startsWith('oj-authoring-upload-')).sort();
    const a = app();
    expect((await request(a).post(base).field('expectedRevision', '1').attach('input', Buffer.from('x'), '1.in')).status).toBe(201);
    expect((await request(a).post(base).field('expectedRevision', '2').attach('input', Buffer.from('a\0b'), '2.in')).status).toBe(400);
    expect((await request(a).post(base).field('expectedRevision', '2').attach('output', Buffer.from('orphan'), '2.out')).status).toBe(400);
    expect((await readdir(os.tmpdir())).filter(n => n.startsWith('oj-authoring-upload-')).sort()).toEqual(before);
  });

  it('requires admin authorization for every testcase route', async () => {
    for (const [role, status] of [['', 401], ['staff', 403]] as const) {
      const a = app(role);
      expect((await request(a).get(base)).status).toBe(status);
      expect((await request(a).get(`${base}/${randomUUID()}`)).status).toBe(status);
      expect((await request(a).post(base).send({ expectedRevision: 1 })).status).toBe(status);
      expect((await request(a).patch(`${base}/${randomUUID()}`).send({ expectedRevision: 1 })).status).toBe(status);
      expect((await request(a).delete(`${base}/${randomUUID()}`).send({ expectedRevision: 1 })).status).toBe(status);
    }
  });

  it('rolls back replacement, including prior deletion, if PostgreSQL rejects an insert', async () => {
    const { mutateDraftTestcases } = require('../../services/authoringTestcaseQueryService');
    await mutateDraftTestcases(id, 1, { kind: 'append', cases: [{ filename: 'old.in', input: 'old', output: null }] }, database);
    await pool.query("ALTER TABLE problem_draft_testcases ADD CONSTRAINT fixture_failure CHECK (original_input_filename <> 'fail.in')");
    try {
      await expect(mutateDraftTestcases(id, 2, { kind: 'replace', cases: [
        { filename: 'ok.in', input: 'new', output: null }, { filename: 'fail.in', input: 'bad', output: null },
      ] }, database)).rejects.toMatchObject({ code: '23514' });
      expect((await cases()).rows.map(r => r.input_data)).toEqual(['old']);
      expect((await stored()).rows[0].revision).toBe(2);
    } finally { await pool.query('ALTER TABLE problem_draft_testcases DROP CONSTRAINT fixture_failure'); }
  });

  it('checks count and combined input/output bytes against existing draft cases', async () => {
    const a = app();
    await pool.query(`INSERT INTO problem_draft_testcases (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
      SELECT md5('case-' || i)::uuid,$1,i,i || '.in','x',NULL,'uploaded',1 FROM generate_series(1,1000) i`, [id]);
    expect((await request(a).post(base).field('expectedRevision', '1').attach('input', Buffer.from('x'), 'next.in')).status).toBe(413);
    await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [id]);
    await pool.query(`INSERT INTO problem_draft_testcases (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
      SELECT md5('big-' || i)::uuid,$1,i,i || '.in',repeat('x',67108864),repeat('y',67108864),'uploaded',1 FROM generate_series(1,4) i`, [id]);
    expect((await request(a).post(base).field('expectedRevision', '1').attach('input', Buffer.from('x'), 'next.in')).status).toBe(413);
    expect((await stored()).rows[0].revision).toBe(1);
  });

  it('cleans partially streamed uploads when a client disconnects', async () => {
    const before = new Set((await readdir(os.tmpdir())).filter(n => n.startsWith('oj-authoring-upload-')));
    const server = app().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const raw = http.request({ hostname: '127.0.0.1', port: address.port, path: base, method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=fixture', 'content-length': '10485760' } });
    raw.on('error', () => {});
    try {
      raw.write('--fixture\r\nContent-Disposition: form-data; name="expectedRevision"\r\n\r\n1\r\n--fixture\r\nContent-Disposition: form-data; name="input"; filename="1.in"\r\nContent-Type: text/plain\r\n\r\npartial');
      let observed = false;
      for (let i = 0; i < 100; i++) {
        if ((await readdir(os.tmpdir())).some(n => n.startsWith('oj-authoring-upload-') && !before.has(n))) { observed = true; break; }
        await delay(10);
      }
      expect(observed).toBe(true); raw.destroy();
      let cleaned = false;
      for (let i = 0; i < 100; i++) {
        if (!(await readdir(os.tmpdir())).some(n => n.startsWith('oj-authoring-upload-') && !before.has(n))) { cleaned = true; break; }
        await delay(10);
      }
      expect(cleaned).toBe(true); expect((await cases()).rows).toEqual([]);
    } finally { raw.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('rejects malformed multipart and invalid revisions with stable client errors', async () => {
    const a = app();
    const malformed = await request(a).post(base).set('Content-Type', 'multipart/form-data; boundary=broken')
      .send('--broken\r\nContent-Disposition: form-data; name="input"; filename="1.in"\r\n\r\nincomplete');
    expect(malformed.status).toBe(400); expect(malformed.body.code).toBe('invalid_testcase_upload');
    for (const expectedRevision of ['0', '-1', '1.2', '9007199254740993']) {
      const invalid = await request(a).post(base).field('expectedRevision', expectedRevision).attach('input', Buffer.from('x'), '1.in');
      expect(invalid.status).toBe(400); expect(invalid.body.code).toBe('invalid_request');
    }
    expect((await cases()).rows).toEqual([]); expect((await stored()).rows[0].revision).toBe(1);
  });

  it('preserves BOM and empty outputs and rejects mixed uploads without durable changes', async () => {
    const a = app();
    const valid = await request(a).post(base).field('expectedRevision', '1')
      .attach('input', Buffer.from('\ufeffa\r\n'), '1.in').attach('output', Buffer.alloc(0), '1.out');
    expect(valid.status).toBe(201);
    expect((await cases()).rows[0]).toEqual(expect.objectContaining({ input_data: '\ufeffa\r\n', output_data: '' }));
    const mixed = await request(a).post(base).field('expectedRevision', '2')
      .attach('input', Buffer.from('x'), '2.in').attach('archive', Buffer.from('not a zip'), 'cases.zip');
    expect(mixed.status).toBe(400); expect(mixed.body.code).toBe('invalid_testcase_upload');
    expect((await stored()).rows[0].revision).toBe(2);
  });
});
