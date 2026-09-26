import { readFileSync } from 'node:fs';
import { createContext, Script, Context } from 'node:vm';
import { Parser } from 'htmlparser2';
import path from 'node:path';
import * as db from '../db';
import { buildPdfHtml, PDF_TEMPLATE_DIRECTORY, PDF_TEMPLATE_VERSION, taskCodeFromDraft } from '../authoring/pdfTemplate';
import { compileStatementSource } from '../authoring/statementCompiler';
import { StatementError } from '../authoring/statementSanitizer';
import { AuthoringJobRow, ProblemDraftAssetRow, ProblemDraftRow } from '../types/authoring';
import { createFallbackAuthorAvatar } from './authorProfileImageService';

type Database = Pick<typeof db, 'query'>;
type PreviewDraft = Pick<ProblemDraftRow, 'id' | 'problem_id' | 'title' | 'author_aka_name'
  | 'author_real_name' | 'language' | 'country_code' | 'author_profile_image_png' | 'template_version'>;
type RasterAsset = Pick<ProblemDraftAssetRow, 'filename' | 'mime_type' | 'content'>;
type JobListRow = Pick<AuthoringJobRow, 'id' | 'draft_id' | 'draft_revision' | 'job_type' | 'status'
  | 'error_code' | 'error_message' | 'created_at' | 'started_at' | 'finished_at'>;
const MAX_EMBEDDED_IMAGE_BYTES = 16 * 1024 * 1024;
const templateUrl = 'file:///preview-bundle';
const avatarUrl = 'file:///preview-avatar.png';

/** History is independent of the runner spool and omits logs and immutable source snapshots. */
export async function listWorkspaceJobs(id: string, database: Database = db) {
  if (!(await database.query('SELECT 1 FROM problem_drafts WHERE id=$1', [id])).rows[0]) return null;
  const jobs = (await database.query<JobListRow>(`SELECT id,draft_id,draft_revision,job_type,status,
    error_code,error_message,created_at,started_at,finished_at
    FROM authoring_jobs WHERE draft_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100`, [id])).rows;
  return jobs.map(job => ({ id: job.id, draftId: job.draft_id, draftRevision: job.draft_revision,
    jobType: job.job_type, status: job.status, errorCode: job.error_code, errorMessage: job.error_message,
    createdAt: job.created_at, startedAt: job.started_at, finishedAt: job.finished_at }));
}

function assertRaster(asset: RasterAsset): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime_type)) {
    throw new StatementError('INVALID_STATEMENT_ASSET', 'Stored asset must be a normalized raster image');
  }
}

export async function getWorkspaceAsset(id: string, assetId: string, database: Database = db) {
  const asset = (await database.query<RasterAsset>(`SELECT filename,mime_type,content
    FROM problem_draft_assets WHERE draft_id=$1 AND id=$2`, [id, assetId])).rows[0];
  if (!asset) return null;
  assertRaster(asset);
  return asset;
}

let bundledResources: { css: string; script: string; fonts: Map<string, string> } | undefined;
function resources() {
  if (bundledResources) return bundledResources;
  const fonts = new Map<string, string>();
  const readFont = (relative: string) => {
    if (!/^(?:vendor\/)?fonts\/[A-Za-z0-9_,.-]+\.(?:ttf|woff2?)$/.test(relative)) throw new Error('Invalid bundled font path');
    const extension = path.extname(relative).slice(1);
    const url = `data:font/${extension};base64,${readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, relative)).toString('base64')}`;
    fonts.set(relative, url); return url;
  };
  const css = readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor/katex.css'), 'utf8')
    .replace(/url\((fonts\/[^)]+)\)/g, (_match, relative: string) => `url('${readFont(`vendor/${relative}`)}')`);
  for (const font of ['Sarabun-Regular.ttf', 'Sarabun-Medium.ttf', 'Sarabun-Bold.ttf', 'Inconsolata-VariableFont_wdth,wght.ttf']) {
    readFont(`fonts/${font}`);
  }
  const script = readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor/bundle.js'), 'utf8');
  if (/<\/script/i.test(script)) throw new Error('Bundled script cannot be embedded safely');
  bundledResources = { css, script, fonts }; return bundledResources;
}

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
let mathContext: Context | undefined;
const renderMath = new Script(`require('katex').renderToString(tex, {displayMode: display, strict: 'error',
  throwOnError: true, trust: function(){throw new Error('Untrusted math command');}, maxExpand: 1000, maxSize: 100})`);
/** The VM runs only our pinned vendor code, never author JavaScript. TeX is supplied as data. */
function renderStatementMath(html: string): string {
  if (!mathContext) {
    mathContext = createContext({});
    new Script(resources().script).runInContext(mathContext, { timeout: 1000 });
  }
  const deadline = Date.now() + 1000;
  let count = 0; let bytes = 0; let pending = ''; let skipped = 0;
  const result: string[] = [];
  const append = (part: string) => {
    bytes += Buffer.byteLength(part);
    if (bytes > 16 * 1024 * 1024) throw new StatementError('preview_too_large', 'Rendered preview exceeds 16 MiB');
    result.push(part);
  };
  const text = (value: string) => {
    if (skipped) { append(escapeHtml(value)); return; }
    let offset = 0;
    const opening = /\$\$|\\\[|\\\(|\$/g;
    for (let match; (match = opening.exec(value));) {
      const left = match[0]; const right = left === '\\[' ? '\\]' : left === '\\(' ? '\\)' : left;
      const start = match.index + left.length;
      let end = start; let braces = 0;
      for (; end < value.length; end++) {
        if (braces <= 0 && value.startsWith(right, end)) break;
        if (value[end] === '\\') { end++; continue; }
        if (value[end] === '{') braces++;
        if (value[end] === '}') braces--;
      }
      if (end >= value.length) break;
      append(escapeHtml(value.slice(offset, match.index)));
      if (++count > 1000 || Date.now() >= deadline) throw new StatementError('preview_too_large', 'Math preview exceeds its rendering budget');
      mathContext!.tex = value.slice(start, end); mathContext!.display = left === '$$' || left === '\\[';
      try { append(renderMath.runInContext(mathContext!, { timeout: Math.max(1, deadline - Date.now()) })); }
      catch { throw new StatementError('invalid_math', 'Invalid, unsafe or overly complex LaTeX in statement'); }
      offset = end + right.length; opening.lastIndex = offset;
    }
    append(escapeHtml(value.slice(offset)));
  };
  const flush = () => { if (pending) { text(pending); pending = ''; } };
  const parser = new Parser({
    onopentag(tag, attributes) {
      flush(); append(`<${tag}${Object.entries(attributes).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')}>`);
      if (tag === 'pre' || tag === 'code') skipped++;
    },
    ontext(value) { pending += value; },
    onclosetag(tag) { flush(); if (!['br', 'hr', 'img'].includes(tag)) append(`</${tag}>`);
      if (tag === 'pre' || tag === 'code') skipped--; },
  }, { decodeEntities: true });
  parser.end(html); flush(); return result.join('');
}

/** Read-only browser preview: only the statement is unsaved; header and images use stored draft data. */
export async function previewWorkspaceStatement(id: string, statementHtml: string, database: Database = db): Promise<string | null> {
  const draft = (await database.query<PreviewDraft>(`SELECT id,problem_id,title,author_aka_name,
    author_real_name,language,country_code,author_profile_image_png,template_version
    FROM problem_drafts WHERE id=$1`, [id])).rows[0];
  if (!draft) return null;
  if (draft.template_version !== PDF_TEMPLATE_VERSION) throw new StatementError('unsupported_template', 'This template version is not supported');
  const names = (await database.query<{ filename: string }>('SELECT filename FROM problem_draft_assets WHERE draft_id=$1', [id])).rows;
  let statement = compileStatementSource(statementHtml, names.map(asset => asset.filename));
  statement = renderStatementMath(statement);
  const references = [...statement.matchAll(/ src="\{\{ASSET_BASE\}\}\/([A-Za-z0-9._-]+)"/g)];
  const assets = references.length ? (await database.query<RasterAsset>(`SELECT filename,mime_type,content
    FROM problem_draft_assets WHERE draft_id=$1 AND filename=ANY($2::text[])`, [id, [...new Set(references.map(match => match[1]!))]])).rows : [];
  const byName = new Map(assets.map(asset => [asset.filename, asset]));
  let imageBytes = 0;
  // Count repeated references before expanding them, keeping unsaved preview output bounded.
  for (const reference of references) {
    const asset = byName.get(reference[1]!);
    if (!asset) throw new StatementError('INVALID_STATEMENT_ASSET', 'A referenced statement asset no longer exists');
    assertRaster(asset);
    imageBytes += 4 * Math.ceil(asset.content.length / 3);
    if (imageBytes > MAX_EMBEDDED_IMAGE_BYTES) throw new StatementError('preview_too_large', 'Browser preview images exceed 16 MiB; use fewer or smaller images, or build the PDF');
  }
  statement = statement.replace(/ src="\{\{ASSET_BASE\}\}\/([A-Za-z0-9._-]+)"/g, (_match, name: string) => {
    const asset = byName.get(name)!;
    return ` src="data:${asset.mime_type};base64,${asset.content.toString('base64')}"`;
  });
  const avatar = draft.author_profile_image_png ?? await createFallbackAuthorAvatar(draft.author_aka_name);
  const bundle = resources();
  // Transform only the trusted shell. Preview has no JavaScript, even when embedded under the app CSP.
  let shell = buildPdfHtml({ templateVersion: draft.template_version, title: draft.title,
    taskCode: taskCodeFromDraft(draft.problem_id, draft.title), akaName: draft.author_aka_name, realName: draft.author_real_name,
    language: draft.language, countryCode: draft.country_code, statementHtml: '' },
  { templateBaseUrl: templateUrl, assetBaseUrl: 'file:///preview-assets', avatarUrl });
  shell = shell.replace(`<link rel="stylesheet" href="${templateUrl}/vendor/katex.css">`, () => `<style>${bundle.css}</style>`)
    .replace(/url\('file:\/\/\/preview-bundle\/(fonts\/[^']+)'\)/g, (_match, relative: string) => {
      const font = bundle.fonts.get(relative); if (!font) throw new Error('Unbundled preview font'); return `url('${font}')`;
    })
    .replace(`src="${avatarUrl}"`, () => `src="data:image/png;base64,${avatar.toString('base64')}"`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  return shell.replace('<meta charset="utf-8">', () => `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<article id="statement" class="statement"></article>', () => `<article id="statement" class="statement">${statement}</article>`);
}
