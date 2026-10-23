import type { RenderedImage } from '@modelshot/pathtracer';
import { deflateZlib } from './deflateZlib';
import { filterScanlines } from './filterScanlines';
import { ihdr, PNG_SIGNATURE, pngChunk } from './pngChunks';

/** The image as an 8-bit RGBA PNG (straight alpha, as `readImage` gives it): lossless, never resampled. */
export async function encodePng(
  image: RenderedImage,
  deflate: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>> = deflateZlib,
): Promise<Blob> {
  const idat = pngChunk('IDAT', await deflate(filterScanlines(image)));
  return new Blob([PNG_SIGNATURE, ihdr(image.width, image.height), idat, pngChunk('IEND', new Uint8Array(0))], {
    type: 'image/png',
  });
}
