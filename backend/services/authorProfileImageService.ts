import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AUTHOR_PROFILE_IMAGE } from '../constants';

const MIME_TO_SHARP_FORMAT = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type SupportedAuthorImageMime = keyof typeof MIME_TO_SHARP_FORMAT;

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const isSupportedMime = (mimeType: string): mimeType is SupportedAuthorImageMime =>
  Object.hasOwn(MIME_TO_SHARP_FORMAT, mimeType);

/**
 * Converts an uploaded author image into the canonical square PNG snapshot.
 */
export const normalizeAuthorProfileImage = async (
  image: Buffer,
  mimeType: string,
): Promise<Buffer> => {
  if (!isSupportedMime(mimeType)) {
    throw new Error('Unsupported author profile image type');
  }

  let decoder: sharp.Sharp;
  let metadata: sharp.Metadata;

  try {
    decoder = sharp(image, {
      animated: false,
      failOn: 'error',
      limitInputPixels: AUTHOR_PROFILE_IMAGE.MAX_INPUT_PIXELS,
    });
    metadata = await decoder.metadata();
  } catch {
    throw new Error('Invalid author profile image');
  }

  if (metadata.format !== MIME_TO_SHARP_FORMAT[mimeType]) {
    throw new Error('Author profile image content does not match its media type');
  }

  if ((metadata.pages ?? 1) !== 1) {
    throw new Error('Animated author profile images are not supported');
  }

  try {
    return await decoder
      .rotate()
      .resize(AUTHOR_PROFILE_IMAGE.SIZE_PX, AUTHOR_PROFILE_IMAGE.SIZE_PX, {
        fit: 'cover',
        position: 'centre',
      })
      .png()
      .toBuffer();
  } catch {
    throw new Error('Invalid author profile image');
  }
};

/**
 * Creates a stable square PNG avatar from the first character of an AKA name.
 */
export const createFallbackAuthorAvatar = async (akaName: string): Promise<Buffer> => {
  const initial = [...akaName.trim()][0]?.toLocaleUpperCase() ?? '?';
  const digest = createHash('sha256').update(initial).digest();
  const hue = digest.readUInt16BE(0) % 360;
  const size = AUTHOR_PROFILE_IMAGE.SIZE_PX;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="hsl(${hue}, 58%, 38%)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        fill="#ffffff" font-family="sans-serif" font-size="256" font-weight="700">
        ${escapeXml(initial)}
      </text>
    </svg>
  `);

  try {
    return await sharp(svg, { limitInputPixels: AUTHOR_PROFILE_IMAGE.MAX_INPUT_PIXELS })
      .png()
      .toBuffer();
  } catch {
    throw new Error('Unable to create fallback author avatar');
  }
};
