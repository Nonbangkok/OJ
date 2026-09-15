import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { Parser } from 'htmlparser2';
import * as db from '../db';
import router from '../controllers/authoringWorkspaceController';
import { errorHandler } from '../middleware/errorHandler';

const id = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1cAAAAASUVORK5CYII=', 'base64');
const draft = { id, problem_id: 'task<&', title: '</title><script>badTitle()</script>',
  author_aka_name: 'AKA <b>name</b>', author_real_name: 'Author <img src=x>',
  language: 'Thai', country_code: 'THA', author_profile_image_png: png,
  template_version: 'red-gate-v1', statement_html: 'SAVED OLD CONTENT',
  solution_cpp: 'PRIVATE SOLUTION', generator_cpp: 'PRIVATE GENERATOR' };
const asset = { id: assetId, draft_id: id, filename: 'diagram.png', mime_type: 'image/png', content: png };
const databaseQuery = db.pool.query as jest.Mock;
const app = (role?: string) => {
  const a = express(); a.use(express.json({ limit: '3mb' }));
  a.use(session({ secret: 'workspace-test', resave: false, saveUninitialized: false }));
  a.use((req, _res, next) => { if (role) { req.session.role = role; req.session.userId = 1; } next(); });
  a.use(router); a.use(errorHandler); return a;
};
const preview = (statementHtml: string) => request(app('admin')).post(`/admin/authoring/drafts/${id}/preview`).send({ statementHtml });

beforeEach(() => {
  databaseQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM problem_drafts')) return { rows: [draft] };
    if (sql.includes('FROM problem_draft_assets')) return { rows: [asset] };
    if (sql.includes('FROM authoring_jobs')) return { rows: [] };
    throw new Error(`Unexpected database write/query: ${sql}`);
  });
});

it('requires authenticated admin access for previews, private images and job history', async () => {
  for (const [role, status] of [[undefined, 401], ['staff', 403], ['user', 403]] as const) {
    expect((await request(app(role)).post(`/admin/authoring/drafts/${id}/preview`).send({ statementHtml: '' })).status).toBe(status);
    expect((await request(app(role)).get(`/admin/authoring/drafts/${id}/jobs`)).status).toBe(status);
    expect((await request(app(role)).get(`/admin/authoring/drafts/${id}/assets/${assetId}`)).status).toBe(status);
  }
  expect(databaseQuery).not.toHaveBeenCalled();
});

it('validates IDs and accepts only a bounded explicit statementHtml field', async () => {
  for (const body of [{}, { statementHtml: 1 }, { statementHtml: '', expectedRevision: 1 }, { statementHtml: 'ก'.repeat(700_000) }]) {
    expect((await request(app('admin')).post(`/admin/authoring/drafts/${id}/preview`).send(body)).status).toBe(400);
  }
  expect((await request(app('admin')).post('/admin/authoring/drafts/no/preview').send({ statementHtml: '' })).status).toBe(400);
  expect((await request(app('admin')).get('/admin/authoring/drafts/no/jobs')).status).toBe(400);
  expect((await request(app('admin')).get(`/admin/authoring/drafts/${id}/assets/no`)).status).toBe(400);
  expect(databaseQuery).not.toHaveBeenCalled();
});

it('renders unsaved sanitized content with escaped metadata and embedded assets without private sources or writes', async () => {
  const response = await preview('<h1>UNSAVED $x^2$</h1><img src="{{ASSET_BASE}}/diagram.png">');
  expect(response.status).toBe(200);
  const html = response.body.html;
  expect(html).toContain('<h1>UNSAVED <span class="katex">');
  expect(html).toContain('AKA &lt;b&gt;name&lt;/b&gt;');
  expect(html).toContain('Author &lt;img src=x&gt;');
  expect(html).toContain('&lt;/title&gt;&lt;script&gt;badTitle()&lt;/script&gt;');
  expect(html).toContain(`src="data:image/png;base64,${png.toString('base64')}"`);
  for (const privateText of ['PRIVATE SOLUTION', 'PRIVATE GENERATOR', 'SAVED OLD CONTENT', '{{ASSET_BASE}}', 'file:///']) {
    expect(html).not.toContain(privateText);
  }
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(databaseQuery.mock.calls.every(([sql]) => /^\s*SELECT\b/i.test(sql))).toBe(true);
});

it('renders vendored KaTeX on the server with embedded fonts and a script-free self-contained CSP', async () => {
  const response = await preview('<p>Equation $x^2$</p>');
  expect(response.status).toBe(200);
  const html: string = response.body.html;
  let csp = '';
  const parser = new Parser({
    onopentag(tag, attributes) {
      expect(tag).not.toBe('script');
      if (tag === 'meta' && attributes['http-equiv'] === 'Content-Security-Policy') csp = attributes.content!;
      for (const name of ['src', 'href']) if (attributes[name]) expect(attributes[name]).toMatch(/^data:/);
    },
  });
  parser.end(html);
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain('img-src data:'); expect(csp).toContain('font-src data:');
  expect(csp).toContain("base-uri 'none'"); expect(csp).toContain("form-action 'none'");
  expect(csp).toContain("script-src 'none'");
  expect(html).toMatch(/url\(['"]?data:font\//);
  expect(html).toContain('class="katex"'); expect(html).toContain('<msup>');
});

it('renders all four delimiters while retaining literal code and escaped prose', async () => {
  const response = await preview('<p>$a^2$ $$b^2$$ \\(c^2\\) \\[d^2\\] &lt;literal&gt;</p><pre>$code$</pre><code>\\(literal\\)</code>');
  expect(response.status).toBe(200);
  expect(response.body.html.match(/class="katex"/g)).toHaveLength(4);
  expect(response.body.html.match(/class="katex-display"/g)).toHaveLength(2);
  expect(response.body.html).toContain('<pre>$code$</pre>');
  expect(response.body.html).toContain('<code>\\(literal\\)</code>');
  expect(response.body.html).toContain('&lt;literal&gt;');
});

it.each(['$\\badCommand{x}$', '$\\href{https://example.org}{click}$', '$\\includegraphics{https://example.org/a.png}$'])('rejects invalid or unsafe math: %s', async html => {
  const response = await preview(html);
  expect(response.status).toBe(400); expect(response.body.code).toBe('invalid_math');
});

it.each([
  ['<script>alert(1)</script>', 'UNSAFE_STATEMENT'],
  ['<img src="{{ASSET_BASE}}/diagram.png" onerror="alert(1)">', 'UNSAFE_STATEMENT'],
  ['<iframe src="https://example.com"></iframe>', 'UNSAFE_STATEMENT'],
  ['<img src="https://example.com/a.png">', 'INVALID_STATEMENT_ASSET'],
  ['<img src="{{ASSET_BASE}}/missing.png">', 'INVALID_STATEMENT_ASSET'],
])('rejects unsafe or missing asset input: %s', async (html, code) => {
  const response = await preview(html); expect(response.status).toBe(400); expect(response.body.code).toBe(code);
});

it('rejects unsupported templates and missing drafts without creating jobs', async () => {
  databaseQuery.mockResolvedValueOnce({ rows: [{ ...draft, template_version: 'future' }] });
  expect((await preview('')).body.code).toBe('unsupported_template');
  databaseQuery.mockResolvedValue({ rows: [] });
  expect((await preview('')).status).toBe(404);
  expect((await request(app('admin')).get(`/admin/authoring/drafts/${id}/jobs`)).status).toBe(404);
});

it('returns private stored raster bytes, rejects missing assets, and never serves an arbitrary content type', async () => {
  const url = `/admin/authoring/drafts/${id}/assets/${assetId}`;
  const response = await request(app('admin')).get(url);
  expect(response.status).toBe(200); expect(response.body).toEqual(png);
  expect(response.headers['content-type']).toBe('image/png');
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  databaseQuery.mockResolvedValueOnce({ rows: [] });
  expect((await request(app('admin')).get(url)).status).toBe(404);
  databaseQuery.mockResolvedValueOnce({ rows: [{ ...asset, mime_type: 'text/html' }] });
  expect((await request(app('admin')).get(url)).status).toBe(400);
});

it('projects bounded job-list metadata without reports, logs or private snapshots', async () => {
  databaseQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM problem_drafts')) return { rows: [draft] };
    return { rows: [{ id: assetId, draft_id: id, draft_revision: 3, job_type: 'verify_all', status: 'failed',
      result_summary: { durationMs: 20 }, error_code: 'compile_error', error_message: 'Compilation failed',
      created_at: '2026-09-15T00:00:00.000Z', started_at: null, finished_at: null,
      log: 'PRIVATE LOG', request_snapshot: { source: 'PRIVATE SOURCE' } }] };
  });
  const response = await request(app('admin')).get(`/admin/authoring/drafts/${id}/jobs`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual([{ id: assetId, draftId: id, draftRevision: 3, jobType: 'verify_all', status: 'failed',
    errorCode: 'compile_error', errorMessage: 'Compilation failed', createdAt: '2026-09-15T00:00:00.000Z',
    startedAt: null, finishedAt: null }]);
  const [sql, values] = databaseQuery.mock.calls.find(([sql]) => sql.includes('FROM authoring_jobs'))!;
  expect(sql).toMatch(/ORDER BY created_at DESC,\s*id DESC\s+LIMIT 100/);
  expect(sql).not.toMatch(/SELECT\s+\*|request_snapshot|result_summary|\blog\b/);
  expect(values).toEqual([id]);
});
