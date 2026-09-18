import {
  createFallbackAuthorAvatar,
  normalizeAuthorProfileImage,
} from '../../services/authorProfileImageService';
import sharp from 'sharp';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const readPngDimensions = (image: Buffer) => ({
  width: image.readUInt32BE(16),
  height: image.readUInt32BE(20),
});

describe('author profile image service', () => {
  it('normalizes an uploaded PNG to a 512 by 512 PNG', async () => {
    const normalized = await normalizeAuthorProfileImage(ONE_PIXEL_PNG, 'image/png');

    expect(normalized.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(readPngDimensions(normalized)).toEqual({ width: 512, height: 512 });
  });

  it('rejects media types outside JPEG, PNG, and WebP', async () => {
    await expect(
      normalizeAuthorProfileImage(Buffer.from('<svg/>'), 'image/svg+xml'),
    ).rejects.toThrow('Unsupported author profile image type');
  });

  it.each([
    ['JPEG', 'image/jpeg', 'jpeg'],
    ['WebP', 'image/webp', 'webp'],
  ] as const)('normalizes an uploaded %s image', async (_label, mimeType, format) => {
    const source = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 3,
        background: '#ff0000',
      },
    }).toFormat(format).toBuffer();

    const normalized = await normalizeAuthorProfileImage(source, mimeType);

    expect(readPngDimensions(normalized)).toEqual({ width: 512, height: 512 });
  });

  it('rejects corrupt image bytes with a stable validation error', async () => {
    await expect(
      normalizeAuthorProfileImage(Buffer.from('not a png'), 'image/png'),
    ).rejects.toThrow('Invalid author profile image');
  });

  it('rejects image bytes that do not match the declared media type', async () => {
    await expect(
      normalizeAuthorProfileImage(ONE_PIXEL_PNG, 'image/jpeg'),
    ).rejects.toThrow('Author profile image content does not match its media type');
  });

  it('creates the same fallback avatar for the same AKA name', async () => {
    const first = await createFallbackAuthorAvatar(' Nonbangkok ');
    const second = await createFallbackAuthorAvatar('Nonbangkok');

    expect(first).toEqual(second);
    expect(readPngDimensions(first)).toEqual({ width: 512, height: 512 });
  });

  it('creates different fallback avatars for different initials', async () => {
    const nAvatar = await createFallbackAuthorAvatar('Nonbangkok');
    const rAvatar = await createFallbackAuthorAvatar('Redgate');

    expect(nAvatar).not.toEqual(rAvatar);
  });
});
