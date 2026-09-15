export function getSquareCrop(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / zoom;
  return { x: (width - size) * x / 100, y: (height - size) * y / 100, size };
}

export function validateProfileImage(file: File): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Profile images must be at most 10 MiB.');
}

export async function loadProfileImage(file: File): Promise<HTMLImageElement> {
  validateProfileImage(file);
  // data: images are allowed by the app CSP; blob: images are deliberately not.
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () => reject(new Error('The image could not be decoded. Choose another file.'));
      source.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 25_000_000) {
      throw new Error('Choose an image with at most 25 million pixels.');
    }
    return image;
}

export function drawProfileCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, x: number, y: number): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the image crop.');
  const crop = getSquareCrop(image.naturalWidth, image.naturalHeight, zoom, x, y);
  canvas.width = 512;
  canvas.height = 512;
  context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512);
}

export async function profileCropToPng(image: HTMLImageElement, zoom: number, x: number, y: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawProfileCrop(canvas, image, zoom, x, y);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode the image crop.')), 'image/png');
  });
}
