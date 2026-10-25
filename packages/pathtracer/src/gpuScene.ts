import type { RawImage } from '@modelshot/renderer-rt';
import { DATA_TEXTURE_WIDTH, type DataTexture, type PackedGeometry } from './packSceneData';
import type { TextureLayerPlan, TexturePlacement } from './textureLayers';

/** A scene's data on the GPU: RGBA32F data textures and the texture layers. */
export interface GpuScene {
  readonly nodes: WebGLTexture;
  readonly triPositions: WebGLTexture;
  readonly triAttributes: WebGLTexture;
  readonly materials: WebGLTexture;
  readonly layers: WebGLTexture;
  readonly nodeCount: number;
  readonly maxRenderOrder: number;
}

/** Storage for an RGBA32F data texture of `rows` rows, `DATA_TEXTURE_WIDTH` texels each, NEAREST; nothing written. */
export function createDataTexture(gl: WebGL2RenderingContext, rows: number): WebGLTexture {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, DATA_TEXTURE_WIDTH, rows);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return handle;
}

/** Writes rows `from .. from + count` of `texture` into `handle` (made by `createDataTexture`). */
export function writeDataRows(
  gl: WebGL2RenderingContext,
  handle: WebGLTexture,
  texture: DataTexture,
  from: number,
  count: number,
): void {
  const row = DATA_TEXTURE_WIDTH * 4;
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  const rows = texture.data.subarray(from * row, (from + count) * row);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, DATA_TEXTURE_WIDTH, count, gl.RGBA, gl.FLOAT, rows);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/** One RGBA32F data texture, NEAREST, `DATA_TEXTURE_WIDTH` texels per row. */
export function uploadData(gl: WebGL2RenderingContext, texture: DataTexture): WebGLTexture {
  const handle = createDataTexture(gl, texture.rows);
  writeDataRows(gl, handle, texture, 0, texture.rows);
  return handle;
}

/**
 * Storage for the SRGB8_ALPHA8 array texture of `plan`, NEAREST and a single level as in the preview (exact texels, no
 * mipmaps averaging across atlas regions); nothing written.
 */
export function createLayerTexture(gl: WebGL2RenderingContext, plan: TextureLayerPlan): WebGLTexture {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.SRGB8_ALPHA8, plan.width, plan.height, plan.layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return handle;
}

/** Writes `images` at their places (`TextureLayerPlan.placements`, same index), unflipped and unpremultiplied. */
export function writeLayerImages(
  gl: WebGL2RenderingContext,
  handle: WebGLTexture,
  images: readonly (readonly [TexturePlacement, ImageBitmap | RawImage])[],
): void {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (const [{ layer, x, y, width, height }, image] of images) {
    if ('data' in image) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
    } else {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

/**
 * Rows `from .. from + count` of `image` into its place. A RawImage by a view of its rows; an ImageBitmap by
 * UNPACK_SKIP_ROWS, which WebGL2 applies to a TexImageSource upload (reset to 0 after).
 */
export function writeLayerImageRows(
  gl: WebGL2RenderingContext,
  handle: WebGLTexture,
  place: TexturePlacement,
  image: ImageBitmap | RawImage,
  from: number,
  count: number,
): void {
  const { layer, x, y, width } = place;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if ('data' in image) {
    const rows = image.data.subarray(from * width * 4, (from + count) * width * 4);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y + from, layer, width, count, 1, gl.RGBA, gl.UNSIGNED_BYTE, rows);
  } else {
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, from);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y + from, layer, width, count, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

/** Each image with its place in `plan`; an image without one is left out. */
export function placedImages(
  plan: TextureLayerPlan,
  images: readonly (ImageBitmap | RawImage)[],
): [TexturePlacement, ImageBitmap | RawImage][] {
  const placed: [TexturePlacement, ImageBitmap | RawImage][] = [];
  images.forEach((image, index) => {
    const place = plan.placements[index];
    if (place) placed.push([place, image]);
  });
  return placed;
}

/** Every image in one SRGB8_ALPHA8 array texture at its planned place. */
function uploadLayers(
  gl: WebGL2RenderingContext,
  plan: TextureLayerPlan,
  images: readonly (ImageBitmap | RawImage)[],
): WebGLTexture {
  const handle = createLayerTexture(gl, plan);
  writeLayerImages(gl, handle, placedImages(plan, images));
  return handle;
}

export function uploadGpuScene(
  gl: WebGL2RenderingContext,
  geometry: PackedGeometry,
  materials: DataTexture,
  plan: TextureLayerPlan,
  images: readonly (ImageBitmap | RawImage)[],
): GpuScene {
  return {
    nodes: uploadData(gl, geometry.nodes),
    triPositions: uploadData(gl, geometry.triPositions),
    triAttributes: uploadData(gl, geometry.triAttributes),
    materials: uploadData(gl, materials),
    layers: uploadLayers(gl, plan, images),
    nodeCount: geometry.nodeCount,
    maxRenderOrder: geometry.maxRenderOrder,
  };
}

/** Deletes the textures of `scene` that `keep` (the handles of another scene sharing some of them) does not hold. */
export function disposeGpuScene(
  gl: WebGL2RenderingContext,
  scene: GpuScene,
  keep: Partial<GpuScene> | null = null,
): void {
  const kept = keep ? [keep.nodes, keep.triPositions, keep.triAttributes, keep.materials, keep.layers] : [];
  for (const texture of [scene.nodes, scene.triPositions, scene.triAttributes, scene.materials, scene.layers]) {
    if (!kept.includes(texture)) gl.deleteTexture(texture);
  }
}
