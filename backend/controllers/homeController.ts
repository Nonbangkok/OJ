import express, { Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getHomeSummary } from '../services/homeQueryService';
import type { HomeSummary } from '../types/service';

const router: Router = express.Router();

// The logged-in Home page's data in one call (B1 + spec §7.1).
router.get('/me/home', requireAuth, asyncHandler(async (req: Request, res: Response<HomeSummary>) => {
  res.json(await getHomeSummary(req.user!.id));
}));

export default router;
