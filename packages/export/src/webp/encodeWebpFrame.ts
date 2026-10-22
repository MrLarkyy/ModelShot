import type { RenderedImage } from '@modelshot/pathtracer';
import { ExportError } from '../ExportError';

/**
 * One frame as a still WebP from the browser's own encoder (OffscreenCanvas, quality 1: lossless in Chromium). A
 * browser that cannot encode WebP hands back another type, which throws `UNSUPPORTED_FORMAT`.
 */
export async function encodeWebpFrame(image: RenderedImage): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof OffscreenCanvas !== 'function') {
    throw new ExportError('UNSUPPORTED_FORMAT', 'this browser has no OffscreenCanvas to encode WebP with');
  }
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new ExportError('UNSUPPORTED_FORMAT', 'this browser has no 2D canvas to encode WebP with');
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 1 });
  if (blob.type !== 'image/webp') {
    throw new ExportError('UNSUPPORTED_FORMAT', `this browser encodes ${blob.type || 'nothing'} instead of WebP`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}
