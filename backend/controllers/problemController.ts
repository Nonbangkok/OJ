import express, { Request, Response, Router } from 'express';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { diskUpload, memoryUpload } from '../middleware/upload';
import archiver from 'archiver';
import { processBatchUpload } from '../services/batchUploadService';
import { registerProgressClient, streamBatchUpload } from '../services/batchUploadProgress';
import {
  createProblem,
  deleteProblem,
  getAdminProblems,
  getProblemDetail,
  getProblemExportBundle,
  getProblemPdfWithAccess,
  getProblemsWithStatsForUser,
  getVisibleProblems,
  replaceProblemTestcasesFromZip,
  updateProblem,
  updateProblemPdf,
  updateProblemVisibility,
} from '../services/problemQueryService';
import { USER_ROLES } from '../constants';
import {
  createCollection,
  deleteCollection,
  listCollections,
  setCollectionVisibility,
  updateCollection,
} from '../services/collectionQueryService';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import {
  BatchUploadProgressData,
  CreateProblemRequestBody,
  ProblemExportConfig,
  ProblemExportRequestBody,
  UpdateProblemRequestBody,
  UpdateProblemVisibilityRequestBody,
} from '../types/api';
import { getErrorMessage } from '../utils/errorMessage';
import { validateRequest } from '../middleware/validation';
import {
  createProblemSchema,
  idParamSchema,
  problemExportSchema,
  problemsWithStatsQuerySchema,
  progressIdParamSchema,
  updateProblemSchema,
  updateProblemVisibilitySchema,
  collectionIdParamSchema,
  collectionVisibilityBodySchema,
  createCollectionSchema,
  updateCollectionSchema,
} from '../schemas/requestSchemas';

const router: Router = express.Router();

// A valid PDF file always begins with the magic bytes "%PDF". Reject anything
// that does not, so a renamed HTML/script payload cannot be stored and later
// be served from the same origin.
const PDF_MAGIC = Buffer.from('%PDF');
const isPdfBuffer = (buffer: Buffer | undefined | null): boolean =>
  !!buffer && buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);

router.get('/problems-with-stats', requireAuth,
  validateRequest({ query: problemsWithStatsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }
  // validateRequest writes Zod defaults/coercions back into req.query.
  const { difficultyMin, difficultyMax, sort, order } = req.query as unknown as {
    difficultyMin?: number; difficultyMax?: number; sort?: 'difficulty'; order?: 'asc' | 'desc';
  };
  const problems = await getProblemsWithStatsForUser(userId, {
    ...(difficultyMin !== undefined ? { difficultyMin } : {}),
    ...(difficultyMax !== undefined ? { difficultyMax } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(order !== undefined ? { order } : {}),
  });
  res.json(problems);
}));

// Problem API Endpoints
router.get('/problems', asyncHandler(async (_req: Request, res: Response) => {
  const problems = await getVisibleProblems();
  res.json(problems);
}));

// Public details
router.get('/problems/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemDetail = await getProblemDetail(id);
  if (!problemDetail) {
    throw new AppError('Problem not found', 404);
  }

  const isStaffOrAdmin = req.session.role === USER_ROLES.ADMIN || req.session.role === USER_ROLES.STAFF;

  if (!problemDetail.is_visible && !isStaffOrAdmin) {
    // Kept inline (not AppError): the response carries hidden-problem context
    // fields at the top level for the UI; the shared error envelope would nest
    // them under `details`.
    return res.status(403).json({
      detail: 'This problem has been hidden by administrators and is not accessible to regular users.',
      problemId: id,
      title: problemDetail.title || 'Hidden Problem',
      message: 'Problem is hidden',
    });
  }

  const { is_visible, contest_id, ...problemData } = problemDetail;
  res.json(isStaffOrAdmin ? problemDetail : problemData);
}));

// Admin details - guaranteed to return everything
router.get('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemDetail = await getProblemDetail(id);
  if (!problemDetail) {
    throw new AppError('Problem not found', 404);
  }
  res.json(problemDetail);
}));

router.get('/problems/:id/pdf', requireAuth,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Enforce the same visibility rule as GET /problems/:id before serving the PDF.
  // Hidden problems and problems attached to a contest must only be reachable by
  // staff/admin via this endpoint (contest PDFs have their own guarded endpoint).
  const problem = await getProblemPdfWithAccess(id);
  if (!problem) {
    throw new AppError('Problem PDF not found.', 404);
  }

  const isStaffOrAdmin = req.session.role === USER_ROLES.ADMIN || req.session.role === USER_ROLES.STAFF;
  if ((!problem.is_visible || problem.contest_id !== null) && !isStaffOrAdmin) {
    // Kept inline for the same reason as the hidden-problem 403 above.
    return res.status(403).json({
      detail: 'This problem has been hidden by administrators and is not accessible to regular users.',
      problemId: id,
      message: 'Problem is hidden',
    });
  }

  if (!problem.problem_pdf) {
    throw new AppError('Problem PDF not found.', 404);
  }
  res.setHeader('Content-Type', 'application/pdf');
  // Prevent content-type sniffing: ensures the browser treats this strictly as
  // a PDF and never re-interprets the bytes as HTML/JS (XSS via uploaded file).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(problem.problem_pdf);
}));

router.post('/admin/problems', requireAuth, requireStaffOrAdmin,
  validateRequest({ body: createProblemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { id, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb } = req.body as CreateProblemRequestBody;
  const createdProblem = await createProblem({ id, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb });
  res.status(201).json(createdProblem);
}));

router.put('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema, body: updateProblemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const oldId = String(req.params.id);
  const { id: newId, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb } = req.body as UpdateProblemRequestBody;

  const updateResult = await updateProblem(oldId, {
    id: newId,
    title,
    author,
    categories,
    difficulty,
    collection_id,
    time_limit_ms,
    memory_limit_mb,
  });
  if (updateResult === 'duplicate_id') {
    throw new AppError(`Problem ID '${newId}' already exists.`, 409);
  }
  if (updateResult === 'not_found') {
    throw new AppError('Problem not found', 404);
  }
  res.json(updateResult);
}));

router.delete('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const deleted = await deleteProblem(id);
  if (!deleted) {
    throw new AppError('Problem not found', 404);
  }
  res.status(200).json({ message: `Problem ${id} deleted successfully` });
}));

router.get('/admin/problems', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const problems = await getAdminProblems();
  res.json(problems);
}));

router.put('/admin/problems/:id/visibility', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema, body: updateProblemVisibilitySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { isVisible } = req.body as UpdateProblemVisibilityRequestBody;

  const updatedProblem = await updateProblemVisibility(id, isVisible);
  if (!updatedProblem) {
    throw new AppError('Problem not found', 404);
  }
  res.json({
    message: `Problem ${id} visibility updated successfully`,
    problem: updatedProblem
  });
}));

// Problem Collections (organizational groups; visibility stays on problems)
router.get('/admin/collections', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listCollections());
}));

router.post('/admin/collections', requireAuth, requireStaffOrAdmin,
  validateRequest({ body: createCollectionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.body as { name: string };
    const result = await createCollection(name);
    if (result.kind === 'duplicate_name') {
      throw new AppError(`A collection named "${name}" already exists`, 409);
    }
    res.status(201).json(result.collection);
  }));

router.put('/admin/collections/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: collectionIdParamSchema, body: updateCollectionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.body as { name: string };
    const result = await updateCollection(Number(req.params.id), name);
    if (result.kind === 'not_found') throw new AppError('Collection not found', 404);
    if (result.kind === 'duplicate_name') {
      throw new AppError(`A collection named "${name}" already exists`, 409);
    }
    res.json(result.collection);
  }));

router.delete('/admin/collections/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: collectionIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteCollection(Number(req.params.id));
    if (!deleted) throw new AppError('Collection not found', 404);
    res.json({ message: 'Collection deleted; its problems were moved to No Collection' });
  }));

// Collection-wide visibility: writes the SAME is_visible column the individual
// and global toggles use — one transaction, no parallel visibility system.
router.put('/admin/collections/:id/visibility', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: collectionIdParamSchema, body: collectionVisibilityBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { isVisible } = req.body as { isVisible: boolean };
    const updated = await setCollectionVisibility(Number(req.params.id), isVisible);
    res.json({
      message: `${updated} problem${updated === 1 ? '' : 's'} ${isVisible ? 'shown' : 'hidden'}`,
      updated,
    });
  }));

router.post('/admin/problems/batch-upload', requireAuth, requireStaffOrAdmin, diskUpload.single('problemsZip'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No zip file uploaded.' });
  }

  const progressId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  res.status(202).json({
    message: 'Batch upload initiated. Connect to progress endpoint to monitor.',
    progressId: progressId
  });

  // Stream progress to any connected SSE client; never fails the already-sent 202.
  const uploadPath = req.file.path;
  void streamBatchUpload(progressId, (onProgress) =>
    processBatchUpload(uploadPath, (progressData: BatchUploadProgressData) => onProgress(progressData)));
});

router.get('/admin/problems/batch-upload-progress/:progressId', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: progressIdParamSchema }),
  (req: Request, res: Response) => {
  registerProgressClient(String(req.params.progressId), req, res);
});

router.post('/admin/problems/:id/upload', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  memoryUpload.fields([
  { name: 'problemPdf', maxCount: 1 },
  { name: 'testcasesZip', maxCount: 1 }
]), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const files = (req.files ?? {}) as { [fieldname: string]: Express.Multer.File[] };
  const problemPdfFile = files['problemPdf'] ? files['problemPdf'][0] : null;
  const testcasesZipFile = files['testcasesZip'] ? files['testcasesZip'][0] : null;

  if (!problemPdfFile && !testcasesZipFile) {
    throw new AppError('No files uploaded.', 400);
  }

  // Reject non-PDF payloads before they ever reach the database / get served.
  if (problemPdfFile && !isPdfBuffer(problemPdfFile.buffer)) {
    throw new AppError('Uploaded problem PDF is not a valid PDF file.', 400);
  }

  if (problemPdfFile) {
    await updateProblemPdf(id, problemPdfFile.buffer);
  }

  if (testcasesZipFile) {
    const replaceResult = await replaceProblemTestcasesFromZip(id, testcasesZipFile.buffer);
    if (replaceResult.kind === 'no_valid_pairs') {
      throw new AppError('No valid testcase pairs (.in/.out or input/output) found in the ZIP file.', 400);
    }
  }

  res.status(200).json({ message: 'Files processed successfully.' });
}));

// Admin API Endpoints for Problem Export
router.post('/admin/problems/export', requireAuth, requireStaffOrAdmin,
  validateRequest({ body: problemExportSchema }),
  async (req: Request, res: Response) => {
  const { problemIds } = req.body as ProblemExportRequestBody; // Expects an array of problem IDs to export

  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  const timestamp = Date.now();
  const outputFileName = `problems_export_${timestamp}.zip`;

  // Set headers for file download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);

  // Pipe the archive directly to the response
  archive.pipe(res);

  archive.on('error', (err: Error) => {
    console.error('Archive error during streaming export:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating problem export zip.', error: err.message });
    }
    res.end(); // End the response even if headers were sent
  });

  try {
    for (const problemId of problemIds) {
      const bundle = await getProblemExportBundle(problemId);
      if (!bundle) {
        console.warn(`Problem ${problemId} not found, skipping export.`);
        continue;
      }

      const { problem, testcases } = bundle;
      const problemFolderName = `${problem.id}`; // Use problem ID as folder name

      // 1. Add config.json
      const config: ProblemExportConfig = {
        id: problem.id,
        title: problem.title,
        author: problem.author,
        time_limit_ms: problem.time_limit_ms,
        memory_limit_mb: problem.memory_limit_mb,
      };
      archive.append(JSON.stringify(config, null, 2), { name: `${problemFolderName}/config.json` });

      // 2. Add problem PDF (if exists)
      if (problem.problem_pdf) {
        archive.append(problem.problem_pdf, { name: `${problemFolderName}/${problem.id}.pdf` });
      }

      // 3. Add test cases (input/output)
      if (testcases.length > 0) {
        for (const testcase of testcases) {
          const caseNumberPadded = testcase.case_number.toString().padStart(2, '0'); // e.g., 01, 02
          archive.append(testcase.input_data, { name: `${problemFolderName}/testcases/input/input${caseNumberPadded}.txt` });
          archive.append(testcase.output_data, { name: `${problemFolderName}/testcases/output/output${caseNumberPadded}.txt` });
        }
      }
    }

    archive.finalize();

  } catch (error: unknown) {
    console.error('Error during problem export:', error);
    if (!res.headersSent) {
      const message = getErrorMessage(error);
      res.status(500).json({ message: 'Failed to export problems.', error: message });
    }
    archive.abort();
    res.end(); // Ensure response is ended on error
  }
});

export default router;
