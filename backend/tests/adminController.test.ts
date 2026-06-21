import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { EventEmitter } from 'events';
import adminRouter from '../controllers/adminController';
import * as db from '../db';

// Mock Dependencies
jest.mock('../db');
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
        }
        next();
    }
}));

// Drive the database-import flow deterministically without touching the real DB
// or spawning psql/pg_restore, so we can assert the per-job token behaviour.
jest.mock('../middleware/upload', () => ({
    diskUpload: {
        single: () => (req: Request, _res: Response, next: NextFunction) => {
            req.file = {
                path: '/tmp/mock-dump.sql',
                originalname: 'dump.sql',
            } as Express.Multer.File;
            next();
        }
    }
}));
jest.mock('child_process', () => ({
    exec: jest.fn(),
    spawn: jest.fn(() => {
        const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
        child.stderr = new EventEmitter();
        // Resolve the import as a success on the next tick.
        setImmediate(() => child.emit('close', 0));
        return child;
    }),
}));

describe('Admin Controller', () => {
    let app: Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.session) {
                req.session.userId = 1;
                req.session.role = 'admin';
            }
            next();
        });
        app.use('/', adminRouter);
        jest.resetAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('GET /admin/settings/registration', () => {
        it('should return site settings', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [
                    { setting_value: 'true' }
                ]
            });

            const res = await request(app).get('/admin/settings/registration');

            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
        });
    });

    describe('PUT /admin/settings/registration', () => {
        it('should update registration settings successfully', async () => {
            const updates = { enabled: false };
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 }); // Mock map updates

            const res = await request(app)
                .put('/admin/settings/registration')
                .send(updates);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Registration setting updated successfully.');
            expect(db.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('GET /admin/users', () => {
        it('should return a list of non-root users', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 2, username: 'user1', role: 'user' }]
            });

            const res = await request(app).get('/admin/users');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].username).toBe('user1');
        });
    });

    describe('Database import progress token', () => {
        const startImport = async () => {
            const res = await request(app)
                .post('/admin/database/import')
                .attach('databaseDump', Buffer.from('-- sql'), 'dump.sql');
            return res;
        };

        it('should return a per-job token when an import starts', async () => {
            const res = await startImport();

            expect(res.status).toBe(202);
            expect(res.body.jobId).toBeDefined();
            expect(typeof res.body.token).toBe('string');
            expect(res.body.token.length).toBeGreaterThan(0);
        });

        it('should return 404 for an unknown import job regardless of token', async () => {
            const res = await request(app)
                .get('/admin/database/import-progress/does-not-exist?token=whatever');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Import job not found.');
        });

        it('should reject progress requests without the job token', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`);

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid or missing import token.');
        });

        it('should reject progress requests with a wrong token', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}?token=wrong-token`);

            expect(res.status).toBe(401);
        });

        it('should return progress (without the token) when the correct token is supplied', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}?token=${start.body.token}`);

            expect(res.status).toBe(200);
            expect(res.body.status).toBeDefined();
            expect(res.body.message).toBeDefined();
            expect(res.body.token).toBeUndefined();
        });

        it('should also accept the token via the x-import-token header', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`)
                .set('x-import-token', start.body.token);

            expect(res.status).toBe(200);
            expect(res.body.token).toBeUndefined();
        });
    });
});
