import type { JsonObject } from '../json/JsonObject';
import { readOptionalIndex, readOptionalNumber, readOptionalNumbers } from './gltfFields';
import type { Mat3 } from '../math/Mat3';

/** `KHR_texture_transform` of a texture reference. */
export interface TextureTransform {
  readonly offset: readonly [number, number];
  /** Radians; the UVs turn counter-clockwise (the image clockwise), as the extension defines. */
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

/**
 * The extension's matrix `T · R · S` (row-major, acting on `(u, v, 1)`), with its rotation matrix rows `(cos, sin, 0)`
 * and `(−sin, cos, 0)`: for a positive angle the UVs turn counter-clockwise in UV space, whose v axis points down.
 * The Khronos glTF Sample Viewer builds the same matrix.
 */
export function textureTransformMatrix(transform: TextureTransform): Mat3 {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const [sx, sy] = transform.scale;
  const [ox, oy] = transform.offset;
  const t = [1, 0, ox, 0, 1, oy, 0, 0, 1];
  const r = [cos, sin, 0, -sin, cos, 0, 0, 0, 1];
  const s = [sx, 0, 0, 0, sy, 0, 0, 0, 1];
  return multiply(multiply(t, r), s);
}

/** Applies `textureTransformMatrix` to every UV pair in place. */
export function applyTextureTransform(uvs: Float32Array, transform: TextureTransform): void {
  const m = textureTransformMatrix(transform);
  const a = (i: number): number => m[i] ?? 0;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = uvs[i] ?? 0;
    const v = uvs[i + 1] ?? 0;
    uvs[i] = a(0) * u + a(1) * v + a(2);
    uvs[i + 1] = a(3) * u + a(4) * v + a(5);
  }
}

function multiply(a: Mat3, b: Mat3): number[] {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (a[row * 3 + k] ?? 0) * (b[k * 3 + column] ?? 0);
      out.push(sum);
    }
  }
  return out;
}
