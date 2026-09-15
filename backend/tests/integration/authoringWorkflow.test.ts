import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import draftRoutes from '../../controllers/authoringDraftController';
import testcaseRoutes from '../../controllers/authoringTestcaseController';
import workspaceRoutes from '../../controllers/authoringWorkspaceController';
import { createAuthoringJobRouter } from '../../controllers/authoringJobController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl && process.env.INTEGRATION_RUNNER_SPOOL ? describe : describe.skip)('complete authoring HTTP workflow with isolated C++/PDF worker', () => {
  const schema = `slice10_workflow_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'disposable-workflow', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
  app.use(draftRoutes); app.use(testcaseRoutes); app.use(workspaceRoutes); app.use(createAuthoringJobRouter(true)); app.use(errorHandler);
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool);
    await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES(1,'fixture-admin','unused','admin')");
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('creates, saves, generates seed-based inputs/outputs, previews, builds PDF, verifies and publishes hidden', async () => {
    const created = await request(app).post('/admin/authoring/drafts').send({ problemId: 'workflow-sum', title: 'Workflow sum',
      authorAkaName: 'Writer', authorRealName: 'Fixture Writer', language: 'Thai', countryCode: 'THA', timeLimitMs: 1000, memoryLimitMb: 256 });
    expect(created.status).toBe(201);
    const base = `/admin/authoring/drafts/${created.body.id}`;
    const saved = await request(app).patch(base).send({ expectedRevision: 1,
      statementHtml: '<h1>ผลบวก $a+b$</h1><p>Find the sum.</p><table><tr><td>1 2</td><td>3</td></tr></table>',
      solutionCpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
      generatorCpp: '#include <fstream>\n#include <cstdlib>\nint main(int argc,char** argv){if(argc!=2)return 1;long long n=std::atoll(argv[1]);std::ofstream("input/input01.txt")<<n<<" 2\\n";std::ofstream("input/input02.txt")<<"0 0\\n";}',
    });
    expect(saved.status).toBe(200); expect(saved.body.revision).toBe(2);
    const preview = await request(app).post(`${base}/preview`).send({ statementHtml: saved.body.statementHtml });
    expect(preview.status).toBe(200); expect(preview.body.html.includes('class="katex"')).toBe(true);
    expect(preview.body.html.includes('<script')).toBe(false);
    const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!); await shared.initialize();
    async function run(action: string, extra = {}) {
      const d = (await request(app).get(base)).body;
      const queued = await request(app).post(`${base}/jobs/${action}`).send({ expectedRevision: d.revision, ...extra });
      expect(queued.status).toBe(202);
      const deadline = Date.now() + 75000; let result;
      do {
        await reconcileAuthoringJobs(shared, database);
        result = (await request(app).get(`/admin/authoring/jobs/${queued.body.id}`)).body;
        if (!['queued', 'compiling', 'running'].includes(result.status)) break;
        await delay(100);
      } while (Date.now() < deadline);
      expect({ status: result.status, code: result.errorCode, log: result.log }).toEqual({ status: 'succeeded', code: null, log: expect.any(String) });
    }
    await run('generate', { seed: '12345' });
    let cases = (await request(app).get(`${base}/testcases`)).body.testcases;
    expect(cases.map((c: { hasOutput: boolean }) => c.hasOutput)).toEqual([false, false]);
    await run('outputs');
    cases = (await request(app).get(`${base}/testcases`)).body.testcases;
    expect(cases.map((c: { hasOutput: boolean }) => c.hasOutput)).toEqual([true, true]);
    expect((await request(app).get(`${base}/testcases/${cases[0].id}`)).body.output).toBe('12347\n');
    await run('pdf'); await run('verify');
    const ready = (await request(app).get(base)).body;
    expect(ready.status).toBe('ready'); expect(ready.verifiedRevision).toBe(ready.revision);
    expect((await request(app).get(`${base}/jobs`)).body.map((j: { jobType: string }) => j.jobType))
      .toEqual(['verify_all', 'build_pdf', 'generate_outputs', 'run_generator']);
    expect((await request(app).get(`${base}/pdf`)).headers['content-type']).toBe('application/pdf');
    const published = await request(app).post(`${base}/publish`).send({ expectedRevision: ready.revision });
    expect(published.status).toBe(201); expect(published.body.isVisible).toBe(false);
    expect((await request(app).get(base)).body.status).toBe('published');
    const problem = (await pool.query("SELECT * FROM problems WHERE id='workflow-sum'")).rows[0];
    expect(problem.is_visible).toBe(false); expect(problem.problem_pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await pool.query("SELECT output_data FROM testcases WHERE problem_id='workflow-sum' ORDER BY case_number")).rows)
      .toEqual([{ output_data: '12347\n' }, { output_data: '0\n' }]);
  }, 180000);
});
