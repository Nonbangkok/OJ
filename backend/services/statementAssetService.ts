import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { STATEMENT_ASSET } from '../constants';

const MIME_CONFIG = {
  'image/jpeg': { format: 'jpeg', extensions: ['jpg', 'jpeg'] },
  'image/png': { format: 'png', extensions: ['png'] },
  'image/webp': { format: 'webp', extensions: ['webp'] },
} as const;

type StatementAssetMime = keyof typeof MIME_CONFIG;

export interface PreparedStatementAsset {
  filename: string;
  mimeType: StatementAssetMime;
  content: Buffer;
  checksumSha256: string;
  sizeBytes: number;
}

const isSupportedMime = (mimeType: string): mimeType is StatementAssetMime =>
  Object.hasOwn(MIME_CONFIG, mimeType);

const validateFilename = (filename: string, mimeType: string): StatementAssetMime => {
  const normalizedFilename = filename.trim();
  const isSafe = normalizedFilename.length <= STATEMENT_ASSET.MAX_FILENAME_LENGTH
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedFilename)
    && !normalizedFilename.includes('..');
  if (!isSafe || !isSupportedMime(mimeType)) {
    throw new Error('Invalid statement asset filename');
  }

  const extension = normalizedFilename.split('.').pop()?.toLowerCase() ?? '';
  if (!(MIME_CONFIG[mimeType].extensions as readonly string[]).includes(extension)) {
    throw new Error('Invalid statement asset filename');
  }
  return mimeType;
};

/** Validates and canonicalizes an image for use inside a problem statement. */
export const prepareStatementAsset = async (
  filename: string,
  source: Buffer,
  declaredMimeType: string,
): Promise<PreparedStatementAsset> => {
  const mimeType = validateFilename(filename, declaredMimeType);
  let decoder: sharp.Sharp;
  let metadata: sharp.Metadata;

  try {
    decoder = sharp(source, {
      animated: false,
      failOn: 'error',
      limitInputPixels: STATEMENT_ASSET.MAX_INPUT_PIXELS,
    });
    metadata = await decoder.metadata();
  } catch {
    throw new Error('Invalid statement asset image');
  }

  if (metadata.format !== MIME_CONFIG[mimeType].format) {
    throw new Error('Statement asset content does not match its media type');
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error('Animated statement asset images are not supported');
  }

  let content: Buffer;
  try {
    const oriented = decoder.rotate();
    if (mimeType === 'image/jpeg') {
      content = await oriented.jpeg({ quality: 95 }).toBuffer();
    } else if (mimeType === 'image/webp') {
      content = await oriented.webp({ quality: 95 }).toBuffer();
    } else {
      content = await oriented.png().toBuffer();
    }
  } catch {
    throw new Error('Invalid statement asset image');
  }

  if (content.length > STATEMENT_ASSET.MAX_FILE_BYTES) {
    throw new Error('Normalized statement asset exceeds 10 MiB');
  }

  return {
    filename: filename.trim(),
    mimeType,
    content,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: content.length,
  };
};
