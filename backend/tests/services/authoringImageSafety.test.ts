import sharp from 'sharp';
import { normalizeAuthorProfileImage } from '../../services/authorProfileImageService';
import { prepareStatementAsset } from '../../services/statementAssetService';

const processors = [
  {
    name: 'author profile',
    process: normalizeAuthorProfileImage,
    animatedError: 'Animated author profile images are not supported',
    invalidError: 'Invalid author profile image',
  },
  {
    name: 'statement asset',
    process: async (source: Buffer, mime: string) =>
      (await prepareStatementAsset(mime === 'image/webp' ? 'image.webp' : 'image.jpg', source, mime)).content,
    animatedError: 'Animated statement asset images are not supported',
    invalidError: 'Invalid statement asset image',
  },
];

describe.each(processors)('$name image safety with real decoders', ({ process, animatedError, invalidError }) => {
  it('rejects an animated WebP rather than silently keeping its first frame', async () => {
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(process(animated, 'image/webp')).rejects.toThrow(animatedError);
  });

  it('rejects an image above the 25 megapixel decode limit', async () => {
    const oversized = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: '#223344' },
    }).jpeg().toBuffer();
    await expect(process(oversized, 'image/jpeg')).rejects.toThrow(invalidError);
  });

  it('removes EXIF and ICC metadata from persisted bytes', async () => {
    const source = await sharp({
      create: { width: 12, height: 6, channels: 3, background: '#223344' },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const input = await sharp(source).metadata();
    expect(input.exif).toBeDefined();
    expect(input.icc).toBeDefined();
    const output = await sharp(await process(source, 'image/jpeg')).metadata();
    expect(output.exif).toBeUndefined();
    expect(output.icc).toBeUndefined();
    expect(output.orientation).toBeUndefined();
  });
});

it('applies EXIF rotation to a statement asset before removing orientation metadata', async () => {
  const source = await sharp({
    create: { width: 12, height: 6, channels: 3, background: '#223344' },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const prepared = await prepareStatementAsset('rotated.jpg', source, 'image/jpeg');
  expect(await sharp(prepared.content).metadata())
    .toEqual(expect.objectContaining({ width: 6, height: 12 }));
});
