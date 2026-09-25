import express, { Request, Response, Router } from 'express';
import { USER_AVATAR } from '../constants';
import { requireAuth } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { userAvatarUpload } from '../middleware/upload';
import { validateRequest } from '../middleware/validation';
import { usernameParamSchema } from '../schemas/requestSchemas';
import { normalizeUserAvatar } from '../services/userAvatarImageService';
import { getUserAvatar, getUserProfileStats, updateUserAvatar } from '../services/userProfileQueryService';

const router: Router = express.Router();

const AVATAR_CACHE_SECONDS = 300;

const normalizeUpload = async (file: Express.Multer.File): Promise<Buffer> => {
  try {
    return await normalizeUserAvatar(file.buffer, file.mimetype);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid user avatar image';
    throw new AppError(message, 400);
  }
};

router.get('/users/:username/profile',
  validateRequest({ params: usernameParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await getUserProfileStats(String(req.params.username));
    if (!stats) {
      throw new AppError('User not found', 404);
    }

    res.json({
      id: stats.id,
      username: stats.username,
      role: stats.role,
      hasAvatar: stats.has_avatar,
      avatarUpdatedAt: stats.avatar_updated_at,
      createdAt: stats.created_at,
      problemsAttempted: stats.problems_attempted,
      problemsSolved: stats.problems_solved,
      totalScore: stats.total_score,
      submissionCount: stats.submission_count,
      verdictCounts: stats.verdict_counts,
      languageCounts: stats.language_counts,
      dailyActivity: stats.daily_activity,
      currentStreak: stats.current_streak,
      longestStreak: stats.longest_streak,
      lastAcDate: stats.last_ac_date,
      achievements: stats.achievements,
      categoryStats: stats.categoryStats,
      progression: stats.progression,
      recentRewards: stats.recentRewards,
    });
  }));

router.get('/users/:username/avatar',
  validateRequest({ params: usernameParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const avatar = await getUserAvatar(String(req.params.username));
    if (!avatar?.avatar_png) {
      throw new AppError('Avatar not found', 404);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', `private, max-age=${AVATAR_CACHE_SECONDS}`);
    if (avatar.avatar_updated_at) {
      res.setHeader('Last-Modified', avatar.avatar_updated_at.toUTCString());
    }
    res.send(avatar.avatar_png);
  }));

router.put('/profile/avatar',
  requireAuth,
  userAvatarUpload.single(USER_AVATAR.FIELD_NAME),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('Avatar image is required', 400);
    }

    const avatarPng = await normalizeUpload(req.file);
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }
    const result = await updateUserAvatar(userId, avatarPng);
    req.session.hasAvatar = true;
    req.session.save(() => undefined);

    res.json({
      message: 'Avatar updated',
      avatarUpdatedAt: result.avatar_updated_at,
    });
  }));

export default router;
