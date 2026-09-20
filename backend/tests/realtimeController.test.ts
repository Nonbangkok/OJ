import http from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import realtimeRouter from '../controllers/realtimeController';
import { publishRealtime, realtimeListenerCount } from '../services/realtimeHub';
import { errorHandler } from '../middleware/errorHandler';

/**
 * SSE controller tests. The streams never end by design, so plain supertest
 * (which awaits a completed response) would hang. Instead each test spins up
 * a real HTTP server around an Express app, connects with a raw http client,
 * captures the bytes as they arrive, publishes hub events, and aborts the
 * socket to verify the close-cleanup leak guard.
 */

const buildApp = (userId: number | null): Express => {
    const app = express();
    app.use(express.json());
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
    }));
    app.use((req: Request, _res: Response, next: NextFunction) => {
        if (req.session && userId !== null) {
            req.session.userId = userId;
            // requireAuth reads req.user first — emulate attachRequestUser.
            if (userId !== null) {
                req.user = {
                    id: userId,
                    username: `user${userId}`,
                    role: 'user',
                    hasAvatar: false,
                };
            }
        }
        next();
    });
    app.use('/', realtimeRouter);
    app.use(errorHandler);
    return app;
};

interface OpenStream {
    body: () => string;
    headers: () => http.IncomingHttpHeaders;
    close: () => Promise<void>;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
}

/** Start a server, open one SSE request, and collect everything it sends. */
const openStream = (
    userId: number | null,
    path: string
): Promise<{ server: http.Server; stream: OpenStream }> =>
    new Promise((resolve) => {
        const server = http.createServer(buildApp(userId));
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number };
            const req = http.get(
                { host: '127.0.0.1', port: address.port, path },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));

                    const body = (): string => Buffer.concat(chunks).toString('utf8');

                    const close = (): Promise<void> => new Promise((resolveClose) => {
                        res.destroy();
                        server.close(() => resolveClose());
                        // close() callback can lag if sockets linger.
                        setTimeout(resolveClose, 500);
                    });

                    const waitFor = (
                        pattern: string | RegExp,
                        timeoutMs = 2000
                    ): Promise<string> => new Promise((resolveWait, reject) => {
                        const started = Date.now();
                        const tick = (): void => {
                            const text = body();
                            if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) {
                                resolveWait(text);
                                return;
                            }
                            if (Date.now() - started > timeoutMs) {
                                reject(new Error(`timeout waiting for ${String(pattern)}; got: ${text}`));
                                return;
                            }
                            setTimeout(tick, 10);
                        };
                        tick();
                    });

                    // Give the Express handler a tick to subscribe to the hub.
                    setImmediate(() => {
                        resolve({
                            server,
                            stream: {
                                body: () => body(),
                                headers: () => res.headers,
                                close,
                                waitFor,
                            },
                        });
                    });
                }
            );
            req.on('error', () => { /* surfaced via waitFor timeouts */ });
        });
    });

const settled = (ms = 50): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

describe('Realtime Controller', () => {
    beforeEach(async () => {
        // Assert on relative deltas after every listener from prior tests has
        // been torn down: poll until the hub quiesces (leaked listeners from
        // a broken teardown would hang this out, which is itself a failure).
        const deadline = Date.now() + 2000;
        while (realtimeListenerCount() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    });

    describe('GET /realtime/submissions', () => {
        it('requires authentication', async () => {
            const { server, stream } = await openStream(null, '/realtime/submissions');
            const text = await stream.waitFor('Authentication required');
            expect(text).toContain('Authentication required');
            await stream.close();
        });

        it('sets SSE headers and opens the stream', async () => {
            const { stream } = await openStream(1, '/realtime/submissions');

            const rawHeaders = stream.headers();
            expect(rawHeaders['content-type']).toContain('text/event-stream');
            expect(rawHeaders['cache-control']).toBe('no-cache');
            expect(rawHeaders['connection']).toBe('keep-alive');
            await stream.close();
        });

        it('relays the requesting user\'s submission events and filters other users\'', async () => {
            const { stream } = await openStream(7, '/realtime/submissions');

            publishRealtime({
                type: 'submission_update',
                submissionId: 11,
                table: 'submissions',
                overall_status: 'Running',
                score: 0,
                user_id: 7,
            });
            publishRealtime({
                type: 'submission_update',
                submissionId: 12,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 999, // someone else — must not reach this client
            });
            publishRealtime({ type: 'scoreboard_update', contestId: 3 }); // wrong channel

            const text = await stream.waitFor('"submissionId":11');
            expect(text).toContain('event: submission_update');
            expect(text).toContain('"overall_status":"Running"');
            expect(text).not.toContain('"submissionId":12');
            expect(text).not.toContain('scoreboard_update');
            await stream.close();
        });

        it('unsubscribes the listener when the client disconnects', async () => {
            const before = realtimeListenerCount();
            const { stream } = await openStream(1, '/realtime/submissions');

            // Connection open: one listener registered.
            expect(realtimeListenerCount()).toBe(before + 1);

            await stream.close();
            await settled();

            expect(realtimeListenerCount()).toBe(before);
        });

        it('stops relaying events after the client disconnects', async () => {
            const { stream } = await openStream(1, '/realtime/submissions');
            await stream.close();
            await settled();

            publishRealtime({
                type: 'submission_update',
                submissionId: 99,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 1,
            });
            await settled();

            expect(stream.body()).not.toContain('"submissionId":99');
        });
    });

    describe('GET /realtime/contests/:id', () => {
        it('requires authentication', async () => {
            const { stream } = await openStream(null, '/realtime/contests/5');
            const text = await stream.waitFor('Authentication required');
            expect(text).toContain('Authentication required');
            await stream.close();
        });

        it('rejects invalid contest ids', async () => {
            const { stream } = await openStream(1, '/realtime/contests/not-a-number');
            const text = await stream.waitFor('Validation failed');
            expect(text).toContain('Validation failed');
            await stream.close();
        });

        it('relays scoreboard events for the requested contest only', async () => {
            const { stream } = await openStream(1, '/realtime/contests/5');

            publishRealtime({ type: 'scoreboard_update', contestId: 5 });
            publishRealtime({ type: 'scoreboard_update', contestId: 6 }); // other contest
            publishRealtime({
                type: 'submission_update',
                submissionId: 1,
                table: 'contest_submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 1,
            }); // wrong channel

            const text = await stream.waitFor('"contestId":5');
            expect(text).toContain('event: scoreboard_update');
            expect(text).not.toContain('"contestId":6');
            expect(text).not.toContain('submission_update');
            await stream.close();
        });

        it('unsubscribes the listener when the client disconnects', async () => {
            const before = realtimeListenerCount();
            const { stream } = await openStream(1, '/realtime/contests/5');

            expect(realtimeListenerCount()).toBe(before + 1);

            await stream.close();
            await settled();

            expect(realtimeListenerCount()).toBe(before);
        });
    });
});
