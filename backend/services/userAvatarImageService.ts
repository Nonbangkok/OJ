import sharp from 'sharp';
import { USER_AVATAR } from '../constants';

type SupportedAvatarMime = 'image/jpeg' | 'image/png' | 'image/webp';

const MIME_TO_SHARP_FORMAT = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const isSupportedMime = (mimeType: string): mimeType is SupportedAvatarMime =>
  Object.hasOwn(MIME_TO_SHARP_FORMAT, mimeType);

/**
 * Converts an uploaded user avatar into the canonical square PNG snapshot.
 */
export const normalizeUserAvatar = async (
  image: Buffer,
  mimeType: string,
): Promise<Buffer> => {
  if (!isSupportedMime(mimeType)) {
    throw new Error('Unsupported user avatar type');
  }

  let decoder: sharp.Sharp;
  let metadata: sharp.Metadata;

  try {
    decoder = sharp(image, {
      animated: false,
      failOn: 'error',
      limitInputPixels: USER_AVATAR.MAX_INPUT_PIXELS,
    });
    metadata = await decoder.metadata();
  } catch {
    throw new Error('Invalid user avatar image');
  }

  if (metadata.format !== MIME_TO_SHARP_FORMAT[mimeType]) {
    throw new Error('User avatar content does not match its media type');
  }

  if ((metadata.pages ?? 1) !== 1) {
    throw new Error('Animated user avatars are not supported');
  }

  try {
    return await decoder
      .rotate()
      .resize(USER_AVATAR.SIZE_PX, USER_AVATAR.SIZE_PX, {
        fit: 'cover',
        position: 'centre',
      })
      .png()
      .toBuffer();
  } catch {
    throw new Error('Invalid user avatar image');
  }
};
