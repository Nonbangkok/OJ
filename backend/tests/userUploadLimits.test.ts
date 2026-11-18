import request from 'supertest';
import express, { Express, NextFunction, Request, Response } from 'express';
import session from 'express-session';
import submissionRouter from '../controllers/submissionController';
import userProfileRouter from '../controllers/userProfileController';
import { errorHandler } from '../middleware/errorHandler';
import { SUBMISSION_VALIDATION, USER_AVATAR } from '../constants';
import { validateAndQueueSubmission } from '../services/submissionQueryService';
import * as profileQueryService from '../services/userProfileQueryService';
import * as avatarImageService from '../services/userAvatarImageService';

// POST /submit and PUT /profile/avatar are the multipart routes a regular
// user account reaches. Busboy holds every text field in RAM, and both
// routes used to accept any number of 1 MB fields (multer's defaults), so a
// handful of concurrent requests could fill the 1 GiB backend container
// before zod ever looked at the body. These tests drive the real routers and
// the real multer, and require an over-limit form to be refused before the
// handler (and its DB work) runs.

jest.mock('../db');
jest.mock('../services/siteSettingsService', () => ({
  getSiteAccessMode: jest.fn().mockResolvedValue('public'),
  updateSiteAccessMode: jest.fn(),
  resetSiteAccessModeCache: jest.fn(),
}));
jest.mock('../services/submissionService');
jest.mock('../services/judgeQueue');
jest.mock('../services/submissionQueryService');
jest.mock('../services/userProfileQueryService');
jest.mock('../services/userAvatarImageService');

const MiB = 1024 * 1024;
// A UTF-16 code unit is at most 3 UTF-8 bytes, so this many bytes hold any
// code the schema accepts, and a field above it cannot be a valid code.
const MAX_SUBMISSION_FIELD_BYTES = 3 * SUBMISSION_VALIDATION.MAX_CODE_LENGTH;

const createApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, username: 'user7', role: 'user', hasAvatar: false };
    next();
  });
  app.use('/', submissionRouter);
  app.use('/', userProfileRouter);
  app.use(errorHandler);
  return app;
};

describe('POST /submit multipart limits', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
    (validateAndQueueSubmission as jest.Mock).mockResolvedValue({ submissionId: 41, isContestSubmission: false });
  });

  const submitForm = () => request(app)
    .post('/submit')
    .field('problemId', 'P1')
    .field('language', 'cpp');

  it('accepts the largest code the schema allows, sent as multipart', async () => {
    // 'ก' is 3 bytes in UTF-8: the worst case for the byte cap.
    const code = 'ก'.repeat(SUBMISSION_VALIDATION.MAX_CODE_LENGTH);
    const res = await submitForm().field('code', code).field('contestId', '3');

    expect(res.status).toBe(202);
    expect(validateAndQueueSubmission).toHaveBeenCalledWith(
      { problemId: 'P1', language: 'cpp', code, contestId: '3' },
      7,
      'user',
    );
  });

  it('refuses a field above the code byte cap with a 413 before the handler runs', async () => {
    const res = await submitForm().field('code', 'a'.repeat(MAX_SUBMISSION_FIELD_BYTES + 1));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      message: `Submission field "code" is larger than ${MAX_SUBMISSION_FIELD_BYTES} bytes `
        + `(code is limited to ${SUBMISSION_VALIDATION.MAX_CODE_LENGTH} characters)`,
    });
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('applies the same byte cap to every field, not only code', async () => {
    const res = await request(app)
      .post('/submit')
      .field('problemId', 'p'.repeat(MAX_SUBMISSION_FIELD_BYTES + 1))
      .field('language', 'cpp')
      .field('code', 'int main(){}');

    expect(res.status).toBe(413);
    expect(res.body.message).toMatch(/^Submission field "problemId" is larger than /);
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('refuses more fields than the submission schema has with a 400', async () => {
    const res = await submitForm()
      .field('code', 'int main(){}')
      .field('contestId', '3')
      .field('extra', 'x');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: 'A submission form takes at most 4 fields: problemId, language, code, contestId',
    });
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('refuses a valid submission padded with near-1 MB fields (multer\'s old per-field default)', async () => {
    let form = submitForm().field('code', 'int main(){}');
    for (let i = 0; i < 8; i += 1) form = form.field(`pad${i}`, 'a'.repeat(MiB - 16));

    const res = await form;

    // The first pad is already over the byte cap, so multer stops there and
    // discards the rest of the body instead of buffering it.
    expect(res.status).toBe(413);
    expect(res.body.message).toMatch(/^Submission field "pad0" is larger than /);
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('refuses a valid submission padded with many small fields with a 400', async () => {
    let form = submitForm().field('code', 'int main(){}');
    for (let i = 0; i < 200; i += 1) form = form.field(`pad${i}`, 'x');

    const res = await form;

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^A submission form takes at most 4 fields/);
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('refuses a file part with a 400', async () => {
    const res = await submitForm()
      .field('code', 'int main(){}')
      .attach('code', Buffer.from('int main(){}'), 'main.cpp');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: 'A submission takes no file uploads; send the code as the "code" text field',
    });
    expect(validateAndQueueSubmission).not.toHaveBeenCalled();
  });

  it('still takes a JSON submission', async () => {
    const res = await request(app)
      .post('/submit')
      .send({ problemId: 'P1', language: 'cpp', code: 'int main(){}' });

    expect(res.status).toBe(202);
    expect(validateAndQueueSubmission).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /profile/avatar multipart limits', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
    (avatarImageService.normalizeUserAvatar as jest.Mock).mockResolvedValue(Buffer.from('normalized-png'));
    (profileQueryService.updateUserAvatar as jest.Mock).mockResolvedValue({
      avatar_updated_at: new Date('2026-11-18T00:00:00.000Z'),
    });
  });

  const png = { filename: 'avatar.png', contentType: 'image/png' };

  it('accepts an avatar at the size cap', async () => {
    const res = await request(app)
      .put('/profile/avatar')
      .attach(USER_AVATAR.FIELD_NAME, Buffer.alloc(USER_AVATAR.MAX_UPLOAD_BYTES, 0x41), png);

    expect(res.status).toBe(200);
    expect(profileQueryService.updateUserAvatar).toHaveBeenCalledTimes(1);
  });

  it('refuses an avatar above the cap with a 413 naming the real limit', async () => {
    const res = await request(app)
      .put('/profile/avatar')
      .attach(USER_AVATAR.FIELD_NAME, Buffer.alloc(USER_AVATAR.MAX_UPLOAD_BYTES + 1, 0x41), png);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: `User avatar must not exceed ${USER_AVATAR.MAX_UPLOAD_MIB} MiB` });
    expect(profileQueryService.updateUserAvatar).not.toHaveBeenCalled();
  });

  it('refuses text fields with a 400 before the handler runs', async () => {
    const res = await request(app)
      .put('/profile/avatar')
      .field('note', 'a'.repeat(MiB - 16))
      .attach(USER_AVATAR.FIELD_NAME, Buffer.from('raw'), png);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'The avatar upload takes only the "avatar" image file' });
    expect(avatarImageService.normalizeUserAvatar).not.toHaveBeenCalled();
    expect(profileQueryService.updateUserAvatar).not.toHaveBeenCalled();
  });

  it('refuses a second avatar file with a 400', async () => {
    const res = await request(app)
      .put('/profile/avatar')
      .attach(USER_AVATAR.FIELD_NAME, Buffer.from('raw'), png)
      .attach(USER_AVATAR.FIELD_NAME, Buffer.from('raw'), png);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'The avatar upload takes only the "avatar" image file' });
    expect(profileQueryService.updateUserAvatar).not.toHaveBeenCalled();
  });
});
