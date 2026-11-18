import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import problemRouter from '../controllers/problemController';
import { errorHandler } from '../middleware/errorHandler';
import { PROBLEM_UPLOAD_LIMITS, HEADER_PROBLEM_LIMITS } from '../constants';
import * as db from '../db';
import * as problemQueryService from '../services/problemQueryService';

// PUT /admin/problems/:id/files/:role and POST /admin/problems/:id/upload
// buffer uploads in RAM. They used memoryUpload, whose cap is the 2 GiB
// disk-upload ceiling, inside a backend container capped at 1 GiB. A
// header-problem file set never exceeds 20 x 1 MiB, and the frontend sends
// single-request testcase ZIPs only up to 50 MiB (larger ones go through the
// chunked, disk-backed route). These tests use the real multer as staff and
// require oversized bodies to be refused before the route handler (and its
// DB lookups) runs.

jest.mock('../db');
jest.mock('../services/siteSettingsService', () => ({
  getSiteAccessMode: jest.fn().mockResolvedValue('public'),
  updateSiteAccessMode: jest.fn(),
  resetSiteAccessModeCache: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, username: 'staff1', role: 'staff', hasAvatar: false };
    next();
  },
  requireAdmin: (_req: Request, res: Response) => res.status(403).json({ message: 'Forbidden' }),
  requireStaffOrAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const MiB = 1024 * 1024;
// The single-request cap must admit everything the frontend sends in one request.
const FRONTEND_SINGLE_REQUEST_LIMIT_BYTES = 50 * MiB;

describe('in-memory upload limits on staff problem routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/', problemRouter);
    app.use(errorHandler);
    (db.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('sizes the caps for what the routes legitimately carry', () => {
    expect(PROBLEM_UPLOAD_LIMITS.FILES_ZIP_MAX_BYTES)
      .toBeGreaterThan(HEADER_PROBLEM_LIMITS.MAX_FILES_PER_ROLE * HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES);
    expect(PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_BYTES).toBeGreaterThanOrEqual(FRONTEND_SINGLE_REQUEST_LIMIT_BYTES);
  });

  it('refuses an oversized filesZip with a 413 before the handler runs', async () => {
    const res = await request(app)
      .put('/admin/problems/P1/files/grader')
      .attach('filesZip', Buffer.alloc(PROBLEM_UPLOAD_LIMITS.FILES_ZIP_MAX_BYTES + MiB, 0x41), 'grader.zip');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: 'Header problem file ZIP must not exceed 25 MiB' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('still hands an in-limit filesZip to the handler', async () => {
    const res = await request(app)
      .put('/admin/problems/P1/files/grader')
      .attach('filesZip', Buffer.from('PK'), 'grader.zip');

    // The handler ran: it looked the problem up and found none.
    expect(res.status).toBe(404);
    expect(db.query).toHaveBeenCalled();
  });

  it('refuses text fields on the filesZip route', async () => {
    const res = await request(app)
      .put('/admin/problems/P1/files/grader')
      .field('note', 'x')
      .attach('filesZip', Buffer.from('PK'), 'grader.zip');

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses an oversized single-request testcasesZip with a 413 before the handler runs', async () => {
    const res = await request(app)
      .post('/admin/problems/P1/upload')
      .attach('testcasesZip', Buffer.alloc(PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_BYTES + MiB, 0x41), 'testcases.zip');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      message: 'Testcase ZIP must not exceed 64 MiB in one request; larger ZIPs use the chunked upload',
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('refuses an oversized problemPdf with a 413 before the handler runs', async () => {
    const res = await request(app)
      .post('/admin/problems/P1/upload')
      .attach('problemPdf', Buffer.alloc(PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_BYTES + MiB, 0x41), 'statement.pdf');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: 'Problem PDF must not exceed 64 MiB' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('accepts a testcasesZip at the frontend single-request limit', async () => {
    const replace = jest.spyOn(problemQueryService, 'replaceProblemTestcasesFromZip')
      .mockResolvedValueOnce({ kind: 'ok', insertedCount: 1 });

    const res = await request(app)
      .post('/admin/problems/P1/upload')
      .attach('testcasesZip', Buffer.alloc(FRONTEND_SINGLE_REQUEST_LIMIT_BYTES, 0x41), 'testcases.zip');

    expect(res.status).toBe(200);
    expect(replace).toHaveBeenCalledWith('P1', expect.any(Buffer));
    expect((replace.mock.calls[0][1] as Buffer).length).toBe(FRONTEND_SINGLE_REQUEST_LIMIT_BYTES);
  });
});
