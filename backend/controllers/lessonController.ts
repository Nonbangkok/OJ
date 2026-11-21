import express, { Request, Response, Router } from 'express';
import { USER_ROLES } from '../constants';
import { requireAuth } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { requirePublicAccess } from '../middleware/siteAccess';
import { validateRequest } from '../middleware/validation';
import {
  learnLessonAssetParamsSchema,
  learnLessonParamsSchema,
  learnTrackParamsSchema,
  lessonProgressBodySchema,
} from '../schemas/requestSchemas';
import {
  findVisibleLessonId,
  getLearnLesson,
  getLearnTrack,
  getLearnTracks,
  getLessonAsset,
  setLessonCompleted,
  type LearnViewer,
} from '../services/lessonQueryService';

/**
 * Learn (lessons) read API and per-user progress — spec §6.
 * Guests read in PUBLIC mode like problem statements; hidden tracks 404 for
 * everyone but staff.
 */
const router: Router = express.Router();

const viewerOf = (req: Request): LearnViewer => ({
  userId: req.user?.id ?? null,
  isStaff: req.user?.role === USER_ROLES.ADMIN || req.user?.role === USER_ROLES.STAFF,
});

router.get('/learn/tracks', requirePublicAccess, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getLearnTracks(viewerOf(req)));
}));

router.get('/learn/tracks/:trackSlug', requirePublicAccess,
  validateRequest({ params: learnTrackParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const track = await getLearnTrack(String(req.params.trackSlug), viewerOf(req));
    if (!track) throw new AppError('Track not found.', 404);
    res.json(track);
  }));

router.get('/learn/lessons/:lessonSlug', requirePublicAccess,
  validateRequest({ params: learnLessonParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const lesson = await getLearnLesson(String(req.params.lessonSlug), viewerOf(req));
    if (!lesson) throw new AppError('Lesson not found.', 404);
    res.json(lesson);
  }));

router.get('/learn/lessons/:lessonSlug/assets/:name', requirePublicAccess,
  validateRequest({ params: learnLessonAssetParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const asset = await getLessonAsset(String(req.params.lessonSlug), String(req.params.name), viewerOf(req));
    if (!asset) throw new AppError('Asset not found.', 404);
    res.setHeader('Content-Type', asset.mimeType);
    // Images only (checked by magic bytes at import); never sniffed or run as a document.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(asset.data);
  }));

router.put('/learn/lessons/:lessonSlug/progress', requireAuth,
  validateRequest({ params: learnLessonParamsSchema, body: lessonProgressBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const viewer = viewerOf(req);
    const lessonId = await findVisibleLessonId(String(req.params.lessonSlug), viewer);
    if (lessonId === null) throw new AppError('Lesson not found.', 404);
    const completed = (req.body as { completed: boolean }).completed;
    const completedAt = await setLessonCompleted(req.user!.id, lessonId, completed);
    res.json({ completed, completedAt });
  }));

export default router;
