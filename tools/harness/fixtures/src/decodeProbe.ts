import { decodeTextures, DEFAULT_MAX_TEXTURE_PIXELS_TOTAL } from '@modelshot/renderer-rt';
import type { SceneTexture } from '@modelshot/scene';
import wideExifUri from '../../../../packages/formats/test/fixtures/jpeg/wide-exif6.jpg?inline';
import widePngUri from '../../../../packages/formats/test/fixtures/jpeg/wide-exif6.png?inline';
import type { DecodedTextureProbe } from './fixtureApi';
import { isRtSceneName, rtScene, type RtSceneName } from './rtScenes';

const fromUri = (uri: string) => Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));

/** The JPEG with 0x00 and 0x12 stray bytes (and an FF00) inserted before its Exif segment, which libjpeg skips. */
function padded(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...bytes.subarray(0, 2),
    0xff,
    0xfe,
    0x00,
    0x02,
    0x00,
    0x12,
    0xff,
    0x00,
    0x34,
    ...bytes.subarray(2),
  ]);
}

const WIDE_EXIF: SceneTexture = {
  name: 'wide-exif6.jpg',
  mimeType: 'image/jpeg',
  bytes: fromUri(wideExifUri),
  width: 16,
  height: 8,
  uvWidth: 16,
  uvHeight: 8,
  missing: false,
};

const WIDE_VARIANTS: Record<string, SceneTexture> = {
  'wide-exif6.jpg': WIDE_EXIF,
  'wide-exif6-padded.jpg': {
    ...WIDE_EXIF,
    name: 'wide-exif6-padded.jpg',
    bytes: padded(WIDE_EXIF.bytes ?? new Uint8Array(0)),
  },
  'wide-exif6.png': { ...WIDE_EXIF, name: 'wide-exif6.png', mimeType: 'image/png', bytes: fromUri(widePngUri) },
};

/**
 * Decodes the textures of a JPEG fixture scene (`gltf-jpeg`, `obj-jpeg`) or a `wide-exif6` variant (`.jpg`, `-padded.jpg`, `.png`) with the renderers'
 * `decodeTextures` and reads their RGBA back, so a spec compares the decoded texels with the generator's colours.
 */
export async function decodeProbe(source: string): Promise<DecodedTextureProbe> {
  const wide = WIDE_VARIANTS[source];
  if (!wide && !isRtSceneName(source)) throw new Error(`unknown scene ${source}`);
  const textures = wide ? [wide] : rtScene(source as RtSceneName).textures;
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
