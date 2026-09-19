import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { compileAuthoringJobSchema, generateAuthoringJobSchema, expectedRevisionSchema, problemDraftIdParamSchema } from '../schemas/requestSchemas';
import { DurableJob, getAuthoringJob, getDraftPdf, queueCompileJob, queueGeneratorJob, queueOutputJob, queuePdfJob, queueVerifyJob } from '../services/authoringJobQueryService';
import { getProfileSync, listProfileSyncs } from '../services/authoringProfileSyncService';

const projectJob = (job: DurableJob) => ({
  id: job.id, draftId: job.draft_id, draftRevision: job.draft_revision, jobType: job.job_type,
  status: job.status, resultSummary: job.result_summary, log: job.log,
  errorCode: job.error_code, errorMessage: job.error_message,
  createdAt: job.created_at, startedAt: job.started_at, finishedAt: job.finished_at,
});

/** Admin-only asynchronous compilation; snapshots are never returned by job APIs. */
export function createAuthoringJobRouter(enabled: boolean): Router {
  const router = Router();
  for (const action of ['compile', 'generate', 'outputs', 'pdf', 'verify'] as const) router.post(`/admin/authoring/drafts/:id/jobs/${action}`, requireAuth, requireAdmin,
    validateRequest({ params: problemDraftIdParamSchema, body: action === 'compile' ? compileAuthoringJobSchema
      : action === 'generate' ? generateAuthoringJobSchema : expectedRevisionSchema }),
    asyncHandler(async (req, res) => {
      if (!enabled) { res.status(503).json({ code: 'runner_unavailable', message: 'Authoring runner is not configured' }); return; }
      const result = action === 'compile'
        ? await queueCompileJob(String(req.params.id), req.body.expectedRevision, req.body.target)
        : action === 'generate' ? await queueGeneratorJob(String(req.params.id), req.body.expectedRevision, req.body.seed)
          : action === 'outputs' ? await queueOutputJob(String(req.params.id), req.body.expectedRevision)
            : action === 'pdf' ? await queuePdfJob(String(req.params.id), req.body.expectedRevision)
              : await queueVerifyJob(String(req.params.id), req.body.expectedRevision);
      if (result.kind === 'queued') { res.status(202).json(projectJob(result.job)); return; }
      const errors = {
        not_found: [404, 'draft_not_found', 'Problem draft not found'],
        source_missing: [400, 'source_missing', 'The selected C++ source is empty'],
        invalid_metadata: [400, 'invalid_metadata', 'Problem ID, author metadata or limits are invalid'],
        outputs_missing: [400, 'outputs_missing', 'Every stored input needs an expected output before verification'],
        invalid_testcases: [400, 'invalid_testcases', 'Testcase names, pairing, count, size or source snapshot exceed supported limits'],
        unsupported_template: [400, 'unsupported_template', 'This PDF template version is not supported'],
        invalid_statement: [400, 'invalid_statement', 'Statement is empty, unsafe, exceeds limits, or references missing assets'],
        inputs_missing: [400, 'inputs_missing', 'Store at least one input before generating outputs'],
        unsupported_resource_limits: [400, 'unsupported_resource_limits', 'This runner supports memory limits up to 736 MiB and time limits up to 900000 ms'],
        busy: [409, 'job_active', 'This draft already has an active authoring job'],
        published: [409, 'draft_published', 'Published problem drafts are read-only'],
        revision_conflict: [409, 'revision_conflict', 'Problem draft revision conflict'],
        queue_full: [429, 'queue_full', 'The authoring queue is full; retry later'],
      } as const;
      const [status, code, message] = errors[result.kind];
      res.status(status).json({ code, message,
        ...('currentRevision' in result ? { currentRevision: result.currentRevision } : {}),
        ...('jobId' in result ? { jobId: result.jobId } : {}),
      });
    }));
  router.get('/admin/authoring/jobs/:id', requireAuth, requireAdmin,
    validateRequest({ params: problemDraftIdParamSchema }),
    asyncHandler(async (req, res) => {
      const job = await getAuthoringJob(String(req.params.id));
      if (!job) { res.status(404).json({ message: 'Authoring job not found' }); return; }
      res.json(projectJob(job));
    }));
  // Profile-sync cascades are readable even when the runner transport is
  // disabled (same rule as job history): these rows live in the main database.
  router.get('/admin/authoring/profile-syncs', requireAuth, requireAdmin,
    asyncHandler(async (_req, res) => {
      res.json(await listProfileSyncs());
    }));
  router.get('/admin/authoring/profile-syncs/:id', requireAuth, requireAdmin,
    validateRequest({ params: problemDraftIdParamSchema }),
    asyncHandler(async (req, res) => {
      const sync = await getProfileSync(String(req.params.id));
      if (!sync) { res.status(404).json({ code: 'profile_sync_not_found', message: 'Profile sync not found' }); return; }
      res.json(sync);
    }));
  router.get('/admin/authoring/drafts/:id/pdf', requireAuth, requireAdmin,
    validateRequest({ params: problemDraftIdParamSchema }), asyncHandler(async (req, res) => {
      const draft = await getDraftPdf(String(req.params.id));
      if (!draft) { res.status(404).json({ code: 'draft_not_found', message: 'Problem draft not found' }); return; }
      if (!draft.latest_pdf) { res.status(404).json({ code: 'pdf_missing', message: 'No successful PDF build is available' }); return; }
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="statement.pdf"',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'X-PDF-Revision': String(draft.latest_pdf_revision), 'X-Draft-Revision': String(draft.revision),
        'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' });
      res.send(draft.latest_pdf);
    }));
  return router;
}
