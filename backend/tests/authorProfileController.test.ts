import express, { Express, NextFunction, Request, Response } from 'express';
import session from 'express-session';
import request from 'supertest';
import { AUTHOR_PROFILE_IMAGE } from '../constants';
import authorProfileRouter from '../controllers/authorProfileController';
import { errorHandler } from '../middleware/errorHandler';
import * as imageService from '../services/authorProfileImageService';
import * as profileService from '../services/authorProfileQueryService';
import * as profileSyncService from '../services/authoringProfileSyncService';
import { changesAuthorSnapshot } from '../services/authoringProfileSyncService';
import { AuthorProfileRow } from '../types/authoring';

jest.mock('../services/authorProfileImageService');
jest.mock('../services/authorProfileQueryService');
// Keep the pure snapshot-diff logic real; stub only the DB-bound cascade calls.
jest.mock('../services/authoringProfileSyncService', () => {
  const actual = jest.requireActual('../services/authoringProfileSyncService');
  return { ...actual, getProfileSyncImpact: jest.fn(), createProfileSync: jest.fn() };
});

const profileRow = (overrides: Partial<AuthorProfileRow> = {}): AuthorProfileRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: null,
  aka_name: 'Nonbangkok',
  real_name: 'Example Author',
  default_language: 'Thai',
  country_code: 'THA',
  profile_image_png: null,
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  ...overrides,
});

const createTestApp = (role?: 'user' | 'staff' | 'admin'): Express => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      req.session.userId = 7;
      req.session.role = role;
    }
    next();
  });
  app.use('/', authorProfileRouter);
  app.use(errorHandler);
  return app;
};

describe('Author Profile controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows admins and staff; rejects anonymous and plain users', async () => {
    const anonymous = await request(createTestApp()).get('/admin/author-profiles');
    const user = await request(createTestApp('user')).get('/admin/author-profiles');

    expect(anonymous.status).toBe(401);
    expect(user.status).toBe(403);
    expect(profileService.listAuthorProfiles).not.toHaveBeenCalled();
  });

  it('creates a profile without requiring an account or image', async () => {
    const profile = profileRow();
    (profileService.createAuthorProfile as jest.Mock).mockResolvedValueOnce({
      kind: 'created',
      profile,
    });

    const response = await request(createTestApp('admin'))
      .post('/admin/author-profiles')
      .send({
        akaName: 'Nonbangkok',
        realName: 'Example Author',
        defaultLanguage: 'Thai',
        countryCode: 'THA',
      });

    expect(response.status).toBe(201);
    expect(profileService.createAuthorProfile).toHaveBeenCalledWith({
      user_id: null,
      aka_name: 'Nonbangkok',
      real_name: 'Example Author',
      default_language: 'Thai',
      country_code: 'THA',
      profile_image_png: null,
    });
    expect(response.body).toEqual(expect.objectContaining({
      id: profile.id,
      userId: null,
      akaName: 'Nonbangkok',
      hasProfileImage: false,
    }));
    expect(response.body.profileImagePng).toBeUndefined();
  });

  it('normalizes an uploaded profile image before persistence', async () => {
    const normalized = Buffer.from('normalized png');
    const profile = profileRow({ profile_image_png: normalized });
    (imageService.normalizeAuthorProfileImage as jest.Mock).mockResolvedValueOnce(normalized);
    (profileService.createAuthorProfile as jest.Mock).mockResolvedValueOnce({
      kind: 'created',
      profile,
    });

    const response = await request(createTestApp('admin'))
      .post('/admin/author-profiles')
      .field('akaName', 'Nonbangkok')
      .field('realName', 'Example Author')
      .field('defaultLanguage', 'Thai')
      .field('countryCode', 'THA')
      .attach('profileImage', Buffer.from('source png'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(201);
    expect(imageService.normalizeAuthorProfileImage).toHaveBeenCalledWith(
      Buffer.from('source png'),
      'image/png',
    );
    expect(profileService.createAuthorProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profile_image_png: normalized }),
    );
  });

  it('lists camel-case metadata without image bytes', async () => {
    (profileService.listAuthorProfiles as jest.Mock).mockResolvedValueOnce([{
      ...profileRow(),
      has_profile_image: true,
    }]);

    const response = await request(createTestApp('admin')).get('/admin/author-profiles');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      akaName: 'Nonbangkok',
      hasProfileImage: true,
    })]);
    expect(response.body[0].profileImagePng).toBeUndefined();
  });

  it('updates metadata and can remove a stored image once confirmed', async () => {
    const current = profileRow({ profile_image_png: Buffer.from('current png') });
    const updated = profileRow({ aka_name: 'Redgate', profile_image_png: null });
    (profileService.getAuthorProfile as jest.Mock).mockResolvedValueOnce(current);
    (profileService.updateAuthorProfile as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      profile: updated,
    });
    (profileSyncService.createProfileSync as jest.Mock).mockResolvedValueOnce({
      syncId: '99999999-9999-4999-8999-999999999999',
      affectedDrafts: 3,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/author-profiles/${updated.id}`)
      .send({ akaName: 'Redgate', removeProfileImage: true, confirmed: true });

    expect(response.status).toBe(200);
    expect(profileService.updateAuthorProfile).toHaveBeenCalledWith(updated.id, {
      aka_name: 'Redgate',
      profile_image_png: null,
    });
    expect(profileSyncService.createProfileSync).toHaveBeenCalledWith(updated.id);
  });

  it('reports cascade impact instead of saving an unconfirmed author-relevant edit', async () => {
    const current = profileRow({ aka_name: 'Nonbangkok' });
    (profileService.getAuthorProfile as jest.Mock).mockResolvedValueOnce(current);
    (profileSyncService.getProfileSyncImpact as jest.Mock).mockResolvedValueOnce({
      affectedDrafts: 12,
      affectedPublishedProblems: 5,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/author-profiles/${current.id}`)
      .send({ akaName: 'New Aka' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      confirmationRequired: true,
      affectedDrafts: 12,
      affectedPublishedProblems: 5,
      profile: expect.objectContaining({ akaName: 'Nonbangkok' }),
    });
    expect(profileService.updateAuthorProfile).not.toHaveBeenCalled();
    expect(profileSyncService.createProfileSync).not.toHaveBeenCalled();
  });

  it('saves non-author changes (account link) without confirmation or cascade', async () => {
    const current = profileRow({ user_id: null });
    const updated = profileRow({ user_id: 8 });
    (profileService.getAuthorProfile as jest.Mock).mockResolvedValueOnce(current);
    (profileService.updateAuthorProfile as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      profile: updated,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/author-profiles/${updated.id}`)
      .send({ userId: 8 });

    expect(response.status).toBe(200);
    expect(profileSyncService.getProfileSyncImpact).not.toHaveBeenCalled();
    expect(profileSyncService.createProfileSync).not.toHaveBeenCalled();
    expect(response.body.userId).toBe(8);
  });

  it('saves a no-op author edit without confirmation and without cascading', async () => {
    const current = profileRow({ aka_name: 'Nonbangkok' });
    (profileService.getAuthorProfile as jest.Mock).mockResolvedValueOnce(current);
    (profileService.updateAuthorProfile as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      profile: current,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/author-profiles/${current.id}`)
      .send({ akaName: 'Nonbangkok' });

    expect(response.status).toBe(200);
    expect(profileSyncService.getProfileSyncImpact).not.toHaveBeenCalled();
    expect(profileSyncService.createProfileSync).not.toHaveBeenCalled();
  });

  it('maps missing profiles and duplicate account links to API errors', async () => {
    (profileService.getAuthorProfile as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(profileRow());
    (profileService.updateAuthorProfile as jest.Mock)
      .mockResolvedValueOnce({ kind: 'duplicate_user_link' });

    const missing = await request(createTestApp('admin'))
      .patch('/admin/author-profiles/22222222-2222-4222-8222-222222222222')
      .send({ akaName: 'Missing' });
    const duplicate = await request(createTestApp('admin'))
      .patch('/admin/author-profiles/11111111-1111-4111-8111-111111111111')
      .send({ userId: 8 });

    expect(missing.status).toBe(404);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('author_profile_user_conflict');
    // Only the duplicate request reaches the save; missing short-circuits at the gate.
    expect(profileService.updateAuthorProfile).toHaveBeenCalledTimes(1);
  });

  it('rejects profile image uploads larger than 10 MiB', async () => {
    const response = await request(createTestApp('admin'))
      .post('/admin/author-profiles')
      .field('akaName', 'Nonbangkok')
      .field('realName', 'Example Author')
      .field('defaultLanguage', 'Thai')
      .field('countryCode', 'THA')
      .attach('profileImage', Buffer.alloc(AUTHOR_PROFILE_IMAGE.MAX_UPLOAD_BYTES + 1), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(413);
    expect(response.body.message).toBe('Author profile image must not exceed 10 MiB');
    expect(imageService.normalizeAuthorProfileImage).not.toHaveBeenCalled();
    expect(profileService.createAuthorProfile).not.toHaveBeenCalled();
  });
});
