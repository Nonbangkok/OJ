import express, { Express, NextFunction, Request, Response } from 'express';
import session from 'express-session';
import request from 'supertest';
import userProfileRouter from '../controllers/userProfileController';
import { errorHandler } from '../middleware/errorHandler';
import * as queryService from '../services/userProfileQueryService';
import * as imageService from '../services/userAvatarImageService';

jest.mock('../services/userProfileQueryService');
jest.mock('../services/userAvatarImageService');

const createTestApp = (role?: 'user' | 'staff' | 'admin', userId = 7): Express => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      req.user = { id: userId, username: `user${userId}`, role, hasAvatar: false };
    }
    next();
  });
  app.use('/', userProfileRouter);
  app.use(errorHandler);
  return app;
};

describe('GET /users/:username/profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns aggregated stats for an existing user', async () => {
    (queryService.getUserProfileStats as jest.Mock).mockResolvedValue({
      id: 3,
      username: 'tester',
      role: 'user',
      has_avatar: false,
      avatar_updated_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      problems_attempted: 4,
      problems_solved: 2,
      total_score: 250,
      submission_count: 9,
      verdict_counts: { Accepted: 3, 'Wrong Answer': 5, 'Runtime Error': 1 },
      language_counts: { cpp: 9 },
      daily_activity: [{ day: '2026-09-18', count: 2 }],
      current_streak: 2,
      longest_streak: 5,
      last_ac_date: '2026-09-21',
      achievements: {
        unlocked: [{ id: 'first_solve', name: 'First Solve', description: 'Solve your first problem' }],
        stats: {
          problemsSolved: 2,
          currentStreak: 2,
          longestStreak: 5,
          languagesSolvedIn: { cpp: 3 },
          contestsJoined: 0,
        },
      },
    });

    const res = await request(createTestApp()).get('/users/tester/profile');

    expect(res.status).toBe(200);
    expect(queryService.getUserProfileStats).toHaveBeenCalledWith('tester');
    expect(res.body).toEqual({
      id: 3,
      username: 'tester',
      role: 'user',
      hasAvatar: false,
      avatarUpdatedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      problemsAttempted: 4,
      problemsSolved: 2,
      totalScore: 250,
      submissionCount: 9,
      verdictCounts: { Accepted: 3, 'Wrong Answer': 5, 'Runtime Error': 1 },
      languageCounts: { cpp: 9 },
      dailyActivity: [{ day: '2026-09-18', count: 2 }],
      currentStreak: 2,
      longestStreak: 5,
      lastAcDate: '2026-09-21',
      achievements: {
        unlocked: [{ id: 'first_solve', name: 'First Solve', description: 'Solve your first problem' }],
        stats: {
          problemsSolved: 2,
          currentStreak: 2,
          longestStreak: 5,
          languagesSolvedIn: { cpp: 3 },
          contestsJoined: 0,
        },
      },
    });
  });

  it('responds 404 for an unknown username', async () => {
    (queryService.getUserProfileStats as jest.Mock).mockResolvedValue(null);

    const res = await request(createTestApp()).get('/users/nobody/profile');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
  });
});

describe('GET /users/:username/avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves the stored avatar PNG with caching headers', async () => {
    (queryService.getUserAvatar as jest.Mock).mockResolvedValue({
      avatar_png: Buffer.from('png-bytes'),
      avatar_updated_at: new Date('2026-09-01T00:00:00.000Z'),
    });

    const res = await request(createTestApp()).get('/users/tester/avatar');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('max-age');
    expect(Buffer.from(res.body).toString()).toBe('png-bytes');
  });

  it('responds 404 when the user has no avatar', async () => {
    (queryService.getUserAvatar as jest.Mock).mockResolvedValue(null);

    const res = await request(createTestApp()).get('/users/tester/avatar');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Avatar not found' });
  });
});

describe('PUT /profile/avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request(createTestApp()).put('/profile/avatar');

    expect(res.status).toBe(401);
    expect(queryService.updateUserAvatar).not.toHaveBeenCalled();
  });

  it('stores a normalized avatar for the logged-in user', async () => {
    const normalized = Buffer.from('normalized-png');
    (imageService.normalizeUserAvatar as jest.Mock).mockResolvedValue(normalized);
    (queryService.updateUserAvatar as jest.Mock).mockResolvedValue({
      avatar_updated_at: new Date('2026-09-19T00:00:00.000Z'),
    });

    const res = await request(createTestApp('user'))
      .put('/profile/avatar')
      .attach('avatar', Buffer.from('raw'), { filename: 'avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(imageService.normalizeUserAvatar).toHaveBeenCalled();
    expect(queryService.updateUserAvatar).toHaveBeenCalledWith(7, normalized);
    expect(res.body).toEqual({
      message: 'Avatar updated',
      avatarUpdatedAt: '2026-09-19T00:00:00.000Z',
    });
  });

  it('rejects an invalid image with 400', async () => {
    (imageService.normalizeUserAvatar as jest.Mock).mockRejectedValue(
      new Error('Invalid user avatar image'),
    );

    const res = await request(createTestApp('user'))
      .put('/profile/avatar')
      .attach('avatar', Buffer.from('bad'), { filename: 'avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(queryService.updateUserAvatar).not.toHaveBeenCalled();
  });
});
