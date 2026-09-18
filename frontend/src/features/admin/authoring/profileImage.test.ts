import { getSquareCrop, validateProfileImage, loadProfileImage } from './profileImage';

describe('square profile crop', () => {
  test.each([
    [800, 400, 1, 50, 50, { x: 200, y: 0, size: 400 }],
    [400, 800, 2, 100, 0, { x: 200, y: 0, size: 200 }],
    [800, 400, 2, 0, 100, { x: 0, y: 200, size: 200 }],
  ])('keeps crop square and inside %s × %s image', (width, height, zoom, x, y, expected) => {
    expect(getSquareCrop(width, height, zoom, x, y)).toEqual(expected);
  });

  test('rejects unsupported files before image decoding', () => {
    expect(() => validateProfileImage(new File(['svg'], 'image.svg', { type: 'image/svg+xml' }))).toThrow(/JPEG, PNG, or WebP/);
    expect(() => validateProfileImage(new File(['png'], 'image.png', { type: 'image/png' }))).not.toThrow();
  });

  test('decodes uploads using a data image permitted by the existing application CSP', async () => {
    const original = global.Image;
    let source = '';
    global.Image = class {
      naturalWidth = 512; naturalHeight = 512; onload: () => void;
      set src(value: string) { source = value; this.onload(); }
    } as unknown as typeof Image;
    try {
      await loadProfileImage(new File(['fixture'], 'image.png', { type: 'image/png' }));
      expect(source).toMatch(/^data:image\/png;base64,/);
    } finally { global.Image = original; }
  });
});
