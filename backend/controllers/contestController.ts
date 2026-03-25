import express, { Request, Response, Router } from 'express';
import * as problemMigration from '../services/problemMigration';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { ContestCreateRequestBody, ContestUpdateRequestBody, MoveContestProblemsRequestBody } from '../types/api';
import { validateRequest } from '../middleware/validation';
import {
  contestBodySchema,
  contestIdParamSchema,
  contestProblemParamsSchema,
  moveContestProblemsBodySchema,
} from '../schemas/requestSchemas';
import {
  createContest,
  deleteContest,
  getContestDetail,
  getContestProblemDetailForParticipant,
  getContestProblemPdfForParticipant,
  getContestProblemsForParticipant,
  getContestScoreboard,
  joinContest,
  listContests,
  moveSingleProblemToMainSystem,
  updateContest,
} from '../services/contestQueryService';

const router: Router = express.Router();

// List all contests
router.get('/contests', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.session;
  const contests = await listContests(userId);
  res.json(contests);
}));

// List all contests for admin
router.get('/admin/contests', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const contests = await listContests();
  res.json(contests);
}));

// Get problems available for contest (Admin)
router.get('/admin/contests/available-problems', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const problems = await problemMigration.getAvailableProblemsForContest();
  res.json(problems);
}));

// Get contest details
router.get('/contests/:id',
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { userId } = req.session;
  const contest = await getContestDetail(id, userId);
  if (!contest) {
    throw new AppError('Contest not found', 404);
  }
  res.json(contest);
}));

// Join a contest
router.post('/contests/:id/join', requireAuth,
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const result = await joinContest(id, userId);
  if (result === 'not_found') {
    res.status(404).json({ message: 'Contest not found' });
    return;
  }
  if (result === 'ended') {
    res.status(400).json({ message: 'Cannot join contest that has already ended' });
    return;
  }
  if (result === 'already_joined') {
    res.status(400).json({ message: 'Already joined this contest' });
    return;
  }

  res.json({ message: 'Successfully joined contest' });
}));

// Get contest scoreboard
router.get('/contests/:id/scoreboard', requireAuth,
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const scoreboard = await getContestScoreboard(id);
  if (!scoreboard) {
    throw new AppError('Contest not found', 404);
  }
  res.json(scoreboard);
}));

// Create new contest (Admin only)
router.post('/admin/contests', requireAuth, requireStaffOrAdmin,
  validateRequest({ body: contestBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { title, description, startTime, endTime } = req.body as ContestCreateRequestBody;
  const { userId } = req.session;

  if (new Date(endTime) <= new Date(startTime)) {
    throw new AppError('End time must be after start time', 400);
  }

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const contest = await createContest(
    { title, description: description ?? null, startTime, endTime },
    userId,
  );
  res.status(201).json(contest);
}));

// Update contest (Admin only)
router.put('/admin/contests/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: contestIdParamSchema, body: contestBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { title, description, startTime, endTime } = req.body as ContestUpdateRequestBody;

  if (new Date(endTime) <= new Date(startTime)) {
    throw new AppError('End time must be after start time', 400);
  }

  const contest = await updateContest(id, { title, description: description ?? null, startTime, endTime });
  if (!contest) {
    throw new AppError('Contest not found', 404);
  }
  res.json(contest);
}));

// Delete contest (Admin only)
router.delete('/admin/contests/:id', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const result = await deleteContest(id);

  if (result === 'not_found') {
    res.status(404).json({ message: 'Contest not found' });
    return;
  }
  if (result === 'running') {
    res.status(400).json({ message: 'Cannot delete a running contest' });
    return;
  }

  res.json({ message: `Contest ${id} deleted successfully` });
}));

// Get problems in contest (Admin)
router.get('/admin/contests/:id/admin-problems', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problems = await problemMigration.getProblemsInContest(parseInt(id, 10));
  res.json(problems);
}));


// Move problems to/from contest (Admin)
router.post('/admin/contests/:id/problems', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: contestIdParamSchema, body: moveContestProblemsBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { problemIds, action } = req.body as MoveContestProblemsRequestBody;

  let result;
  if (action === 'move_to_contest') {
    result = await problemMigration.moveProblemsToContest(Number.parseInt(id, 10), problemIds);
  } else if (action === 'move_to_main') {
    result = await problemMigration.moveProblemsBackToMain(Number.parseInt(id, 10), problemIds);
  } else {
    throw new AppError('Action must be move_to_contest or move_to_main', 400);
  }
  res.json(result);
}));

// Move problem back to main system
router.delete('/admin/contests/:id/problems/:problemId', requireAuth, requireStaffOrAdmin,
  validateRequest({ params: contestProblemParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const problemId = String(req.params.problemId);

  const result = await moveSingleProblemToMainSystem(id, problemId);
  if (result.kind === 'not_found_contest') {
    res.status(404).json({ message: 'Contest not found' });
    return;
  }
  if (result.kind === 'invalid_status') {
    res.status(400).json({ message: 'Can only move problems from scheduled or running contests' });
    return;
  }
  if (result.kind === 'not_found_problem') {
    res.status(404).json({ message: 'Problem not found in this contest' });
    return;
  }

  res.json({
    message: `Successfully moved problem ${problemId} back to main system`,
    problem: result.data,
  });
}));

// Get contest problems for participants (User endpoint)
router.get('/contests/:id/problems', requireAuth,
  validateRequest({ params: contestIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const result = await getContestProblemsForParticipant(id, userId);
  if (result.kind === 'not_found') {
    res.status(404).json({ message: 'Contest not found' });
    return;
  }
  if (result.kind === 'not_participant') {
    res.status(403).json({ message: 'You must join this contest to view problems' });
    return;
  }
  if (result.kind === 'inactive') {
    res.json([]);
    return;
  }
  res.json(result.data);
}));

// Get a single contest problem
router.get('/contests/:id/problems/:problemId', requireAuth,
  validateRequest({ params: contestProblemParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const contestId = String(req.params.id);
  const problemId = String(req.params.problemId);
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const result = await getContestProblemDetailForParticipant(contestId, problemId, userId);
  if (result.kind === 'not_found_contest') {
    res.status(404).json({ message: 'Contest not found.' });
    return;
  }
  if (result.kind === 'inactive') {
    res.status(403).json({ message: 'Contest is not active.' });
    return;
  }
  if (result.kind === 'not_participant') {
    res.status(403).json({ message: 'You are not a participant in this contest.' });
    return;
  }
  if (result.kind === 'not_found_problem') {
    res.status(404).json({ message: 'Problem not found in this contest.' });
    return;
  }
  res.json(result.data);
}));

// Get a single contest problem's PDF
router.get('/contests/:id/problems/:problemId/pdf', requireAuth,
  validateRequest({ params: contestProblemParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const contestId = String(req.params.id);
  const problemId = String(req.params.problemId);
  const { userId } = req.session;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const result = await getContestProblemPdfForParticipant(contestId, problemId, userId);
  if (result.kind === 'not_found_contest') {
    res.status(404).json({ message: 'Contest not found.' });
    return;
  }
  if (result.kind === 'inactive') {
    res.status(403).json({ message: 'Contest is not active.' });
    return;
  }
  if (result.kind === 'not_participant') {
    res.status(403).json({ message: 'You are not a participant in this contest.' });
    return;
  }
  if (result.kind === 'not_found_pdf') {
    res.status(404).json({ message: 'Problem PDF not found.' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.send(result.data);
}));

export default router;
