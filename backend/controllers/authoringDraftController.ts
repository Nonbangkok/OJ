import express, { Request, Response, Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  createProblemDraftSchema,
  problemDraftIdParamSchema,
  updateProblemDraftSchema,
} from '../schemas/requestSchemas';
import {
  createProblemDraft,
  getProblemDraft,
  listProblemDrafts,
  ProblemDraftListRow,
  ProblemDraftUpdates,
  updateProblemDraft,
} from '../services/authoringDraftQueryService';
import {
  CreateProblemDraftRequestBody,
  UpdateProblemDraftRequestBody,
} from '../types/api';
import { ProblemDraftRow } from '../types/authoring';

const router: Router = express.Router();

const toDraftSummaryResponse = (draft: ProblemDraftListRow) => ({
  id: draft.id,
  problemId: draft.problem_id,
  title: draft.title,
  authorAkaName: draft.author_aka_name,
  status: draft.status,
  revision: draft.revision,
  verifiedRevision: draft.verified_revision,
  createdBy: draft.created_by,
  createdAt: draft.created_at,
  updatedAt: draft.updated_at,
});

const toDraftDetailResponse = (draft: ProblemDraftRow) => ({
  id: draft.id,
  problemId: draft.problem_id,
  title: draft.title,
  authorProfileId: draft.author_profile_id,
  authorAkaName: draft.author_aka_name,
  authorRealName: draft.author_real_name,
  language: draft.language,
  countryCode: draft.country_code,
  hasAuthorProfileImage: draft.author_profile_image_png !== null,
  timeLimitMs: draft.time_limit_ms,
  memoryLimitMb: draft.memory_limit_mb,
  statementHtml: draft.statement_html,
  solutionCpp: draft.solution_cpp,
  generatorCpp: draft.generator_cpp,
  hasLatestPdf: draft.latest_pdf !== null,
  latestPdfRevision: draft.latest_pdf_revision,
  templateVersion: draft.template_version,
  revision: draft.revision,
  verifiedRevision: draft.verified_revision,
  status: draft.status,
  createdBy: draft.created_by,
  createdAt: draft.created_at,
  updatedAt: draft.updated_at,
  publishedAt: draft.published_at,
});

const toDraftUpdates = (
  body: Omit<UpdateProblemDraftRequestBody, 'expectedRevision'>,
): ProblemDraftUpdates => ({
  ...(body.problemId !== undefined ? { problem_id: body.problemId } : {}),
  ...(body.title !== undefined ? { title: body.title } : {}),
  ...(body.authorProfileId !== undefined ? { author_profile_id: body.authorProfileId } : {}),
  ...(body.authorAkaName !== undefined ? { author_aka_name: body.authorAkaName } : {}),
  ...(body.authorRealName !== undefined ? { author_real_name: body.authorRealName } : {}),
  ...(body.language !== undefined ? { language: body.language } : {}),
  ...(body.countryCode !== undefined ? { country_code: body.countryCode } : {}),
  ...(body.timeLimitMs !== undefined ? { time_limit_ms: body.timeLimitMs } : {}),
  ...(body.memoryLimitMb !== undefined ? { memory_limit_mb: body.memoryLimitMb } : {}),
  ...(body.statementHtml !== undefined ? { statement_html: body.statementHtml } : {}),
  ...(body.solutionCpp !== undefined ? { solution_cpp: body.solutionCpp } : {}),
  ...(body.generatorCpp !== undefined ? { generator_cpp: body.generatorCpp } : {}),
  ...(body.templateVersion !== undefined ? { template_version: body.templateVersion } : {}),
});

router.use('/admin/authoring/drafts', requireAuth, requireAdmin);

router.post('/admin/authoring/drafts',
  validateRequest({ body: createProblemDraftSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateProblemDraftRequestBody;
    const created = await createProblemDraft({
      problem_id: body.problemId,
      title: body.title,
      author_profile_id: body.authorProfileId,
      author_aka_name: body.authorAkaName,
      author_real_name: body.authorRealName,
      language: body.language,
      country_code: body.countryCode,
      time_limit_ms: body.timeLimitMs,
      memory_limit_mb: body.memoryLimitMb,
      statement_html: body.statementHtml,
      solution_cpp: body.solutionCpp,
      generator_cpp: body.generatorCpp,
      template_version: body.templateVersion,
      created_by: req.user?.id ?? req.session.userId ?? null,
    });
    res.status(201).json(toDraftDetailResponse(created));
  }));

router.get('/admin/authoring/drafts', asyncHandler(async (_req: Request, res: Response) => {
  const drafts = await listProblemDrafts();
  res.json(drafts.map(toDraftSummaryResponse));
}));

router.get('/admin/authoring/drafts/:id',
  validateRequest({ params: problemDraftIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const draft = await getProblemDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ message: 'Problem draft not found' });
      return;
    }
    res.json(toDraftDetailResponse(draft));
  }));

router.patch('/admin/authoring/drafts/:id',
  validateRequest({ params: problemDraftIdParamSchema, body: updateProblemDraftSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { expectedRevision, ...body } = req.body as UpdateProblemDraftRequestBody;
    const result = await updateProblemDraft(
      String(req.params.id),
      expectedRevision,
      toDraftUpdates(body),
    );

    if (result.kind === 'not_found') {
      res.status(404).json({ message: 'Problem draft not found' });
      return;
    }
    if (result.kind === 'published') {
      res.status(409).json({
        message: 'Published problem drafts are read-only',
        code: 'draft_published',
        draft: toDraftDetailResponse(result.draft),
      });
      return;
    }
    if (result.kind === 'revision_conflict') {
      res.status(409).json({
        message: 'Problem draft revision conflict',
        code: 'revision_conflict',
        currentRevision: result.draft.revision,
        draft: toDraftDetailResponse(result.draft),
      });
      return;
    }
    res.json(toDraftDetailResponse(result.draft));
  }));

export default router;
