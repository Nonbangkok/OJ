import express, { Request, Response, Router } from 'express';
import { requireStaffOrAdmin } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  analyticsOverviewQuerySchema,
  analyticsProblemIdParamSchema,
  analyticsUserIdParamSchema,
  analyticsUsersQuerySchema,
} from '../schemas/requestSchemas';
import {
  getOverviewAnalytics,
  getProblemAnalytics,
  getUserAnalytics,
  listUsersForAnalytics,
} from '../services/analyticsQueryService';

const router: Router = express.Router();

interface OverviewQuery { days?: number }
interface UsersQuery { search: string; limit: number; offset: number }
interface UserIdParams { userId: number }
interface ProblemIdParams { problemId: string }

router.get('/analytics/overview', requireStaffOrAdmin,
  validateRequest({ query: analyticsOverviewQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const days = (req.query as unknown as OverviewQuery).days ?? 30;
    res.json(await getOverviewAnalytics(Number(days)));
  }));

router.get('/analytics/users', requireStaffOrAdmin,
  validateRequest({ query: analyticsUsersQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { search, limit, offset } = req.query as unknown as UsersQuery;
    const users = await listUsersForAnalytics(search, Number(limit), Number(offset));
    res.json({ users });
  }));

router.get('/analytics/users/:userId', requireStaffOrAdmin,
  validateRequest({ params: analyticsUserIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as unknown as UserIdParams;
    const analytics = await getUserAnalytics(Number(userId));
    if (!analytics) {
      throw new AppError('User not found', 404);
    }
    res.json(analytics);
  }));

router.get('/analytics/problems/:problemId', requireStaffOrAdmin,
  validateRequest({ params: analyticsProblemIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { problemId } = req.params as unknown as ProblemIdParams;
    const analytics = await getProblemAnalytics(problemId);
    if (!analytics) {
      throw new AppError('Problem not found', 404);
    }
    res.json(analytics);
  }));

export default router;
