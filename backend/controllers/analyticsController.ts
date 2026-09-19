import express, { Request, Response, Router } from 'express';
import { requireStaffOrAdmin } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { SUBMISSION_QUERY_CONFIG } from '../constants';
import { buildCsvFileName, toCsv } from '../utils/csv';
import {
  analyticsOverviewQuerySchema,
  analyticsProblemIdParamSchema,
  analyticsProblemsQuerySchema,
  analyticsUserIdParamSchema,
  analyticsUsersQuerySchema,
  analyticsContestIdParamSchema,
  analyticsSubmissionsQuerySchema,
  analyticsExportQuerySchema,
  analyticsRetentionQuerySchema,
} from '../schemas/requestSchemas';
import {
  getContestAnalytics,
  getOverviewAnalytics,
  getRetentionAnalytics,
  getProblemAnalytics,
  getUserAnalytics,
  listProblemsForAnalytics,
  listSubmissionsForAnalytics,
  listUsersForAnalytics,
} from '../services/analyticsQueryService';

const router: Router = express.Router();

interface OverviewQuery { days?: number }
interface UsersQuery { search: string; limit: number; offset: number; sortBy: string; sortDir: string }
interface ProblemsQuery { search: string; limit: number; offset: number; sortBy: string; sortDir: string }
/** Shape after Zod coercion + defaults (validateRequest writes them back). */
interface SubmissionsQuery { problemId?: string; userId?: number; verdict?: string; limit: number; offset: number }
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
    // validateRequest writes Zod defaults back into req.query, so the raw
    // cast carries the schema defaults (search '', limit 50, offset 0,
    // sortBy 'submissions', sortDir 'desc').
    const raw = req.query as unknown as UsersQuery;
    const users = await listUsersForAnalytics(
      raw.search, raw.limit, raw.offset,
      raw.sortBy as Parameters<typeof listUsersForAnalytics>[3],
      raw.sortDir as 'asc' | 'desc',
    );
    res.json({ users });
  }));

router.get('/analytics/problems', requireStaffOrAdmin,
  validateRequest({ query: analyticsProblemsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.query as unknown as ProblemsQuery;
    const problems = await listProblemsForAnalytics(
      raw.search, raw.limit, raw.offset,
      raw.sortBy as Parameters<typeof listProblemsForAnalytics>[3],
      raw.sortDir as 'asc' | 'desc',
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

router.get('/analytics/submissions', requireStaffOrAdmin,
  validateRequest({ query: analyticsSubmissionsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.query as unknown as SubmissionsQuery;
    const submissions = await listSubmissionsForAnalytics(
      {
        problemId: raw.problemId,
        userId: raw.userId,
        verdict: raw.verdict,
      },
      raw.limit,
      raw.offset,
    );
    res.json({ submissions });
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

router.get('/analytics/retention', requireStaffOrAdmin,
  validateRequest({ query: analyticsRetentionQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { idleDays } = req.query as unknown as { idleDays: number };
    res.json(await getRetentionAnalytics(idleDays));
  }));

/**
 * CSV export of the analysis tab datasets (users / problems / submissions).
 * Applies the same search/filter parameters as the interactive tabs and the
 * same query services, so the file always matches what staff see on screen.
 */
router.get('/analytics/export', requireStaffOrAdmin,
  validateRequest({ query: analyticsExportQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.query as Partial<Record<string, string>> & { type: 'users' | 'problems' | 'submissions' };

    let csv: string;
    if (raw.type === 'users') {
      const users = await listUsersForAnalytics(
        raw.search ?? '',
        SUBMISSION_QUERY_CONFIG.EXPORT_MAX_ROWS,
        0,
        (raw.sortBy ?? 'submissions') as Parameters<typeof listUsersForAnalytics>[3],
        (raw.sortDir ?? 'desc') as 'asc' | 'desc',
      );
      csv = toCsv(
        ['userId', 'username', 'role', 'submissions', 'solved', 'acRate', 'lastActive'],
        users.map((u) => [u.userId, u.username, u.role, u.submissions, u.solved, u.acRate, u.lastActive]),
      );
    } else if (raw.type === 'problems') {
      const problems = await listProblemsForAnalytics(
        raw.search ?? '',
        SUBMISSION_QUERY_CONFIG.EXPORT_MAX_ROWS,
        0,
        (raw.sortBy ?? 'submissions') as Parameters<typeof listProblemsForAnalytics>[3],
        (raw.sortDir ?? 'desc') as 'asc' | 'desc',
      );
      csv = toCsv(
        ['problemId', 'title', 'category', 'submissions', 'accepted', 'acRate', 'solvers'],
        problems.map((p) => [p.problemId, p.title, p.category, p.submissions, p.accepted, p.acRate, p.solvers]),
      );
    } else {
      const submissions = await listSubmissionsForAnalytics(
        {
          problemId: raw.problemId,
          userId: raw.userId !== undefined ? Number(raw.userId) : undefined,
          verdict: raw.verdict,
        },
        SUBMISSION_QUERY_CONFIG.EXPORT_MAX_ROWS,
        0,
      );
      csv = toCsv(
        ['id', 'source', 'problemId', 'problemTitle', 'username', 'verdict', 'score', 'language', 'timeMs', 'memoryKb', 'submittedAt'],
        submissions.map((s) => [
          s.id, s.source, s.problemId, s.problemTitle, s.username, s.verdict,
          s.score, s.language, s.timeMs, s.memoryKb, s.submittedAt,
        ]),
      );
    }

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${buildCsvFileName(raw.type)}"`,
      'Cache-Control': 'no-store',
    });
    res.send(csv);
  }));

export default router;
