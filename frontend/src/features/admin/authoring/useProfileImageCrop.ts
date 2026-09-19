import { useEffect, useRef, useState } from 'react';

import { getErrorMessage } from '../../../utils/error';
import { drawProfileCrop, loadProfileImage } from './profileImage';

/**
 * Image-crop state machine for the author-profile editor dialog: loading a
 * chosen file into an HTMLImageElement, the zoom/position crop sliders, the
 * 512×512 canvas preview, and the remove-image flow. Extraction keeps the
 * heavy state out of AuthorProfiles; markup and classes are unchanged.
 */
export function useProfileImageCrop(onError: (message: string) => void) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [removeImage, setRemoveImage] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRequest = useRef(0);

  useEffect(() => {
    if (!image || !canvas.current) return;
    try {
      drawProfileCrop(canvas.current, image, zoom, x, y);
    } catch (failure) {
      onError(getErrorMessage(failure, 'Unable to save or load author profiles. Please try again.'));
    }
  }, [image, zoom, x, y, onError]);

  function reset() {
    imageRequest.current += 1;
    setImage(null);
    setImageLoading(false);
    setRemoveImage(false);
    setZoom(1);
    setX(50);
    setY(50);
  }

  async function choose(file: File) {
    const request = ++imageRequest.current;
    setImageLoading(true);
    onError('');
    setImage(null);
    try {
      const source = await loadProfileImage(file);
      if (request !== imageRequest.current) return;
      setImage(source);
      setRemoveImage(false);
      setZoom(1);
      setX(50);
      setY(50);
    } catch (failure) {
      if (request === imageRequest.current)
        onError(getErrorMessage(failure, 'Unable to save or load author profiles. Please try again.'));
    } finally {
      if (request === imageRequest.current) setImageLoading(false);
    }
  }

  /** Mark the image for removal (the destructive button's action). */
  function requestRemoval() {
    reset();
    setRemoveImage(true);
  }

  return {
    image,
    imageLoading,
    removeImage,
    zoom,
    x,
    y,
    canvas,
    setZoom,
    setX,
    setY,
    reset,
    choose,
    requestRemoval,
  };
}
