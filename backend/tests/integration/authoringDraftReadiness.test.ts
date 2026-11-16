import { randomUUID } from 'node:crypto';
import pg, { QueryResultRow } from 'pg';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { AuthoringDraftDatabase, listProblemDrafts } from '../../services/authoringDraftQueryService';

jest.unmock('pg');
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('authoring draft list readiness (B7)', () => {
  const schema = `adr_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  let queries = 0;
  const database: AuthoringDraftDatabase = {
    query: async <T extends QueryResultRow>(text: string, params?: unknown[]) => {
      queries += 1;
      const result = await pool.query<T>(text, params);
      return { rows: result.rows };
    },
  };

  const draft = async (id: string, problemId: string, extra: Record<string, unknown> = {}) => {
    const cols = { statement_html: '', solution_cpp: '', generator_cpp: null, latest_pdf_revision: null, revision: 3, verified_revision: null, status: 'draft', author_aka_name: 'Ada', ...extra };
    await pool.query(
      `INSERT INTO problem_drafts (id, problem_id, title, author_aka_name, author_real_name, language, country_code, time_limit_ms, memory_limit_mb,
         statement_html, solution_cpp, generator_cpp, latest_pdf_revision, revision, verified_revision, status)
       VALUES ($1, $2, $2, $3, 'Real', 'Thai', 'THA', 1000, 256, $4, $5, $6, $7, $8, $9, $10)`,
      [id, problemId, cols.author_aka_name, cols.statement_html, cols.solution_cpp, cols.generator_cpp, cols.latest_pdf_revision, cols.revision, cols.verified_revision, cols.status],
    );
  };
  const job = (draftId: string, type: string, status: string, revision: number, minutesAgo: number) => pool.query(
    `INSERT INTO authoring_jobs (id, draft_id, job_type, draft_revision, status, created_at) VALUES ($1, $2, $3, $4, $5, NOW() - ($6 || ' minutes')::interval)`,
    [randomUUID(), draftId, type, revision, status, String(minutesAgo)],
  );
  const testcase = (draftId: string, n: number, output: string | null) => pool.query(
    `INSERT INTO problem_draft_testcases (id, draft_id, case_number, original_input_filename, input_data, output_data, source, source_revision)
     VALUES ($1, $2, $3, $4, '1', $5, 'uploaded', 1)`,
    [randomUUID(), draftId, n, `${n}.in`, output],
  );

  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts, author_profiles CASCADE');
    await draft(A, 'bare');
    await draft(B, 'full', {
      statement_html: '<p>x</p>', solution_cpp: 'int main(){}', generator_cpp: 'int main(){}', latest_pdf_revision: 2, verified_revision: 2, status: 'generated',
    });
    await draft(C, 'busy', { solution_cpp: 'int main(){}', author_aka_name: 'kru' });
    await testcase(B, 1, '3');
    await testcase(B, 2, null);
    await testcase(B, 3, '7');
    await job(B, 'compile_solution', 'failed', 2, 30);
    await job(B, 'compile_solution', 'succeeded', 3, 5);
    await job(B, 'verify_all', 'succeeded', 2, 20);
    await job(C, 'build_pdf', 'running', 3, 1);
    queries = 0;
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const byId = async (options = {}) => Object.fromEntries((await listProblemDrafts(options, database)).map((d) => [d.id, d]));

  it('a bare draft has no statement, solution, generator, testcases, pdf or jobs', async () => {
    const rows = await byId();
    expect(rows[A].readiness).toEqual({
      has_statement: false, has_solution: false, has_generator: false,
      testcase_total: 0, testcase_with_output: 0, latest_pdf_revision: null, latest_jobs: {}, active_job: false,
    });
  });

  it('testcase counts split total and with-output', async () => {
    const rows = await byId();
    expect(rows[B].readiness).toMatchObject({ has_statement: true, has_solution: true, has_generator: true, testcase_total: 3, testcase_with_output: 2, latest_pdf_revision: 2 });
  });

  it('latestJobs keeps only the newest job per type', async () => {
    const rows = await byId();
    expect(rows[B].readiness.latest_jobs).toEqual({
      compile_solution: { status: 'succeeded', revision: 3 },
      verify_all: { status: 'succeeded', revision: 2 },
    });
  });

  it('activeJob is true while a job is queued or running', async () => {
    const rows = await byId();
    expect(rows[C].readiness.active_job).toBe(true);
    expect(rows[B].readiness.active_job).toBe(false);
  });

  it('the list stays one query (no per-row lookups)', async () => {
    await listProblemDrafts({}, database);
    expect(queries).toBe(1);
  });

  it('mine filter still applies with readiness', async () => {
    const rows = await listProblemDrafts({ scope: 'mine', username: 'kru' }, database);
    expect(rows.map((r) => r.id)).toEqual([C]);
    expect(rows[0].readiness.active_job).toBe(true);
  });
});
