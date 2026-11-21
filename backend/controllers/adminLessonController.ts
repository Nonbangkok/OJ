import express, { Request, Response, Router } from 'express';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { parseLessonBundleUpload } from '../middleware/upload';
import { validateRequest } from '../middleware/validation';
import {
  lessonImportQuerySchema,
  lessonTrackIdParamsSchema,
  lessonTrackVisibilityBodySchema,
} from '../schemas/requestSchemas';
import { LessonBundleError } from '../services/lessonBundleReader';
import {
  getAdminLessonOverview,
  importLessonBundle,
  previewLessonImport,
  setLessonTrackVisibility,
} from '../services/lessonImportService';
import { isMaintenanceActive } from '../services/maintenanceMode';
import { logger } from '../utils/logger';

/** Manage › Lessons (staff/admin): overview, bundle import, track visibility — spec §6. */
const router: Router = express.Router();

router.get('/admin/lessons', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAdminLessonOverview());
}));

router.post('/admin/lessons/import', requireAuth, requireStaffOrAdmin,
  validateRequest({ query: lessonImportQuerySchema }),
  parseLessonBundleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (isMaintenanceActive()) throw new AppError('A database import is running. Try again when it has finished.', 409);
    if (!req.file) throw new AppError('No lessons bundle uploaded.', 400);
    const { dryRun, confirmRemovals } = req.query as unknown as { dryRun: boolean; confirmRemovals: boolean };

    try {
      if (dryRun) {
        res.json({ dryRun: true, plan: await previewLessonImport(req.file.buffer) });
        return;
      }
      const result = await importLessonBundle(req.file.buffer, { userId: req.user!.id, confirmRemovals });
      if (result.kind === 'invalid') {
        res.status(400).json({ message: 'The bundle has problems, so nothing was imported.', plan: result.plan });
        return;
      }
      if (result.kind === 'needs_confirmation') {
        res.status(409).json({
          message: 'This import deletes lessons that learners have completed. Confirm the removals to continue.',
          plan: result.plan,
        });
        return;
      }
      const { lessons } = result.plan;
      logger.info('lessons imported', {
        importId: result.importId, userId: req.user!.id, bundle: result.plan.bundleSha256,
        added: lessons.added.length, changed: lessons.changed.length, removed: lessons.removed.length,
      });
      res.json({ importId: result.importId, plan: result.plan });
    } catch (error) {
      if (error instanceof LessonBundleError) throw new AppError(error.message, 400);
      throw error;
    }
  }));

router.patch('/admin/lessons/tracks/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: lessonTrackIdParamsSchema, body: lessonTrackVisibilityBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { isVisible } = req.body as { isVisible: boolean };
    if (!await setLessonTrackVisibility(id, isVisible)) throw new AppError('Track not found.', 404);
    res.json({ id, isVisible });
  }));

export default router;
