import { Router } from 'express';
import { z } from 'zod';
import { AUTHORING_VALIDATION } from '../constants';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { draftAssetParamsSchema, problemDraftIdParamSchema } from '../schemas/requestSchemas';
import { StatementError } from '../authoring/statementSanitizer';
import { getWorkspaceAsset, listWorkspaceJobs, previewWorkspaceStatement } from '../services/authoringWorkspaceService';

const router = Router();
const previewSchema = z.object({ statementHtml: z.string().refine(
  value => Buffer.byteLength(value, 'utf8') <= AUTHORING_VALIDATION.MAX_SOURCE_BYTES,
  { message: 'Statement exceeds 2 MiB' },
) }).strict();
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

router.get('/admin/authoring/drafts/:id/jobs', requireAuth, requireAdmin,
  validateRequest({ params: problemDraftIdParamSchema }), asyncHandler(async (req, res) => {
    const jobs = await listWorkspaceJobs(String(req.params.id));
    if (!jobs) { res.status(404).json({ code: 'draft_not_found', message: 'Problem draft not found' }); return; }
    res.set(privateHeaders).json(jobs);
  }));

router.post('/admin/authoring/drafts/:id/preview', requireAuth, requireAdmin,
  validateRequest({ params: problemDraftIdParamSchema, body: previewSchema }), asyncHandler(async (req, res) => {
    try {
      const html = await previewWorkspaceStatement(String(req.params.id), req.body.statementHtml);
      if (html === null) { res.status(404).json({ code: 'draft_not_found', message: 'Problem draft not found' }); return; }
      res.set(privateHeaders).json({ html });
    } catch (error) {
      if (!(error instanceof StatementError)) throw error;
      res.status(400).json({ code: error.code, message: error.message });
    }
  }));

router.get('/admin/authoring/drafts/:id/assets/:assetId', requireAuth, requireAdmin,
  validateRequest({ params: draftAssetParamsSchema }), asyncHandler(async (req, res) => {
    try {
      const asset = await getWorkspaceAsset(String(req.params.id), String(req.params.assetId));
      if (!asset) { res.status(404).json({ code: 'asset_not_found', message: 'Statement asset not found' }); return; }
      res.set({ ...privateHeaders, 'Content-Type': asset.mime_type,
        'Content-Security-Policy': "default-src 'none'; sandbox" }).send(asset.content);
    } catch (error) {
      if (!(error instanceof StatementError)) throw error;
      res.status(400).json({ code: error.code, message: error.message });
    }
  }));

export default router;
