import type { RawImage } from '@modelshot/renderer-rt';
import { DATA_TEXTURE_WIDTH, type DataTexture, type PackedGeometry } from './packSceneData';
import type { TextureLayerPlan } from './textureLayers';

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

function uploadData(gl: WebGL2RenderingContext, texture: DataTexture): WebGLTexture {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, DATA_TEXTURE_WIDTH, texture.rows);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_TEXTURE_WIDTH, texture.rows, gl.RGBA, gl.FLOAT, texture.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return handle;
}

/**
 * Every image in one SRGB8_ALPHA8 array texture at its planned place, NEAREST and a single level as in the preview
 * (exact texels, no mipmaps averaging across atlas regions), unflipped and unpremultiplied.
 */
function uploadLayers(
  gl: WebGL2RenderingContext,
  plan: TextureLayerPlan,
  images: readonly (ImageBitmap | RawImage)[],
): WebGLTexture {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.SRGB8_ALPHA8, plan.width, plan.height, plan.layers);
  images.forEach((image, index) => {
    const place = plan.placements[index];
    if (!place) return;
    const { layer, x, y, width, height } = place;
    if ('data' in image) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
    } else {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
  });
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
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

export function disposeGpuScene(gl: WebGL2RenderingContext, scene: GpuScene): void {
  for (const texture of [scene.nodes, scene.triPositions, scene.triAttributes, scene.materials, scene.layers]) {
    gl.deleteTexture(texture);
  }
}
