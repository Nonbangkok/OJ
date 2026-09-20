import pg, { QueryResultRow } from 'pg';
import { runMigrationsFromPool } from '../../scripts/migrate';
import {
  AuthoringDraftDatabase,
  createProblemDraft,
  getProblemDraft,
  listProblemDrafts,
  startProblemDraftRevision,
  updateProblemDraft,
} from '../../services/authoringDraftQueryService';

jest.unmock('pg');

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('problem authoring draft persistence', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl });
  const database: AuthoringDraftDatabase = {
    query: async <T extends QueryResultRow>(text: string, params?: unknown[]) => {
      const result = await pool.query<T>(text, params);
      return { rows: result.rows };
    },
  };

  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrationsFromPool(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const createDraft = () => createProblemDraft({
    problem_id: 'redgate',
    title: 'Red Gate',
    author_profile_id: null,
    author_aka_name: 'Author',
    author_real_name: 'Example Author',
    language: 'Thai',
    country_code: 'THA',
    categories: [],
    time_limit_ms: 1000,
    memory_limit_mb: 256,
    created_by: null,
  }, database);

  it('creates a draft that can be listed and loaded in full', async () => {
    const created = await createDraft();

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toEqual(expect.objectContaining({
      problem_id: 'redgate',
      status: 'draft',
      revision: 1,
      verified_revision: null,
    }));
    await expect(getProblemDraft(created.id, database)).resolves.toEqual(created);
    await expect(listProblemDrafts(database)).resolves.toEqual([
      expect.objectContaining({ id: created.id, problem_id: 'redgate', revision: 1 }),
    ]);
  });

  it('allows only one concurrent update for the same expected revision', async () => {
    const created = await createDraft();

    const results = await Promise.all([
      updateProblemDraft(created.id, 1, { title: 'First edit' }, database),
      updateProblemDraft(created.id, 1, { title: 'Second edit' }, database),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      'revision_conflict',
      'updated',
    ]);
    const current = await getProblemDraft(created.id, database);
    expect(current).toEqual(expect.objectContaining({ revision: 2, status: 'draft' }));
    expect(['First edit', 'Second edit']).toContain(current?.title);
    const conflict = results.find(({ kind }) => kind === 'revision_conflict');
    expect(conflict).toEqual(expect.objectContaining({
      draft: expect.objectContaining({ revision: 2 }),
    }));
  });

  it('does not update a published draft', async () => {
    const created = await createDraft();
    await pool.query(
      "UPDATE problem_drafts SET status = 'published', published_at = NOW() WHERE id = $1",
      [created.id],
    );

    const result = await updateProblemDraft(created.id, 1, { title: 'Forbidden edit' }, database);

    expect(result.kind).toBe('published');
    await expect(getProblemDraft(created.id, database)).resolves.toEqual(expect.objectContaining({
      title: 'Red Gate',
      revision: 1,
      status: 'published',
    }));
  });

  it('starts a new revision on a published draft but keeps the Problem ID locked', async () => {
    const created = await createDraft();
    const publishedAt = new Date();
    await pool.query(
      "UPDATE problem_drafts SET status = 'published', published_at = $2, verified_revision = revision WHERE id = $1",
      [created.id, publishedAt],
    );

    const result = await startProblemDraftRevision(created.id, database);

    expect(result.kind).toBe('updated');
    expect(result.kind === 'updated' && result.draft).toEqual(expect.objectContaining({
      status: 'draft',
      revision: 2,
      verified_revision: null,
      published_at: expect.any(Date),
    }));

    const titleEdit = await updateProblemDraft(created.id, 2, { title: 'Reopened title' }, database);
    expect(titleEdit.kind).toBe('updated');
    const problemIdEdit = await updateProblemDraft(created.id, 3, { problem_id: 'new-problem-id' }, database);
    expect(problemIdEdit.kind).toBe('published_problem_id_locked');
    await expect(getProblemDraft(created.id, database)).resolves.toEqual(expect.objectContaining({
      problem_id: 'redgate',
      title: 'Reopened title',
      status: 'draft',
    }));
  });

  it('refuses to start a new revision on a draft that is not published', async () => {
    const created = await createDraft();

    const result = await startProblemDraftRevision(created.id, database);

    expect(result.kind).toBe('not_published');
    await expect(getProblemDraft(created.id, database)).resolves.toEqual(expect.objectContaining({
      revision: 1,
      status: 'draft',
    }));
  });
});
