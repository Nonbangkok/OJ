import express, { Request, Response, Router } from 'express';
import { requireStaffOrAdmin } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  analyticsOverviewQuerySchema,
  analyticsProblemIdParamSchema,
  analyticsProblemsQuerySchema,
  analyticsUserIdParamSchema,
  analyticsUsersQuerySchema,
  analyticsContestIdParamSchema,
} from '../schemas/requestSchemas';
import {
  getContestAnalytics,
  getOverviewAnalytics,
  getProblemAnalytics,
  getUserAnalytics,
  listProblemsForAnalytics,
  listUsersForAnalytics,
} from '../services/analyticsQueryService';

const router: Router = express.Router();

interface OverviewQuery { days?: number }
interface UsersQuery { search: string; limit: number; offset: number; sortBy: string; sortDir: string }
interface ProblemsQuery { search: string; limit: number; offset: number; sortBy: string; sortDir: string }
interface UserIdParams { userId: number }
interface ProblemIdParams { problemId: string }
interface ContestIdParams { contestId: number }

router.get('/analytics/overview', requireStaffOrAdmin,
  validateRequest({ query: analyticsOverviewQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const days = (req.query as unknown as OverviewQuery).days ?? 30;
    res.json(await getOverviewAnalytics(Number(days)));
  }));

router.get('/analytics/users', requireStaffOrAdmin,
  validateRequest({ query: analyticsUsersQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // Zod defaults are not written back to req.query by validateRequest, so
    // apply the same defaults here (schema values: search '', limit 50, offset 0,
    // sortBy 'submissions', sortDir 'desc').
    const raw = req.query as Partial<Record<keyof UsersQuery, string>>;
    const search = raw.search ?? '';
    const limit = raw.limit !== undefined ? Number(raw.limit) : 50;
    const offset = raw.offset !== undefined ? Number(raw.offset) : 0;
    const sortBy = raw.sortBy ?? 'submissions';
    const sortDir = raw.sortDir ?? 'desc';
    const users = await listUsersForAnalytics(
      search, limit, offset,
      sortBy as Parameters<typeof listUsersForAnalytics>[3],
      sortDir as 'asc' | 'desc',
    );
    res.json({ users });
  }));

router.get('/analytics/problems', requireStaffOrAdmin,
  validateRequest({ query: analyticsProblemsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.query as Partial<Record<keyof ProblemsQuery, string>>;
    const search = raw.search ?? '';
    const limit = raw.limit !== undefined ? Number(raw.limit) : 50;
    const offset = raw.offset !== undefined ? Number(raw.offset) : 0;
    const sortBy = raw.sortBy ?? 'submissions';
    const sortDir = raw.sortDir ?? 'desc';
    const problems = await listProblemsForAnalytics(
      search, limit, offset,
      sortBy as Parameters<typeof listProblemsForAnalytics>[3],
      sortDir as 'asc' | 'desc',
    );
    res.json({ problems });
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

router.get('/analytics/contests/:contestId', requireStaffOrAdmin,
  validateRequest({ params: analyticsContestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { contestId } = req.params as unknown as ContestIdParams;
    const analytics = await getContestAnalytics(Number(contestId));
    if (!analytics) {
      throw new AppError('Contest not found', 404);
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
