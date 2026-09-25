import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { numericContestIdParamSchema } from '../schemas/requestSchemas';
import {
    RealtimeEvent,
    SubmissionUpdateEvent,
    subscribeRealtime,
} from '../services/realtimeHub';
import { REALTIME_CONFIG } from '../constants';

/**
 * SSE realtime streams.
 *
 * - GET /realtime/submissions  → submission_update events for the requesting
 *   user's own submissions (server-side filter on user_id).
 * - GET /realtime/contests/:id → scoreboard_update events for one contest.
 *
 * Events are "something changed" pings: clients refetch the authoritative
 * payload from the existing REST endpoints. Polling in the frontend hooks
 * remains the correctness fallback; SSE only lowers latency.
 */

const setSseHeaders = (res: Response): void => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
};

/**
 * Wire one SSE client to the hub. Returns a teardown function that stops
 * event delivery and the heartbeat; it is invoked exactly once — either on
 * client disconnect or when the response is destroyed — so listeners can
 * never leak.
 */
const attachStream = (
    req: Request,
    res: Response,
    matches: (event: RealtimeEvent) => boolean
): void => {
    setSseHeaders(res);

    let closed = false;
    const teardown = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
    };

    const listener = (event: RealtimeEvent): void => {
        if (closed || res.writableEnded) return;
        if (!matches(event)) return;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = subscribeRealtime(listener);

    // Heartbeat comment — keeps intermediaries from reaping the idle
    // connection (nginx read timeout is 300s; 30s is comfortably inside).
    const heartbeat = setInterval(() => {
        if (!closed && !res.writableEnded) {
            res.write(': heartbeat\n\n');
        }
    }, REALTIME_CONFIG.HEARTBEAT_INTERVAL_MS);

    req.on('close', teardown);
    res.on('close', teardown);
};

const router = Router();

/** Stream the session user's own submission status transitions. */
router.get('/realtime/submissions', requireAuth, (req: Request, res: Response) => {
    const userId = req.user?.id;
    attachStream(req, res, (event): boolean => {
        if (event.type !== 'submission_update') return false;
        const submission: SubmissionUpdateEvent = event;
        // Own-submission filter is server-side: user_id rides on the event
        // payload from the pipeline row.
        return submission.user_id === userId;
    });
});

/** Stream scoreboard pings for one contest. */
router.get(
    '/realtime/contests/:id',
    requireAuth,
    validateRequest({ params: numericContestIdParamSchema }),
    (req: Request, res: Response) => {
        const contestId = Number(req.params.id);
        attachStream(req, res, (event): boolean =>
            event.type === 'scoreboard_update' && event.contestId === contestId
        );
    }
);

export default router;
