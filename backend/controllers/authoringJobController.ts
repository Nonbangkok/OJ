import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { compileAuthoringJobSchema, generateAuthoringJobSchema, problemDraftIdParamSchema } from '../schemas/requestSchemas';
import { DurableJob, getAuthoringJob, queueCompileJob, queueGeneratorJob } from '../services/authoringJobQueryService';

const projectJob = (job: DurableJob) => ({
  id: job.id, draftId: job.draft_id, draftRevision: job.draft_revision, jobType: job.job_type,
  status: job.status, resultSummary: job.result_summary, log: job.log,
  errorCode: job.error_code, errorMessage: job.error_message,
  createdAt: job.created_at, startedAt: job.started_at, finishedAt: job.finished_at,
});

/** Admin-only asynchronous compilation; snapshots are never returned by job APIs. */
export function createAuthoringJobRouter(enabled: boolean): Router {
  const router = Router();
  for (const action of ['compile', 'generate'] as const) router.post(`/admin/authoring/drafts/:id/jobs/${action}`, requireAuth, requireAdmin,
    validateRequest({ params: problemDraftIdParamSchema, body: action === 'compile' ? compileAuthoringJobSchema : generateAuthoringJobSchema }),
    asyncHandler(async (req, res) => {
      if (!enabled) { res.status(503).json({ code: 'runner_unavailable', message: 'Authoring runner is not configured' }); return; }
      const result = action === 'compile'
        ? await queueCompileJob(String(req.params.id), req.body.expectedRevision, req.body.target)
        : await queueGeneratorJob(String(req.params.id), req.body.expectedRevision, req.body.seed);
      if (result.kind === 'queued') { res.status(202).json(projectJob(result.job)); return; }
      const errors = {
        not_found: [404, 'draft_not_found', 'Problem draft not found'],
        source_missing: [400, 'source_missing', 'The selected C++ source is empty'],
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
  return router;
}
