import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Request, Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { TESTCASE_LIMITS, TestcaseError, validateTestcaseFilename } from '../authoring/testcases';
import { prepareTestcaseArchive, prepareTestcaseFile } from '../services/authoringTestcaseUploadService';
import { getDraftTestcase, listDraftTestcases, mutateDraftTestcases, TestcaseMutationResult } from '../services/authoringTestcaseQueryService';

const router = Router();
const base = '/admin/authoring/drafts/:id/testcases';
const params = z.object({ id: z.uuid(), caseId: z.uuid().optional() });
function validParams(req: Request, res: Response): boolean {
  if (params.safeParse(req.params).success) return true;
  res.status(400).json({ code: 'invalid_request', message: 'Invalid draft or testcase ID' }); return false;
}
function revision(body: unknown): number {
  const parsed = z.object({ expectedRevision: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/).transform(Number)]) }).strict().safeParse(body);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.expectedRevision)) throw new TestcaseError('invalid_request', 'Supply a positive integer expectedRevision');
  return parsed.data.expectedRevision;
}
function sendMutation(res: Response, result: TestcaseMutationResult, successStatus = 200) {
  if (result.kind === 'saved') { res.status(successStatus).json({ revision: result.revision }); return; }
  const errors = {
    not_found: [404, 'draft_not_found', 'Problem draft not found'],
    case_not_found: [404, 'testcase_not_found', 'Testcase not found'],
    published: [409, 'draft_published', 'Published problem drafts are read-only'],
    revision_conflict: [409, 'revision_conflict', 'Problem draft revision conflict'],
  } as const;
  const [status, code, message] = errors[result.kind];
  res.status(status).json({ code, message, ...('currentRevision' in result ? { currentRevision: result.currentRevision } : {}) });
}
function handleUploadError(error: unknown, res: Response): boolean {
  if (error instanceof TestcaseError) {
    res.status(/too_large|size_exceeded|count_exceeded/.test(error.code) ? 413 : 400).json({ code: error.code, message: error.message }); return true;
  }
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: 'invalid_testcase_upload', message: error.message }); return true;
  }
  return false;
}

/** Each request owns its private directory, byte budget and cancellable disk streams. */
async function withUpload(req: Request, res: Response, action: (files: Record<string, Express.Multer.File[]>, expectedRevision: number) => Promise<void>) {
  if (!req.is('multipart/form-data')) throw new TestcaseError('invalid_testcase_upload', 'Use multipart/form-data with input/output files or an archive');
  const root = await mkdtemp(path.join(os.tmpdir(), 'oj-authoring-upload-'));
  const abort = new AbortController(); const pending: Promise<void>[] = []; let total = 0;
  const storage: multer.StorageEngine = {
    _handleFile(_req, file, callback) {
      const filename = randomUUID(); const target = path.join(root, filename); let size = 0;
      const max = file.fieldname === 'archive' ? TESTCASE_LIMITS.MAX_TOTAL_BYTES : TESTCASE_LIMITS.MAX_FILE_BYTES;
      const bound = new Transform({ transform(chunk: Buffer, _encoding, done) {
        size += chunk.length; total += chunk.length;
        if (size > max) { done(new TestcaseError('testcase_file_too_large', `${file.originalname} exceeds its upload size limit`)); return; }
        if (total > TESTCASE_LIMITS.MAX_TOTAL_BYTES) { done(new TestcaseError('testcase_total_size_exceeded', 'Testcase upload exceeds 512 MiB')); return; }
        done(null, chunk);
      } });
      const transfer = pipeline(file.stream, bound, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal: abort.signal })
        .then(() => { callback(null, { destination: root, filename, path: target, size }); }, error => { callback(error); });
      pending.push(transfer);
    },
    _removeFile(_req, file, callback) { unlink(file.path).then(() => callback(null), error => callback(error.code === 'ENOENT' ? null : error)); },
  };
  const fields = new Set<string>();
  const upload = multer({ storage, preservePath: true,
    // Busboy emits partsLimit when it reaches this count, not on the next part.
    limits: { fileSize: TESTCASE_LIMITS.MAX_TOTAL_BYTES, files: 2, fields: 1, fieldSize: 64, parts: 4 },
    fileFilter(_req, file, callback) {
      try {
        validateTestcaseFilename(file.originalname);
        if ((file.fieldname === 'archive' && fields.size > 0) || fields.has('archive') || (req.method === 'PATCH' && file.fieldname === 'archive')) {
          throw new TestcaseError('invalid_testcase_upload', 'Upload either an archive or individual input/output files');
        }
        fields.add(file.fieldname); callback(null, true);
      } catch (error) { callback(error as Error); }
    },
  }).fields([{ name: 'input', maxCount: 1 }, { name: 'output', maxCount: 1 }, { name: 'archive', maxCount: 1 }]);
  let disconnected = false;
  const onClose = () => { if (!res.writableEnded) { disconnected = true; abort.abort(); } };
  res.once('close', onClose);
  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new TestcaseError('upload_aborted', 'Testcase upload disconnected'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
      upload(req, res, error => { abort.signal.removeEventListener('abort', onAbort); error ? reject(error) : resolve(); });
      if (req.aborted || res.destroyed) { disconnected = true; abort.abort(); }
    }).catch(error => {
      if (error instanceof Error && /^(Unexpected end of (form|file)|Malformed part header|Multipart: Boundary not found)$/.test(error.message)) {
        throw new TestcaseError('invalid_testcase_upload', 'Malformed multipart testcase upload');
      }
      throw error;
    });
    if (disconnected) return;
    await action((req.files ?? {}) as Record<string, Express.Multer.File[]>, revision(req.body));
  } finally {
    abort.abort(); await Promise.allSettled(pending);
    await rm(root, { recursive: true, force: true }); res.off('close', onClose);
  }
}

router.get(base, requireAuth, requireStaffOrAdmin, asyncHandler(async (req, res) => {
  if (!validParams(req, res)) return;
  const result = await listDraftTestcases(String(req.params.id));
  if (!result) { res.status(404).json({ code: 'draft_not_found', message: 'Problem draft not found' }); return; }
  res.json(result);
}));
router.get(`${base}/:caseId`, requireAuth, requireStaffOrAdmin, asyncHandler(async (req, res) => {
  if (!validParams(req, res)) return;
  const result = await getDraftTestcase(String(req.params.id), String(req.params.caseId));
  if (!result) { res.status(404).json({ code: 'testcase_not_found', message: 'Testcase not found' }); return; }
  res.json(result);
}));
for (const method of ['post', 'patch'] as const) router[method](method === 'post' ? base : `${base}/:caseId`, requireAuth, requireStaffOrAdmin, asyncHandler(async (req, res) => {
  if (!validParams(req, res)) return;
  let result: TestcaseMutationResult | undefined;
  try {
    await withUpload(req, res, async (files, expectedRevision) => {
      const inputFile = files.input?.[0]; const outputFile = files.output?.[0]; const archive = files.archive?.[0];
      if (archive) {
        const cases = await prepareTestcaseArchive(archive.path);
        if (res.destroyed) return;
        result = await mutateDraftTestcases(String(req.params.id), expectedRevision, { kind: 'replace', cases });
      } else {
        if ((!inputFile && method === 'post') || (!inputFile && !outputFile)) throw new TestcaseError('testcase_input_required', 'Upload an input file; PATCH also accepts an output alone');
        const input = inputFile ? await prepareTestcaseFile(inputFile) : undefined;
        const output = outputFile ? await prepareTestcaseFile(outputFile) : undefined;
        if (res.destroyed) return;
        result = await mutateDraftTestcases(String(req.params.id), expectedRevision, method === 'post'
          ? { kind: 'append', cases: [{ filename: input!.filename, input: input!.content, output: output?.content ?? null }] }
          : { kind: 'patch', caseId: String(req.params.caseId), patch: { filename: input?.filename, input: input?.content, output: output?.content } });
      }
    });
    if (result && !res.destroyed) sendMutation(res, result, method === 'post' ? 201 : 200);
  } catch (error) { if (!res.destroyed && !handleUploadError(error, res)) throw error; }
}));
router.delete(`${base}/:caseId`, requireAuth, requireStaffOrAdmin, asyncHandler(async (req, res) => {
  if (!validParams(req, res)) return;
  try { sendMutation(res, await mutateDraftTestcases(String(req.params.id), revision(req.body), { kind: 'delete', caseId: String(req.params.caseId) })); }
  catch (error) { if (!handleUploadError(error, res)) throw error; }
}));

export default router;
