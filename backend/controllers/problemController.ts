import express, { Request, Response, Router } from 'express';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { diskUpload, memoryUpload } from '../middleware/upload';
import archiver from 'archiver';
import { processBatchUpload } from '../services/batchUploadService';
import {
  createProblem,
  deleteProblem,
  getAdminProblems,
  getProblemDetail,
  getProblemExportBundle,
  getProblemPdf,
  getProblemsWithStatsForUser,
  getVisibleProblems,
  replaceProblemTestcasesFromZip,
  updateProblem,
  updateProblemPdf,
  updateProblemVisibility,
} from '../services/problemQueryService';
import { USER_ROLES } from '../constants';
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
  progressIdParamSchema,
  updateProblemSchema,
  updateProblemVisibilitySchema,
} from '../schemas/requestSchemas';

const router: Router = express.Router();
const progressMap = new Map<string, Response>();

const writeProgressEvent = (progressId: string, event: string, payload: unknown): void => {
  const clientResponse = progressMap.get(progressId);
  if (!clientResponse || clientResponse.writableEnded) {
    return;
  }
  clientResponse.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};

const endProgressStream = (progressId: string): void => {
  const clientResponse = progressMap.get(progressId);
  if (clientResponse && !clientResponse.writableEnded) {
    clientResponse.end();
  }
  progressMap.delete(progressId);
};

router.get('/problems-with-stats', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }
  const problems = await getProblemsWithStatsForUser(userId);
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
    return res.status(404).json({ message: 'Problem not found' });
  }

  const isStaffOrAdmin = req.session.role === USER_ROLES.ADMIN || req.session.role === USER_ROLES.STAFF;

  if (!problemDetail.is_visible && !isStaffOrAdmin) {
    return res.status(403).json({
      detail: 'This problem has been hidden by administrators and is not accessible to regular users.',
      problemId: id,
      title: problemDetail.title || 'Hidden Problem',
      message: 'Problem is hidden',
    });
  }

  const { is_visible, ...problemData } = problemDetail;
  res.json(isStaffOrAdmin ? problemDetail : problemData);
}));

// Admin details - guaranteed to return everything
router.get('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemDetail = await getProblemDetail(id);
  if (!problemDetail) {
    return res.status(404).json({ message: 'Problem not found' });
  }
  res.json(problemDetail);
}));

router.get('/problems/:id/pdf', requireAuth,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const pdfData = await getProblemPdf(id);
  if (!pdfData) {
    return res.status(404).json({ message: 'Problem PDF not found.' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.send(pdfData);
}));

router.post('/admin/problems', requireAuth, requireStaffOrAdmin,
  validateRequest({ body: createProblemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { id, title, author, time_limit_ms, memory_limit_mb } = req.body as CreateProblemRequestBody;
  const createdProblem = await createProblem({ id, title, author, time_limit_ms, memory_limit_mb });
  res.status(201).json(createdProblem);
}));

router.put('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema, body: updateProblemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const oldId = String(req.params.id);
  const { id: newId, title, author, time_limit_ms, memory_limit_mb } = req.body as UpdateProblemRequestBody;

  const updateResult = await updateProblem(oldId, {
    id: newId,
    title,
    author,
    time_limit_ms,
    memory_limit_mb,
  });
  if (updateResult === 'duplicate_id') {
    return res.status(409).json({ message: `Problem ID '${newId}' already exists.` });
  }
  if (updateResult === 'not_found') {
    return res.status(404).json({ message: 'Problem not found' });
  }
  res.json(updateResult);
}));

router.delete('/admin/problems/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const deleted = await deleteProblem(id);
  if (!deleted) {
    return res.status(404).json({ message: 'Problem not found' });
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
    return res.status(404).json({ message: 'Problem not found' });
  }
  res.json({
    message: `Problem ${id} visibility updated successfully`,
    problem: updatedProblem
  });
}));

router.post('/admin/problems/batch-upload', requireAuth, requireStaffOrAdmin, diskUpload.single('problemsZip'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No zip file uploaded.' });
  }

  const progressId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  try {
    res.status(202).json({
      message: 'Batch upload initiated. Connect to progress endpoint to monitor.',
      progressId: progressId
    });

    const batchResults = await processBatchUpload(req.file.path, (progressData: BatchUploadProgressData) => {
      writeProgressEvent(progressId, 'progress', progressData);
    });

    writeProgressEvent(progressId, 'complete', { status: 'complete', message: 'Batch upload process finished.', ...batchResults });
    endProgressStream(progressId);

  } catch (error: unknown) {
    console.error('Error in batch upload endpoint:', error);
    const message = getErrorMessage(error, 'A critical error occurred during batch upload.');
    writeProgressEvent(progressId, 'error', { status: 'error', message });
    endProgressStream(progressId);
  }
});

router.get('/admin/problems/batch-upload-progress/:progressId', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: progressIdParamSchema }),
  (req: Request, res: Response) => {
  const progressId = String(req.params.progressId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  progressMap.set(progressId, res);

  res.write(`event: initial\ndata: ${JSON.stringify({ message: 'Connected to batch upload progress stream.', progressId })}\n\n`);

  req.on('close', () => {
    if (progressMap.get(progressId) === res) {
      progressMap.delete(progressId);
    }
  });
});

router.post('/admin/problems/:id/upload', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: idParamSchema }),
  memoryUpload.fields([
  { name: 'problemPdf', maxCount: 1 },
  { name: 'testcasesZip', maxCount: 1 }
]), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const files = (req.files ?? {}) as { [fieldname: string]: Express.Multer.File[] };
  const problemPdfFile = files['problemPdf'] ? files['problemPdf'][0] : null;
  const testcasesZipFile = files['testcasesZip'] ? files['testcasesZip'][0] : null;

  if (!problemPdfFile && !testcasesZipFile) {
    return res.status(400).json({ message: 'No files uploaded.' });
  }

  try {
    if (problemPdfFile) {
      await updateProblemPdf(id, problemPdfFile.buffer);
    }

    if (testcasesZipFile) {
      const replaceResult = await replaceProblemTestcasesFromZip(id, testcasesZipFile.buffer);
      if (replaceResult.kind === 'no_valid_pairs') {
        return res.status(400).json({ message: 'No valid testcase pairs (.in/.out or input/output) found in the ZIP file.' });
      }
    }

    res.status(200).json({ message: 'Files processed successfully.' });

  } catch (error: unknown) {
    console.error(`Error processing uploads for problem ${id}:`, error);
    res.status(500).json({ message: 'An error occurred during file processing.' });
  }
});

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
