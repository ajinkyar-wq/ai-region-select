export function generateMaskPreview(
    maskData: Uint8Array,
    width: number,
    height: number,
    color: string = '#FFFFFF'
): string {
    const canvas = document.createElement('canvas');
    // Use a small size for thumbnail to save memory/processing
    // Maintain aspect ratio
    const MAX_SIZE = 64;
    let thumbW = width;
    let thumbH = height;

    if (width > height) {
        if (width > MAX_SIZE) {
            thumbW = MAX_SIZE;
            thumbH = Math.round(height * (MAX_SIZE / width));
        }
    } else {
        if (height > MAX_SIZE) {
            thumbH = MAX_SIZE;
            thumbW = Math.round(width * (MAX_SIZE / height));
        }
    }

    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Create a temporary full-size canvas to draw the mask data first
    // (Alternatively we could downsample manually but this is easier)
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = width;
    fullCanvas.height = height;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) return '';

    const imgData = fullCtx.createImageData(width, height);

    // Parse color
    let r = 255, g = 255, b = 255;
    if (color.startsWith('#')) {
        const hex = color.substring(1);
        if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
    }

    // Draw mask pixels
    for (let i = 0; i < maskData.length; i++) {
        const alpha = maskData[i];
        if (alpha > 0) {
            const idx = i * 4;
            imgData.data[idx] = r;
            imgData.data[idx + 1] = g;
            imgData.data[idx + 2] = b;
            imgData.data[idx + 3] = alpha; // Use actual alpha from mask
        }
    }

    fullCtx.putImageData(imgData, 0, 0);

    // Draw scaled down to thumbnail
    ctx.drawImage(fullCanvas, 0, 0, thumbW, thumbH);

    return canvas.toDataURL('image/png');
}
