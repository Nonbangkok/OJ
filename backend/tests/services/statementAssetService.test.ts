import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { prepareStatementAsset } from '../../services/statementAssetService';

describe('statement asset preparation', () => {
  it.each([
    ['PNG', 'image/png', 'png', 'diagram.png'],
    ['JPEG', 'image/jpeg', 'jpeg', 'photo.jpg'],
    ['WebP', 'image/webp', 'webp', 'chart.webp'],
  ] as const)('validates and prepares a %s asset', async (
    _label,
    mimeType,
    format,
    filename,
  ) => {
    const source = await sharp({
      create: {
        width: 4,
        height: 2,
        channels: 3,
        background: '#336699',
      },
    }).toFormat(format).toBuffer();

    const asset = await prepareStatementAsset(filename, source, mimeType);

    expect(asset.filename).toBe(filename);
    expect(asset.mimeType).toBe(mimeType);
    expect(asset.sizeBytes).toBe(asset.content.length);
    expect(asset.checksumSha256).toBe(
      createHash('sha256').update(asset.content).digest('hex'),
    );
    expect(asset.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    '../secret.png',
    'nested/diagram.png',
    '.hidden.png',
    'space in name.png',
    'diagram.svg',
  ])('rejects unsafe or unsupported filename %s', async (filename) => {
    await expect(
      prepareStatementAsset(filename, Buffer.from('bytes'), 'image/png'),
    ).rejects.toThrow('Invalid statement asset filename');
  });

  it('rejects file content that does not match its declared MIME type', async () => {
    const png = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();

    await expect(
      prepareStatementAsset('photo.jpg', png, 'image/jpeg'),
    ).rejects.toThrow('Statement asset content does not match its media type');
  });

  it('rejects corrupt image bytes with a stable validation error', async () => {
    await expect(
      prepareStatementAsset('diagram.png', Buffer.from('not a png'), 'image/png'),
    ).rejects.toThrow('Invalid statement asset image');
  });

  it('rejects an asset whose normalized representation exceeds 10 MiB', async () => {
    const width = 2048;
    const height = 2048;
    const noisyPng = await sharp(randomBytes(width * height * 3), {
      raw: { width, height, channels: 3 },
    }).png({ compressionLevel: 0 }).toBuffer();

    await expect(
      prepareStatementAsset('noise.png', noisyPng, 'image/png'),
    ).rejects.toThrow('Normalized statement asset exceeds 10 MiB');
  });
});
