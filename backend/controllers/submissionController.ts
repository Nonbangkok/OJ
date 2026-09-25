import express, { Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePublicAccess } from '../middleware/siteAccess';
import { memoryUpload } from '../middleware/upload';
import { processContestSubmission, processSubmission } from '../services/submissionService';
import { USER_ROLES } from '../constants';
import {
  getGlobalScoreboard,
  getSubmissionDetail,
  getSubmissions,
  searchProblems,
  searchUsers,
  validateAndQueueSubmission,
} from '../services/submissionQueryService';
import {
  MessageResponse,
  SearchQuery,
  SubmissionListQuery,
  SubmitRequestBody,
  SubmitSuccessResponse,
} from '../types/api';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { submitLimiter } from '../middleware/rateLimit';
import { enqueueJudgeTask } from '../services/judgeQueue';
import {
  idParamSchema,
  searchQuerySchema,
  submissionDetailQuerySchema,
  submissionsQuerySchema,
  submitSchema,
} from '../schemas/requestSchemas';
import { ContestSubmissionDetailRow, SubmissionDetailRow } from '../types/models';

const router: Router = express.Router();

router.post(
  '/submit',
  submitLimiter,
  requireAuth,
  memoryUpload.none(),
  validateRequest({ body: submitSchema }),
  asyncHandler(async (req: Request, res: Response<SubmitSuccessResponse | MessageResponse>) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const submissionPayload = req.body as SubmitRequestBody;
    const queueResult = await validateAndQueueSubmission(submissionPayload, userId);

    res.status(202).json({
      message: queueResult.isContestSubmission
        ? 'Contest submission received and is being processed.'
        : 'Submission received and is being processed.',
      submissionId: queueResult.submissionId,
      isContestSubmission: queueResult.isContestSubmission,
    });

    // Dispatch the actual compile/run work through the judge concurrency gate so
    // that at most JUDGE_CONFIG.MAX_CONCURRENT_JUDGES run at once; excess queue.
    if (queueResult.isContestSubmission) {
      enqueueJudgeTask(() => processContestSubmission(queueResult.submissionId));
      return;
    }

    enqueueJudgeTask(() => processSubmission(queueResult.submissionId));
  }),
);

router.get(
  '/submissions',
  // PUBLIC mode: guests may read the sanitized public feed (the list DTO
  // carries no source code, logs, or private metadata — those live behind
  // /submissions/:id which stays requireAuth). PRIVATE mode: 401 for guests.
  requirePublicAccess,
  validateRequest({ query: submissionsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id ?? null;
    const role = req.user?.role;

    // Guest context: the public feed only. Personal filters and the
    // staff-only problem/user filters are meaningless without a user.
    const isStaffOrAdmin = !!userId
      && (role === USER_ROLES.ADMIN || role === USER_ROLES.STAFF);
    const submissions = await getSubmissions(
      req.query as SubmissionListQuery,
      userId ?? 0,
      isStaffOrAdmin,
    );
    res.json(submissions);
  }),
);

router.get(
  '/search/problems',
  requireAuth,
  validateRequest({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, contestId } = req.query as SearchQuery;
    if (!q) {
      res.json([]);
      return;
    }

    // Server-side role enforcement: the filter UI is staff/admin-only, but
    // the endpoint itself is reachable by every authenticated user, so the
    // visibility predicate must not trust the client (PROBLEM-001).
    const { userId, role } = req.session;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const problems = await searchProblems(q, { userId, role: role ?? USER_ROLES.USER }, contestId);
    res.json(problems);
  }),
);

router.get(
  '/search/users',
  requireAuth,
  validateRequest({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, contestId } = req.query as SearchQuery;
    if (!q) {
      res.json([]);
      return;
    }

    const users = await searchUsers(q, contestId);
    res.json(users);
  }),
);

router.get(
  '/submissions/:id',
  requireAuth,
  validateRequest({ params: idParamSchema, query: submissionDetailQuerySchema }),
  asyncHandler(async (req: Request, res: Response<SubmissionDetailRow | ContestSubmissionDetailRow | MessageResponse>) => {
    const id = String(req.params.id);
    const contestId = typeof req.query.contestId === 'string' ? req.query.contestId : undefined;
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const submission = await getSubmissionDetail(id, contestId);
    if (!submission) {
      throw new AppError('Submission not found.', 404);
    }

    const isOwner = submission.user_id === userId;
    const isStaffOrAdmin = role === USER_ROLES.ADMIN || role === USER_ROLES.STAFF;
    if (!isOwner && !isStaffOrAdmin) {
      throw new AppError('You are not authorized to view this submission.', 403);
    }

    res.json(submission);
  }),
);

router.get(
  '/scoreboard',
  // Public read-only in PUBLIC mode (sanitized DTO: username, avatar flag,
  // score, solved count); PRIVATE mode still requires authentication.
  requirePublicAccess,
  asyncHandler(async (_req: Request, res: Response) => {
    const scoreboard = await getGlobalScoreboard();
    res.json(scoreboard);
  }),
);

export default router;
