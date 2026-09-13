import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import pg from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import * as db from '../../db';
import authorProfiles from '../../controllers/authorProfileController';
import authoringDrafts from '../../controllers/authoringDraftController';
import { STATEMENT_ASSET } from '../../constants';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createFallbackAuthorAvatar } from '../../services/authorProfileImageService';

jest.unmock('pg');
// Only redirect the application's database transport. Controllers, validation,
// image decoding, query services, and PostgreSQL transactions all run for real.
jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { query: jest.fn(), connect: jest.fn() },
}));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('author profiles and statement assets through HTTP and PostgreSQL', () => {
  const schema = `slice3_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'slice3-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.userId = 1;
    req.session.role = 'admin';
    next();
  });
  app.use(authorProfiles);
  app.use(authoringDrafts);
  app.use(errorHandler);

  let image: Buffer;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
    image = await sharp({
      create: { width: 24, height: 12, channels: 3, background: '#3467ab' },
    }).jpeg().toBuffer();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE users, author_profiles, problem_drafts RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ('slice3-admin', 'test-only', 'admin')");
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });

  afterAll(async () => {
    await pool.end();
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await adminPool.end();
    }
  });

  const createProfile = async () => {
    const response = await request(app).post('/admin/author-profiles')
      .field('akaName', 'Original Author').field('realName', 'Example Author')
      .field('defaultLanguage', 'Thai').field('countryCode', 'THA')
      .attach('profileImage', image, { filename: 'profile.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(201);
    return response.body.id as string;
  };

  const createDraft = async (profileId: string | null = null) => {
    const response = await request(app).post('/admin/authoring/drafts').send({
      problemId: 'slice3', title: 'Slice 3 fixture', authorProfileId: profileId,
      authorAkaName: 'Manual Author', authorRealName: 'Manual Name',
      language: 'Thai', countryCode: 'THA', timeLimitMs: 1000, memoryLimitMb: 256,
    });
    expect(response.status).toBe(201);
    return response.body.id as string;
  };

  const upload = (draftId: string, revision: number, filename = 'diagram.jpg') =>
    request(app).post(`/admin/authoring/drafts/${draftId}/assets`)
      .field('expectedRevision', String(revision))
      .attach('asset', image, { filename, contentType: 'image/jpeg' });

  const storedDraft = async (id: string) =>
    (await pool.query('SELECT * FROM problem_drafts WHERE id = $1', [id])).rows[0];

  it('normalizes profile images and freezes snapshots until explicit refresh', async () => {
    const profileId = await createProfile();
    const draftId = await createDraft(profileId);
    const original = await storedDraft(draftId);
    expect(original.author_aka_name).toBe('Original Author');
    expect(await sharp(original.author_profile_image_png).metadata())
      .toEqual(expect.objectContaining({ format: 'png', width: 512, height: 512 }));

    const changed = await request(app).patch(`/admin/author-profiles/${profileId}`)
      .send({ akaName: 'Updated Author', removeProfileImage: true });
    expect(changed.status).toBe(200);
    expect(changed.body.hasProfileImage).toBe(false);
    expect(await storedDraft(draftId)).toEqual(original);

    const refresh = await request(app)
      .post(`/admin/authoring/drafts/${draftId}/refresh-author-profile`)
      .send({ expectedRevision: 1 });
    expect(refresh.status).toBe(200);
    expect(refresh.body).toEqual(expect.objectContaining({ revision: 2, authorAkaName: 'Updated Author' }));
    expect((await storedDraft(draftId)).author_profile_image_png)
      .toEqual(await createFallbackAuthorAvatar('Updated Author'));
    expect(refresh.body.authorProfileImagePng).toBeUndefined();

    const stale = await request(app)
      .post(`/admin/authoring/drafts/${draftId}/refresh-author-profile`)
      .send({ expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.currentRevision).toBe(2);
  });

  it('persists fallback avatars for manual authors and enforces unique account links', async () => {
    const draftId = await createDraft();
    expect((await storedDraft(draftId)).author_profile_image_png)
      .toEqual(await createFallbackAuthorAvatar('Manual Author'));
    const body = { userId: 1, akaName: 'A', realName: 'Author', defaultLanguage: 'Thai', countryCode: 'THA' };
    expect((await request(app).post('/admin/author-profiles').send(body)).status).toBe(201);
    const duplicate = await request(app).post('/admin/author-profiles').send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('author_profile_user_conflict');
    const profiles = await request(app).get('/admin/author-profiles');
    expect(profiles.body).toHaveLength(1);
    expect(profiles.body[0].profile_image_png).toBeUndefined();
  });

  it('stores normalized asset bytes and checksum, lists metadata, and deletes atomically', async () => {
    const draftId = await createDraft();
    const empty = await request(app).get(`/admin/authoring/drafts/${draftId}/assets`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
    const added = await upload(draftId, 1);
    expect(added.status).toBe(201);
    expect(added.body.draftRevision).toBe(2);
    const stored = (await pool.query('SELECT * FROM problem_draft_assets WHERE draft_id = $1', [draftId])).rows[0];
    expect(stored.content).toBeInstanceOf(Buffer);
    expect(Number(stored.size_bytes)).toBe(stored.content.length);
    expect(stored.checksum_sha256).toBe(createHash('sha256').update(stored.content).digest('hex'));
    const list = await request(app).get(`/admin/authoring/drafts/${draftId}/assets`);
    expect(list.body).toEqual([added.body.asset]);
    expect(list.body[0].content).toBeUndefined();
    const deleted = await request(app).delete(`/admin/authoring/drafts/${draftId}/assets/${stored.id}`)
      .query({ expectedRevision: 2 });
    expect(deleted.status).toBe(200);
    expect(deleted.body.draftRevision).toBe(3);
    expect((await pool.query('SELECT id FROM problem_draft_assets WHERE draft_id = $1', [draftId])).rows).toEqual([]);
  });

  it('rolls back duplicate uploads and cross-draft deletions without losing readiness', async () => {
    const draftId = await createDraft();
    const added = await upload(draftId, 1);
    expect(added.status).toBe(201);
    await pool.query("UPDATE problem_drafts SET status = 'ready', verified_revision = revision WHERE id = $1", [draftId]);
    const before = await storedDraft(draftId);
    const duplicate = await upload(draftId, 2);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('asset_filename_conflict');
    expect(await storedDraft(draftId)).toEqual(before);

    const otherId = await createDraft();
    const crossDraft = await request(app)
      .delete(`/admin/authoring/drafts/${otherId}/assets/${added.body.asset.id}`)
      .query({ expectedRevision: 1 });
    expect(crossDraft.status).toBe(404);
    expect((await storedDraft(otherId)).revision).toBe(1);
    expect((await pool.query('SELECT id FROM problem_draft_assets WHERE id = $1', [added.body.asset.id])).rowCount).toBe(1);
    const success = await upload(draftId, 2, 'second.jpg');
    expect(success.status).toBe(201);
    expect(await storedDraft(draftId)).toEqual(expect.objectContaining({ revision: 3, status: 'draft', verified_revision: null }));
  });

  it('allows only one simultaneous asset upload at the same revision', async () => {
    const draftId = await createDraft();
    const results = await Promise.all([upload(draftId, 1, 'one.jpg'), upload(draftId, 1, 'two.jpg')]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(results.find(({ status }) => status === 409)?.body.currentRevision).toBe(2);
    expect((await storedDraft(draftId)).revision).toBe(2);
    expect((await pool.query('SELECT id FROM problem_draft_assets WHERE draft_id = $1', [draftId])).rowCount).toBe(1);
  });

  it('rejects the aggregate limit and preserves the entire draft on rollback', async () => {
    const draftId = await createDraft();
    // Seed real BYTEA data at the limit without repeatedly decoding 100 MiB of images.
    await pool.query(`
      INSERT INTO problem_draft_assets (id, draft_id, filename, mime_type, content, checksum_sha256, size_bytes)
      SELECT md5('fixture-' || n)::uuid, $1, 'fixture-' || n || '.png', 'image/png',
             repeat('x', $2)::bytea, repeat('0', 64), $2
      FROM generate_series(1, $3) n
    `, [draftId, STATEMENT_ASSET.MAX_FILE_BYTES, STATEMENT_ASSET.MAX_TOTAL_BYTES / STATEMENT_ASSET.MAX_FILE_BYTES]);
    const before = await storedDraft(draftId);
    const rejected = await upload(draftId, 1);
    expect(rejected.status).toBe(413);
    expect(rejected.body.code).toBe('asset_total_size_exceeded');
    expect(await storedDraft(draftId)).toEqual(before);
    const total = await pool.query('SELECT SUM(size_bytes)::text AS total FROM problem_draft_assets WHERE draft_id = $1', [draftId]);
    expect(Number(total.rows[0].total)).toBe(STATEMENT_ASSET.MAX_TOTAL_BYTES);
  });

  it('rejects asset mutations and profile refreshes on published drafts', async () => {
    const draftId = await createDraft(await createProfile());
    const added = await upload(draftId, 1);
    expect(added.status).toBe(201);
    await pool.query("UPDATE problem_drafts SET status = 'published', published_at = NOW() WHERE id = $1", [draftId]);
    const before = await storedDraft(draftId);
    const results = [
      await upload(draftId, 2, 'second.jpg'),
      await request(app).delete(`/admin/authoring/drafts/${draftId}/assets/${added.body.asset.id}`).query({ expectedRevision: 2 }),
      await request(app).post(`/admin/authoring/drafts/${draftId}/refresh-author-profile`).send({ expectedRevision: 2 }),
    ];
    for (const result of results) {
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('draft_published');
    }
    expect(await storedDraft(draftId)).toEqual(before);
  });

  it('rejects invalid content without storing assets or advancing revision', async () => {
    const draftId = await createDraft();
    const before = await storedDraft(draftId);
    const invalid = await request(app).post(`/admin/authoring/drafts/${draftId}/assets`)
      .field('expectedRevision', '1').attach('asset', image, { filename: 'false.png', contentType: 'image/png' });
    expect(invalid.status).toBe(400);
    expect(await storedDraft(draftId)).toEqual(before);
    expect((await pool.query('SELECT id FROM problem_draft_assets WHERE draft_id = $1', [draftId])).rows).toEqual([]);
    const missing = await request(app).get(`/admin/authoring/drafts/${randomUUID()}/assets`);
    expect(missing.status).toBe(404);
  });
});
