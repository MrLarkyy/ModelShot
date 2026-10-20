import { readOptionalIndex, readOptionalNumber, readOptionalNumbers, type JsonObject } from './gltfFields';

/** `KHR_texture_transform` of a texture reference. */
export interface TextureTransform {
  readonly offset: readonly [number, number];
  /** Radians, counter-clockwise in UV space. */
  readonly rotation: number;
  readonly scale: readonly [number, number];
  /** Overrides the reference's `texCoord` when set. */
  readonly texCoord: number | undefined;
}

/** Reads the extension object; every field optional, every number finite (else a `GltfError`). */
export function readTextureTransform(extension: JsonObject, path: string): TextureTransform {
  const [ox = 0, oy = 0] = readOptionalNumbers(extension, 'offset', path, [0, 0]);
  const [sx = 1, sy = 1] = readOptionalNumbers(extension, 'scale', path, [1, 1]);
  return {
    offset: [ox, oy],
    rotation: readOptionalNumber(extension, 'rotation', path, 0),
    scale: [sx, sy],
    texCoord: readOptionalIndex(extension, 'texCoord', path, 32),
  };
}

/** Applies `T · R · S` (the extension's order) to every UV pair in place. */
export function applyTextureTransform(uvs: Float32Array, transform: TextureTransform): void {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const [sx, sy] = transform.scale;
  const [ox, oy] = transform.offset;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = (uvs[i] ?? 0) * sx;
    const v = (uvs[i + 1] ?? 0) * sy;
    // Rows (cos, sin) and (−sin, cos), as three.js applies it: counter-clockwise as seen in the image (v down).
    uvs[i] = cos * u + sin * v + ox;
    uvs[i + 1] = -sin * u + cos * v + oy;
  }
}
