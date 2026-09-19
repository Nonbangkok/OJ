import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthoringSpool } from './spool';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, jobSnapshotSchema } from './protocol';
import { buildPdfHtml, PDF_TEMPLATE_DIRECTORY } from './pdfTemplate';
import { sanitizeStatement, StatementError } from './statementSanitizer';
import { runBoundedProcess } from './process';
import { TestcaseError } from './testcases';

/** Renders only a validated, frozen document; no network or private spool is exposed to Qt. */
export async function buildPdf(input: JobSnapshot, workRoot: string, spool: AuthoringSpool,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<JobResult> {
  const job = jobSnapshotSchema.parse(input);
  if (job.kind !== 'build_pdf' && job.kind !== 'sync_pdf') throw new Error('Expected a PDF build job');
  if (Date.parse(job.deadline) <= Date.now()) return failedResult(job, 'job_expired');
  if (options.signal?.aborted) return failedResult(job, 'runner_interrupted');
  const result = failedResult(job, 'pdf_render_error');
  const started = Date.now();
  const cwd = await mkdtemp(path.join(workRoot, 'pdf-'));
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('PDF rendering requires the isolated Linux runner');
    await chmod(cwd, 0o755);
    const assets = path.join(cwd, 'assets'); await mkdir(assets, { mode: 0o755 });
    const output = path.join(cwd, 'output'); await mkdir(output, { mode: 0o777 }); await chmod(output, 0o777);
    const avatarPath = path.join(cwd, 'avatar.png');
    await writeFile(avatarPath, await spool.readPdfInput(job.jobId, job.pdf!.avatar, true), { mode: 0o644 });
    for (const artifact of job.pdf!.assets) await writeFile(path.join(assets, artifact.filename),
      await spool.readPdfInput(job.jobId, artifact), { mode: 0o644 });
    const document = { ...job.pdf!.document,
      statementHtml: sanitizeStatement(job.pdf!.document.statementHtml, job.pdf!.assets.map(a => a.filename)) };
    const html = buildPdfHtml(document, { templateBaseUrl: pathToFileURL(PDF_TEMPLATE_DIRECTORY).href,
      assetBaseUrl: pathToFileURL(assets).href, avatarUrl: pathToFileURL(avatarPath).href });
    const htmlPath = path.join(cwd, 'document.html'); await writeFile(htmlPath, html, { mode: 0o644 });
    const pdfPath = path.join(output, 'document.pdf');
    const remaining = Date.parse(job.deadline) - Date.now();
    if (remaining <= 0) return failedResult(job, 'job_expired');
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? AUTHORING_RUNNER.PDF_TIMEOUT_MS, AUTHORING_RUNNER.PDF_TIMEOUT_MS, remaining));
    const execution = await runBoundedProcess('/usr/bin/prlimit', [
      `--as=${AUTHORING_RUNNER.PDF_ADDRESS_SPACE_BYTES}`, `--cpu=${Math.ceil(timeoutMs / 1000) + 1}`,
      `--nproc=${AUTHORING_RUNNER.MAX_PROCESSES}`, `--fsize=${AUTHORING_RUNNER.MAX_PDF_BYTES}`, '--core=0',
      '--', '/usr/bin/wkhtmltopdf', '--disable-local-file-access', '--allow', PDF_TEMPLATE_DIRECTORY,
      '--allow', assets, '--allow', avatarPath, '--page-size', 'A4', '--margin-left', '0.75in',
      '--margin-right', '0.75in', '--margin-top', '0.62in', '--margin-bottom', '1in', '--print-media-type',
      '--window-status', 'ready-to-print', '--encoding', 'UTF-8', '--debug-javascript',
      '--load-error-handling', 'abort', '--load-media-error-handling', 'abort', htmlPath, pdfPath,
    ], { cwd: output, timeoutMs, maxLogBytes: AUTHORING_RUNNER.MAX_DIAGNOSTIC_BYTES,
      uid: 65534, gid: 65534, headless: true, signal: options.signal });
    result.exitCode = execution.exitCode;
    result.log = Buffer.from(execution.log.replaceAll(cwd, '[workspace]').replaceAll(PDF_TEMPLATE_DIRECTORY, '[template]')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
    if (execution.reason === 'aborted') result.errorCode = 'runner_interrupted';
    else if (execution.log.includes('PDF_RENDER_ERROR:')) result.errorCode = 'pdf_render_error';
    else if (execution.reason === 'timeout') { result.status = 'timed_out'; result.errorCode = 'pdf_timeout'; }
    else if (execution.reason === 'output_limit') result.errorCode = 'pdf_output_limit';
    else if (execution.reason === 'exited' && execution.exitCode === 0) {
      if (Date.now() >= Date.parse(job.deadline)) return failedResult(job, 'job_expired');
      result.pdf = await spool.storePdf(job.jobId, pdfPath); result.status = 'succeeded'; result.errorCode = null;
    }
  } catch (error) {
    if (error instanceof StatementError) result.errorCode = 'invalid_statement';
    else if (error instanceof TestcaseError) result.errorCode = error.code === 'invalid_pdf_inputs' ? 'invalid_pdf_inputs' : 'invalid_pdf';
    else result.errorCode = 'pdf_render_error';
    result.log = `${result.errorCode}: PDF build did not complete`;
  } finally { await rm(cwd, { recursive: true, force: true }); }
  result.durationMs = Math.min(AUTHORING_RUNNER.JOB_TIMEOUT_MS, Date.now() - started);
  return result;
}
