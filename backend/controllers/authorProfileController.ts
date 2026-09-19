import express, { Request, Response, Router } from 'express';
import { AUTHOR_PROFILE_IMAGE } from '../constants';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { authorProfileImageUpload } from '../middleware/upload';
import { validateRequest } from '../middleware/validation';
import {
  authorProfileIdParamSchema,
  createAuthorProfileSchema,
  updateAuthorProfileSchema,
} from '../schemas/requestSchemas';
import { normalizeAuthorProfileImage } from '../services/authorProfileImageService';
import {
  AuthorProfileListRow,
  AuthorProfileUpdates,
  createAuthorProfile,
  getAuthorProfile,
  listAuthorProfiles,
  readAuthorProfileImage,
  updateAuthorProfile,
} from '../services/authorProfileQueryService';
import {
  changesAuthorSnapshot,
  createProfileSync,
  getProfileSyncImpact,
} from '../services/authoringProfileSyncService';
import {
  CreateAuthorProfileRequestBody,
  UpdateAuthorProfileRequestBody,
} from '../types/api';
import { AuthorProfileRow } from '../types/authoring';

const router: Router = express.Router();

const toProfileResponse = (profile: AuthorProfileRow | AuthorProfileListRow) => ({
  id: profile.id,
  userId: profile.user_id,
  akaName: profile.aka_name,
  realName: profile.real_name,
  defaultLanguage: profile.default_language,
  countryCode: profile.country_code,
  hasProfileImage: 'has_profile_image' in profile
    ? profile.has_profile_image
    : profile.profile_image_png !== null,
  createdAt: profile.created_at,
  updatedAt: profile.updated_at,
});

const normalizeUpload = async (file: Express.Multer.File): Promise<Buffer> => {
  try {
    return await normalizeAuthorProfileImage(file.buffer, file.mimetype);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid author profile image';
    throw new AppError(message, 400);
  }
};

const toProfileUpdates = (
  body: UpdateAuthorProfileRequestBody,
): AuthorProfileUpdates => ({
  ...(body.userId !== undefined ? { user_id: body.userId } : {}),
  ...(body.akaName !== undefined ? { aka_name: body.akaName } : {}),
  ...(body.realName !== undefined ? { real_name: body.realName } : {}),
  ...(body.defaultLanguage !== undefined ? { default_language: body.defaultLanguage } : {}),
  ...(body.countryCode !== undefined ? { country_code: body.countryCode } : {}),
});

router.use('/admin/author-profiles', requireAuth, requireAdmin);

router.post('/admin/author-profiles',
  authorProfileImageUpload.single(AUTHOR_PROFILE_IMAGE.FIELD_NAME),
  validateRequest({ body: createAuthorProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateAuthorProfileRequestBody;
    const profileImage = req.file ? await normalizeUpload(req.file) : null;
    const result = await createAuthorProfile({
      user_id: body.userId,
      aka_name: body.akaName,
      real_name: body.realName,
      default_language: body.defaultLanguage,
      country_code: body.countryCode,
      profile_image_png: profileImage,
    });

    if (result.kind === 'duplicate_user_link') {
      res.status(409).json({
        message: 'This user account is already linked to an author profile',
        code: 'author_profile_user_conflict',
      });
      return;
    }
    res.status(201).json(toProfileResponse(result.profile));
  }));

router.get('/admin/author-profiles', asyncHandler(async (_req: Request, res: Response) => {
  const profiles = await listAuthorProfiles();
  res.json(profiles.map(toProfileResponse));
}));

router.get('/admin/author-profiles/:id/image',
  validateRequest({ params: authorProfileIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const image = await readAuthorProfileImage(String(req.params.id));
    if (!image) {
      res.status(404).json({ message: 'This author profile has no image' });
      return;
    }
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': String(image.length),
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(image);
  }));

router.patch('/admin/author-profiles/:id',
  authorProfileImageUpload.single(AUTHOR_PROFILE_IMAGE.FIELD_NAME),
  validateRequest({ params: authorProfileIdParamSchema, body: updateAuthorProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as UpdateAuthorProfileRequestBody;
    if (req.file && body.removeProfileImage) {
      throw new AppError('Cannot upload and remove a profile image in the same request', 400);
    }

    const updates = toProfileUpdates(body);
    if (req.file) {
      updates.profile_image_png = await normalizeUpload(req.file);
    } else if (body.removeProfileImage) {
      updates.profile_image_png = null;
    }
    if (Object.keys(updates).length === 0) {
      throw new AppError('At least one author profile field or image change is required', 400);
    }

    // Confirmation gate: an author-relevant change without `confirmed` reports
    // the cascade impact instead of saving, so the admin can confirm first.
    const current = await getAuthorProfile(String(req.params.id));
    if (!current) {
      res.status(404).json({ message: 'Author profile not found' });
      return;
    }
    const affectsSnapshot = changesAuthorSnapshot(current, updates);
    if (affectsSnapshot && !body.confirmed) {
      const impact = await getProfileSyncImpact(current.id);
      res.json({
        confirmationRequired: true,
        affectedDrafts: impact.affectedDrafts,
        affectedPublishedProblems: impact.affectedPublishedProblems,
        profile: toProfileResponse(current),
      });
      return;
    }

    const result = await updateAuthorProfile(String(req.params.id), updates);
    if (result.kind === 'not_found') {
      res.status(404).json({ message: 'Author profile not found' });
      return;
    }
    if (result.kind === 'duplicate_user_link') {
      res.status(409).json({
        message: 'This user account is already linked to an author profile',
        code: 'author_profile_user_conflict',
      });
      return;
    }

    // The profile changed author-relevant fields: cascade to linked drafts.
    if (affectsSnapshot) {
      await createProfileSync(result.profile.id);
    }
    res.json(toProfileResponse(result.profile));
  }));

export default router;
