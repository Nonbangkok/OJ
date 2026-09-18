import express, { Request, Response, Router } from 'express';
import * as db from '../db';

const router: Router = express.Router();

const requiredCoreTables = [
  'users',
  'system_settings',
  'user_sessions',
  'problems',
  'testcases',
  'submissions',
  'contests',
  'contest_participants',
  'contest_submissions',
  'contest_scoreboards',
  'contest_problems',
] as const;

type CoreTableStatus = Record<(typeof requiredCoreTables)[number], boolean>;

const readinessQuery = `
  SELECT
    to_regclass('public.users') IS NOT NULL AS users,
    to_regclass('public.system_settings') IS NOT NULL AS system_settings,
    to_regclass('public.user_sessions') IS NOT NULL AS user_sessions,
    to_regclass('public.problems') IS NOT NULL AS problems,
    to_regclass('public.testcases') IS NOT NULL AS testcases,
    to_regclass('public.submissions') IS NOT NULL AS submissions,
    to_regclass('public.contests') IS NOT NULL AS contests,
    to_regclass('public.contest_participants') IS NOT NULL AS contest_participants,
    to_regclass('public.contest_submissions') IS NOT NULL AS contest_submissions,
    to_regclass('public.contest_scoreboards') IS NOT NULL AS contest_scoreboards,
    to_regclass('public.contest_problems') IS NOT NULL AS contest_problems
`;

router.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

router.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    const result = await db.query<CoreTableStatus>(readinessQuery);
    const tableStatus = result.rows[0];
    const schemaIsAvailable = tableStatus !== undefined
      && requiredCoreTables.every((table) => tableStatus[table] === true);

    if (!schemaIsAvailable) {
      res.status(503).json({ status: 'not_ready', reason: 'schema_unavailable' });
      return;
    }

    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
});

export default router;
