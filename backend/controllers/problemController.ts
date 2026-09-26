import express, { Request, Response, Router } from 'express';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { requirePublicAccess } from '../middleware/siteAccess';
import { diskUpload, memoryUpload } from '../middleware/upload';
import archiver from 'archiver';
import { processBatchUpload } from '../services/batchUploadService';
import { registerProgressClient, streamBatchUpload } from '../services/batchUploadProgress';
import {
  createProblem,
  deleteProblem,
  getAdminProblemsPage,
  getProblemDetail,
  getProblemExportBundle,
  getProblemPdfWithAccess,
  getProblemTestcases,
  getProblemsWithStatsForUser,
  getPublicProblemCategoryCounts,
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
  adminProblemsQuerySchema,
  createProblemSchema,
  problemIdParamSchema,
  problemExportSchema,
  problemTestcasesQuerySchema,
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

router.get('/problems-with-stats', requirePublicAccess,
  validateRequest({ query: problemsWithStatsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  // PUBLIC mode guests may browse the problem list. Personal stats columns
  // (best score, attempts) only exist for logged-in users — the service's
  // user-keyed CTEs simply come back empty for a null userId, so guests
  // receive the visible-problem list with no private data attached.
  // PRIVATE mode is still enforced by requirePublicAccess above.
  const userId = req.user?.id ?? null;
  // validateRequest writes Zod defaults/coercions back into req.query.
  const { difficultyMin, difficultyMax, sort, order, search, category, limit, cursor } = req.query as unknown as {
    difficultyMin?: number; difficultyMax?: number; sort?: 'difficulty'; order?: 'asc' | 'desc';
    search?: string; category?: string; limit?: number; cursor?: string;
  };
  const page = await getProblemsWithStatsForUser(userId, {
    ...(difficultyMin !== undefined ? { difficultyMin } : {}),
    ...(difficultyMax !== undefined ? { difficultyMax } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(search !== undefined && search !== '' ? { search } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  });
  res.json(page);
}));

// Global category tab counts for the problem list (visible, standalone
// problems only) — one cheap aggregate, independent of the paginated list
// so the tabs stay correct while pages stream in. Must be registered before
// the parameterised /problems/:id route.
router.get('/problems/categories', requirePublicAccess, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getPublicProblemCategoryCounts());
}));

// Problem API Endpoints
router.get('/problems', requirePublicAccess, asyncHandler(async (_req: Request, res: Response) => {
  const problems = await getVisibleProblems();
  res.json(problems);
}));

// Public details
router.get('/problems/:id',
  requirePublicAccess,
  validateRequest({ params: problemIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemDetail = await getProblemDetail(id);
  if (!problemDetail) {
    throw new AppError('Problem not found', 404);
  }

  const isStaffOrAdmin = req.user?.role === USER_ROLES.ADMIN || req.user?.role === USER_ROLES.STAFF;

  if (!problemDetail.is_visible && !isStaffOrAdmin) {
    // Hidden problems are indistinguishable from nonexistent ones for
    // non-staff callers: a 403 with the title in the body was an enumeration
    // oracle (PROBLEM-002). Staff still get the full detail below.
    throw new AppError('Problem not found', 404);
  }

  const { is_visible, contest_id, ...problemData } = problemDetail;
  res.json(isStaffOrAdmin ? problemDetail : problemData);
}));

// Admin details - guaranteed to return everything
router.get('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: problemIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemDetail = await getProblemDetail(id);
  if (!problemDetail) {
    throw new AppError('Problem not found', 404);
  }
  res.json(problemDetail);
}));

router.get('/problems/:id/pdf', requirePublicAccess,
  validateRequest({ params: problemIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Enforce the same visibility rule as GET /problems/:id before serving the PDF.
  // Hidden problems and problems attached to a contest must only be reachable by
  // staff/admin via this endpoint (contest PDFs have their own guarded endpoint).
  const problem = await getProblemPdfWithAccess(id);
  if (!problem) {
    throw new AppError('Problem PDF not found.', 404);
  }

  const isStaffOrAdmin = req.user?.role === USER_ROLES.ADMIN || req.user?.role === USER_ROLES.STAFF;
  if ((!problem.is_visible || problem.contest_id !== null) && !isStaffOrAdmin) {
    // Same non-enumeration rule as GET /problems/:id (PROBLEM-002): hidden
    // and contest problems read as plain 404s to non-staff callers.
    throw new AppError('Problem PDF not found.', 404);
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
  const createResult = await createProblem({ id, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb });
  if (createResult === 'duplicate_id') {
    throw new AppError(`Problem ID '${id}' already exists.`, 409);
  }
  res.status(201).json(createResult);
}));

router.put('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: problemIdParamSchema, body: updateProblemSchema }),
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
  validateRequest({ params: problemIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const deleted = await deleteProblem(id);
  if (!deleted) {
    throw new AppError('Problem not found', 404);
  }
  res.status(200).json({ message: `Problem ${id} deleted successfully` });
}));

// Keyset-paginated admin problem list. All filters run server-side BEFORE
// the LIMIT; hidden and contest-attached problems are deliberately included
// (the whole point of the management view). The response envelope is
// { problems, nextCursor, hasMore, authors, hasUnauthoredProblems }.
router.get('/admin/problems', requireAuth, requireStaffOrAdmin,
  validateRequest({ query: adminProblemsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  // validateRequest writes Zod defaults/coercions back into req.query.
  const { search, collection, visibility, author, limit, cursor } = req.query as unknown as {
    search?: string;
    collection?: 'none' | 'all' | number;
    visibility?: 'all' | 'visible' | 'hidden';
    author?: string;
    limit?: number;
    cursor?: string;
  };
  // Map the sentinel strings the frontend sends for "all" onto undefined so
  // the service sees a clean unfiltered query (its own 'all' handling is
  // for internal callers passing the raw enum).
  const page = await getAdminProblemsPage({
    ...(search !== undefined && search !== '' ? { search } : {}),
    ...(collection !== undefined && collection !== 'all' ? { collection } : {}),
    ...(visibility !== undefined && visibility !== 'all' ? { visibility } : {}),
    ...(author !== undefined && author !== 'all' ? { author } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  });
  res.json(page);
}));

router.put('/admin/problems/:id/visibility', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: problemIdParamSchema, body: updateProblemVisibilitySchema }),
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

// Admin testcase viewer (JUDGE-011: testcase content is staff-only — never
// exposed on any user-facing route). Default response is metadata only
// (case numbers + sizes); ?caseNumber=N fetches one full case, truncated
// server-side past TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES per side.
router.get('/admin/problems/:id/testcases', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: problemIdParamSchema, query: problemTestcasesQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { caseNumber } = req.query as unknown as { caseNumber?: number };

    const result = await getProblemTestcases(id, caseNumber);
    if (result.kind === 'not_found') {
      throw new AppError('Problem not found', 404);
    }
    if (result.kind === 'case_not_found') {
      throw new AppError(`Testcase ${caseNumber} not found for problem ${id}`, 404);
    }
    if (result.kind === 'ok') {
      res.json({ testcases: result.testcases, total: result.testcases.length });
      return;
    }
    res.json(result.testcase);
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
    if (updated === null) {
      throw new AppError('Collection not found', 404);
    }
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
  validateRequest({ params: problemIdParamSchema }),
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
    const pdfResult = await updateProblemPdf(id, problemPdfFile.buffer);
    if (pdfResult === 'not_found') {
      throw new AppError('Problem not found', 404);
    }
  }

  if (testcasesZipFile) {
    const replaceResult = await replaceProblemTestcasesFromZip(id, testcasesZipFile.buffer);
    if (replaceResult.kind === 'no_valid_pairs') {
      throw new AppError('No valid testcase pairs (.in/.out or input/output) found in the ZIP file.', 400);
    }
    if (replaceResult.kind === 'not_found') {
      throw new AppError('Problem not found', 404);
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
