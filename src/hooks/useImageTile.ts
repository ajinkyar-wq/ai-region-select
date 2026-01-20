import { useCallback, useEffect, useRef, useState } from 'react';

interface ImageTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export function useImageTile(imageUrl: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [imageTransform, setImageTransform] = useState<ImageTransform | null>(null);

  const updateTransform = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return;

    const container = containerRef.current;
    const image = imageRef.current;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;

    // ✅ CORRECT scale calculation
    const scale = Math.min(
      containerWidth / imageWidth,
      containerHeight / imageHeight
    );

    const scaledWidth = imageWidth * scale;
    const scaledHeight = imageHeight * scale;

    // ✅ CENTERING OFFSET (THIS WAS MISSING)
    const offsetX = (containerWidth - scaledWidth) / 2;
    const offsetY = (containerHeight - scaledHeight) / 2;

    setImageTransform({
      x: offsetX,
      y: offsetY,
      width: scaledWidth,
      height: scaledHeight,
      scale,
    });
  }, []);

  useEffect(() => {
    updateTransform();
    window.addEventListener('resize', updateTransform);
    return () => window.removeEventListener('resize', updateTransform);
  }, [updateTransform]);

  return {
    containerRef,
    imageRef,
    imageTransform,
  };
}
