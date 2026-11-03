import { decodeTextures, DEFAULT_MAX_TEXTURE_PIXELS_TOTAL } from '@modelshot/renderer-rt';
import type { SceneTexture } from '@modelshot/scene';
import wideExifUri from '../../../../packages/formats/test/fixtures/jpeg/wide-exif6.jpg?inline';
import type { DecodedTextureProbe } from './fixtureApi';
import { isRtSceneName, rtScene } from './rtScenes';

const WIDE_EXIF: SceneTexture = {
  name: 'wide-exif6.jpg',
  mimeType: 'image/jpeg',
  bytes: Uint8Array.from(atob(wideExifUri.slice(wideExifUri.indexOf(',') + 1)), (c) => c.charCodeAt(0)),
  width: 16,
  height: 8,
  uvWidth: 16,
  uvHeight: 8,
  missing: false,
};

/**
 * Decodes the textures of a JPEG fixture scene (`gltf-jpeg`, `obj-jpeg`) or `wide-exif6.jpg` with the renderers'
 * `decodeTextures` and reads their RGBA back, so a spec compares the decoded texels with the generator's colours.
 */
export async function decodeProbe(source: string): Promise<DecodedTextureProbe> {
  if (source !== 'wide-exif6.jpg' && !isRtSceneName(source)) throw new Error(`unknown scene ${source}`);
  const textures = source === 'wide-exif6.jpg' ? [WIDE_EXIF] : rtScene(source).textures;
  const limits = { maxTextureSide: 4096, maxTexturePixelsTotal: DEFAULT_MAX_TEXTURE_PIXELS_TOTAL };
  const decoded = await decodeTextures(textures, limits, () => true);
  if (!decoded) throw new Error('decodeTextures was superseded');
  const images = decoded.bitmaps.map((bitmap) => {
    if (!bitmap) return null;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D context');
    context.drawImage(bitmap, 0, 0);
    const rgba = [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
    const image = { width: bitmap.width, height: bitmap.height, rgba };
    bitmap.close();
    return image;
  });
  return {
    mimeTypes: textures.map((t) => t.mimeType),
    images,
    warnings: decoded.warnings.map((w) => w.code),
  };
}
