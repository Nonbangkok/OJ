import express, { Request, Response, Router } from 'express';
import { STATEMENT_ASSET } from '../constants';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { statementAssetUpload } from '../middleware/upload';
import { validateRequest } from '../middleware/validation';
import {
  createProblemDraftSchema,
  createStatementAssetSchema,
  deleteStatementAssetQuerySchema,
  draftAssetParamsSchema,
  listProblemDraftsQuerySchema,
  problemDraftIdParamSchema,
  refreshProblemDraftAuthorSchema,
  updateProblemDraftSchema,
  expectedRevisionSchema,
} from '../schemas/requestSchemas';
import { publishProblemDraft } from '../services/authoringPublishService';
import {
  createProblemDraft,
  deleteProblemDraft,
  getProblemDraft,
  listProblemDrafts,
  ProblemDraftListRow,
  ProblemDraftUpdates,
  startProblemDraftRevision,
  updateProblemDraft,
} from '../services/authoringDraftQueryService';
import { getDraftTestcaseStats } from '../services/authoringTestcaseQueryService';
import {
  addStatementAsset,
  deleteStatementAsset,
  listStatementAssets,
  StatementAssetMetadataRow,
} from '../services/authoringAssetQueryService';
import {
  AuthorProfileSnapshot,
  createManualAuthorSnapshot,
  getAuthorProfileSnapshot,
  refreshProblemDraftAuthor,
} from '../services/authorProfileSnapshotService';
import { prepareStatementAsset } from '../services/statementAssetService';
import {
  CreateStatementAssetRequestBody,
  DeleteStatementAssetQuery,
  CreateProblemDraftRequestBody,
  RefreshProblemDraftAuthorRequestBody,
  UpdateProblemDraftRequestBody,
} from '../types/api';
import { ProblemDraftRow } from '../types/authoring';

const router: Router = express.Router();

const toDraftSummaryResponse = (draft: ProblemDraftListRow) => ({
  id: draft.id,
  problemId: draft.problem_id,
  title: draft.title,
  authorProfileId: draft.author_profile_id,
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
  categories: draft.categories,
  difficulty: draft.difficulty,
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

const toAssetResponse = (asset: StatementAssetMetadataRow) => ({
  id: asset.id,
  draftId: asset.draft_id,
  filename: asset.filename,
  mimeType: asset.mime_type,
  checksumSha256: asset.checksum_sha256,
  sizeBytes: Number(asset.size_bytes),
  createdAt: asset.created_at,
  updatedAt: asset.updated_at,
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
  ...(body.categories !== undefined ? { categories: body.categories } : {}),
  ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
  ...(body.timeLimitMs !== undefined ? { time_limit_ms: body.timeLimitMs } : {}),
  ...(body.memoryLimitMb !== undefined ? { memory_limit_mb: body.memoryLimitMb } : {}),
  ...(body.statementHtml !== undefined ? { statement_html: body.statementHtml } : {}),
  ...(body.solutionCpp !== undefined ? { solution_cpp: body.solutionCpp } : {}),
  ...(body.generatorCpp !== undefined ? { generator_cpp: body.generatorCpp } : {}),
  ...(body.templateVersion !== undefined ? { template_version: body.templateVersion } : {}),
});

const resolveCreateAuthorSnapshot = async (
  body: CreateProblemDraftRequestBody,
): Promise<AuthorProfileSnapshot> => {
  if (body.authorProfileId) {
    const result = await getAuthorProfileSnapshot(body.authorProfileId);
    if (result.kind === 'profile_not_found') {
      throw new AppError('Author profile not found', 404);
    }
    return result.snapshot;
  }

  if (!body.authorAkaName || !body.authorRealName || !body.language || !body.countryCode) {
    throw new AppError('Manual author display fields are required', 400);
  }
  return createManualAuthorSnapshot({
    author_aka_name: body.authorAkaName,
    author_real_name: body.authorRealName,
    language: body.language,
    country_code: body.countryCode,
  });
};

router.use('/admin/authoring/drafts', requireAuth, requireStaffOrAdmin);

/**
 * Shared result-kind → response mapping for draft mutations. Each entry maps a
 * service result kind to [status, message, responseCode]; the response is
 * augmented with the draft/currentRevision context the service result carries.
 * Returns true (and responds) when the result's kind has a mapping, so callers
 * can `return` immediately and treat the remainder as their success kind.
 */
const DRAFT_NOT_FOUND: readonly [number, string, string] = [404, 'Problem draft not found', ''];
const DRAFT_PUBLISHED: readonly [number, string, string] = [409, 'Published problem drafts are read-only', 'draft_published'];
const DRAFT_REVISION_CONFLICT: readonly [number, string, string] = [409, 'Problem draft revision conflict', 'revision_conflict'];

const sendDraftResult = (
  res: Response,
  result: { kind: string; draft?: ProblemDraftRow },
  mappings: Record<string, readonly [number, string, string] | undefined>,
): boolean => {
  const mapping = mappings[result.kind];
  if (!mapping) {
    return false;
  }
  const [status, message, code] = mapping;
  const draft = result.draft ? toDraftDetailResponse(result.draft) : undefined;
  const currentRevision = result.draft?.revision;
  if (code === 'draft_published') {
    res.status(status).json({ message, code, ...(draft === undefined ? {} : { draft }) });
    return true;
  }
  if (code === 'revision_conflict') {
    res.status(status).json({ message, code, currentRevision, ...(draft === undefined ? {} : { draft }) });
    return true;
  }
  res.status(status).json({ message });
  return true;
};

/**
 * After sendDraftResult and the route's kind-specific failures, the remainder
 * is by construction the single success kind; cast it once here instead of at
 * every call site.
 */
const draftSuccess = <T extends { kind: string; draft: ProblemDraftRow }>(result: unknown): T =>
  result as T;

router.post('/admin/authoring/drafts/:id/publish',
  validateRequest({ params: problemDraftIdParamSchema, body: expectedRevisionSchema }),
  asyncHandler(async (req, res) => {
    const result = await publishProblemDraft(String(req.params.id), req.body.expectedRevision);
    if (result.kind === 'created' || result.kind === 'updated') {
      const { kind: _kind, ...published } = result;
      res.status(result.kind === 'created' ? 201 : 200).json({ ...published, status: 'published' }); return;
    }
    const errors = {
      not_found: ['draft_not_found', 'Problem draft not found'],
      published: ['draft_published', 'Published problem drafts are read-only'],
      revision_conflict: ['revision_conflict', 'Problem draft revision conflict'],
      not_ready: ['draft_not_ready', 'Verify the current draft revision before publishing'],
      pdf_not_verified: ['pdf_not_verified', 'The current PDF does not match successful verification'],
      invalid_testcases: ['invalid_testcases', 'Stored testcase pairs do not match successful verification'],
      busy: ['job_active', 'Wait for the active authoring job before publishing'],
      problem_id_conflict: ['problem_id_conflict', 'A problem with this ID already exists; nothing was overwritten'],
      published_problem_missing: ['published_problem_missing', 'The original published problem is missing; nothing was updated'],
      published_problem_mismatch: ['published_problem_mismatch', 'The original published problem changed outside authoring; nothing was updated'],
      published_problem_provenance_missing: ['published_problem_provenance_missing', 'The original publication cannot be matched safely; nothing was updated'],
    } as const;
    const [code, message] = errors[result.kind];
    const currentRevision = 'currentRevision' in result ? result.currentRevision : undefined;
    res.status(result.kind === 'not_found' ? 404 : 409).json({ code, message,
      ...(currentRevision === undefined ? {} : { currentRevision }) });
  }));

router.post('/admin/authoring/drafts',
  validateRequest({ body: createProblemDraftSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateProblemDraftRequestBody;
    const authorSnapshot = await resolveCreateAuthorSnapshot(body);
    const created = await createProblemDraft({
      problem_id: body.problemId,
      title: body.title,
      ...authorSnapshot,
      categories: [...body.categories ?? []],
      difficulty: body.difficulty ?? null,
      time_limit_ms: body.timeLimitMs,
      memory_limit_mb: body.memoryLimitMb,
      statement_html: body.statementHtml,
      solution_cpp: body.solutionCpp,
      generator_cpp: body.generatorCpp,
      template_version: body.templateVersion,
      created_by: req.user?.id ?? null,
    });
    res.status(201).json(toDraftDetailResponse(created));
  }));

router.get('/admin/authoring/drafts',
  validateRequest({ query: listProblemDraftsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // `scope=mine` matches the logged-in username against Author Profile AKA
    // names — see listProblemDrafts for the exact-normalized semantics.
    const query = req.query as { scope: 'all' | 'mine' };
    const drafts = await listProblemDrafts({
      scope: query.scope,
      username: query.scope === 'mine' ? req.user?.username : undefined,
    });
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
    // Checklist facts come from the testcase table itself, not the draft
    // status lifecycle — a reset (e.g. a fresh verify run) must not make
    // existing testcases disappear from the publish readiness view.
    const testcaseStats = await getDraftTestcaseStats(draft.id);
    res.json({ ...toDraftDetailResponse(draft), testcaseStats });
  }));

router.delete('/admin/authoring/drafts/:id',
  validateRequest({ params: problemDraftIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await deleteProblemDraft(String(req.params.id));
    if (result.kind === 'not_found') {
      res.status(404).json({ message: 'Problem draft not found' });
      return;
    }
    res.json({
      message: 'Authoring draft deleted',
      problemId: result.draft.problem_id,
      wasPublished: result.wasPublished,
    });
  }));

router.patch('/admin/authoring/drafts/:id',
  validateRequest({ params: problemDraftIdParamSchema, body: updateProblemDraftSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { expectedRevision, ...body } = req.body as UpdateProblemDraftRequestBody;
    let updates = toDraftUpdates(body);
    if (body.authorProfileId) {
      const snapshotResult = await getAuthorProfileSnapshot(body.authorProfileId);
      if (snapshotResult.kind === 'profile_not_found') {
        throw new AppError('Author profile not found', 404);
      }
      updates = { ...updates, ...snapshotResult.snapshot };
    }
    const result = await updateProblemDraft(
      String(req.params.id),
      expectedRevision,
      updates,
    );

    if (sendDraftResult(res, result, {
      not_found: DRAFT_NOT_FOUND,
      published: DRAFT_PUBLISHED,
      revision_conflict: DRAFT_REVISION_CONFLICT,
    })) {
      return;
    }
    if (result.kind === 'published_problem_id_locked') {
      res.status(409).json({
        message: 'Problem ID is locked after the first publication',
        code: 'published_problem_id_locked',
        draft: toDraftDetailResponse(result.draft),
      });
      return;
    }
    const updated = draftSuccess<{ kind: 'updated'; draft: ProblemDraftRow }>(result);
    res.json(toDraftDetailResponse(updated.draft));
  }));

router.post('/admin/authoring/drafts/:id/refresh-author-profile',
  validateRequest({ params: problemDraftIdParamSchema, body: refreshProblemDraftAuthorSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { expectedRevision } = req.body as RefreshProblemDraftAuthorRequestBody;
    const result = await refreshProblemDraftAuthor(String(req.params.id), expectedRevision);

    if (sendDraftResult(res, result, {
      not_found: DRAFT_NOT_FOUND,
      published: DRAFT_PUBLISHED,
      revision_conflict: DRAFT_REVISION_CONFLICT,
    })) {
      return;
    }
    if (result.kind === 'profile_not_selected') {
      res.status(409).json({
        message: 'Problem draft has no linked author profile',
        code: 'author_profile_not_selected',
      });
      return;
    }
    if (result.kind === 'profile_not_found') {
      res.status(409).json({
        message: 'The linked author profile no longer exists',
        code: 'author_profile_missing',
      });
      return;
    }
    const refreshed = draftSuccess<{ kind: 'updated'; draft: ProblemDraftRow }>(result);
    res.json(toDraftDetailResponse(refreshed.draft));
  }));

router.post('/admin/authoring/drafts/:id/new-revision',
  validateRequest({ params: problemDraftIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await startProblemDraftRevision(String(req.params.id));

    if (sendDraftResult(res, result, {
      not_found: DRAFT_NOT_FOUND,
    })) {
      return;
    }
    if (result.kind === 'not_published') {
      res.status(409).json({
        message: 'Only published drafts can start a new revision',
        code: 'draft_not_published',
        draft: toDraftDetailResponse(result.draft),
      });
      return;
    }
    const reopened = draftSuccess<{ kind: 'updated'; draft: ProblemDraftRow }>(result);
    res.json(toDraftDetailResponse(reopened.draft));
  }));

router.get('/admin/authoring/drafts/:id/assets',
  validateRequest({ params: problemDraftIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await listStatementAssets(String(req.params.id));
    if (result.kind === 'not_found') {
      res.status(404).json({ message: 'Problem draft not found' });
      return;
    }
    res.json(result.assets.map(toAssetResponse));
  }));

router.post('/admin/authoring/drafts/:id/assets',
  statementAssetUpload.single(STATEMENT_ASSET.FIELD_NAME),
  validateRequest({ params: problemDraftIdParamSchema, body: createStatementAssetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('Statement asset file is required', 400);
    }
    const body = req.body as CreateStatementAssetRequestBody;
    let preparedAsset;
    try {
      preparedAsset = await prepareStatementAsset(
        body.filename ?? req.file.originalname,
        req.file.buffer,
        req.file.mimetype,
      );
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Invalid statement asset image',
        400,
      );
    }

    const result = await addStatementAsset(
      String(req.params.id),
      body.expectedRevision,
      preparedAsset,
    );
    if (sendDraftResult(res, result, {
      not_found: DRAFT_NOT_FOUND,
      published: DRAFT_PUBLISHED,
      revision_conflict: DRAFT_REVISION_CONFLICT,
    })) {
      return;
    }
    if (result.kind === 'duplicate_filename') {
      res.status(409).json({
        message: 'A statement asset with this filename already exists',
        code: 'asset_filename_conflict',
      });
      return;
    }
    if (result.kind === 'total_size_exceeded') {
      res.status(413).json({
        message: `Statement assets must not exceed ${STATEMENT_ASSET.MAX_TOTAL_MIB} MiB per draft`,
        code: 'asset_total_size_exceeded',
      });
      return;
    }
    const added = draftSuccess<{ kind: 'added'; draft: ProblemDraftRow; asset: StatementAssetMetadataRow }>(result);
    res.status(201).json({
      asset: toAssetResponse(added.asset),
      draftRevision: added.draft.revision,
    });
  }));

router.delete('/admin/authoring/drafts/:id/assets/:assetId',
  validateRequest({ params: draftAssetParamsSchema, query: deleteStatementAssetQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as DeleteStatementAssetQuery;
    const result = await deleteStatementAsset(
      String(req.params.id),
      String(req.params.assetId),
      Number(query.expectedRevision),
    );
    if (sendDraftResult(res, result, {
      not_found: DRAFT_NOT_FOUND,
      published: DRAFT_PUBLISHED,
      revision_conflict: DRAFT_REVISION_CONFLICT,
    })) {
      return;
    }
    if (result.kind === 'asset_not_found') {
      res.status(404).json({ message: 'Statement asset not found' });
      return;
    }
    const deleted = draftSuccess<{ kind: 'deleted'; draft: ProblemDraftRow; asset: StatementAssetMetadataRow }>(result);
    res.json({
      asset: toAssetResponse(deleted.asset),
      draftRevision: deleted.draft.revision,
    });
  }));

export default router;
