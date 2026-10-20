import { resolveMaterialAlpha, texelCoverage, type SceneDocument } from '@modelshot/scene';

/** Must equal `MAX_MATERIALS` in `shaders/include/texelAlpha.glsl`. */
export const MAX_MATERIALS = 8;

const MODE_CODES = { opaque: 0, mask: 1, blend: 2 } as const;

/** One slot of the shaders' material table; slot 0 is untextured, slot `m + 1` scene material `m`. */
export interface DrawMaterial {
  /** Texture array layer, −1 for untextured. */
  readonly layer: number;
  readonly mode: 0 | 1 | 2;
  readonly cutoff: number;
}

export interface UploadedTextures {
  /** `TEXTURE_2D_ARRAY`, RGBA8, one layer per scene texture, NEAREST, no mipmaps. */
  readonly texture: WebGLTexture;
  /** Pixel size of each layer. */
  readonly sizes: readonly (readonly [number, number])[];
  /** RGBA rows of each layer as the GPU holds them, top row first. */
  readonly pixels: readonly Uint8Array[];
  readonly materials: readonly DrawMaterial[];
}

/**
 * Decodes each scene texture without premultiplying or colour conversion (an alpha-0 texel keeps its RGB), uploads it
 * unflipped (row 0 is the top, as scene UVs expect), reads it back to see exactly what the shaders sample, and rejects
 * a partially transparent texel under a blended material: this fixture draws cutout alpha only.
 */
export async function uploadTextures(gl: WebGL2RenderingContext, scene: SceneDocument): Promise<UploadedTextures> {
  if (scene.materials.length + 1 > MAX_MATERIALS) {
    throw new Error(
      `the model-view fixture supports ${MAX_MATERIALS - 1} materials, the model has ${scene.materials.length}`,
    );
  }
  const bitmaps = await Promise.all(
    scene.textures.map(async (texture) => {
      if (!texture.bytes) throw new Error(`texture "${texture.name}" is missing`);
      const blob = new Blob([texture.bytes.slice()], { type: texture.mimeType });
      return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }),
  );
  const maxSide = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const maxLayers = Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS));
  const width = Math.max(1, ...bitmaps.map((b) => b.width));
  const height = Math.max(1, ...bitmaps.map((b) => b.height));
  if (width > maxSide || height > maxSide) throw new Error(`a texture exceeds MAX_TEXTURE_SIZE ${maxSide}`);
  const layers = Math.max(1, bitmaps.length);
  if (layers > maxLayers) throw new Error(`more textures than MAX_ARRAY_TEXTURE_LAYERS ${maxLayers}`);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, layers);
  for (const [parameter, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
    [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ] as const) {
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, parameter, value);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  bitmaps.forEach((bitmap, layer) => {
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      bitmap.width,
      bitmap.height,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bitmap,
    );
  });
  const pixels = bitmaps.map((bitmap, layer) => readLayer(gl, texture, layer, bitmap.width, bitmap.height));
  const sizes = bitmaps.map((bitmap): [number, number] => [bitmap.width, bitmap.height]);
  bitmaps.forEach((bitmap) => bitmap.close());

  const materials: DrawMaterial[] = [{ layer: -1, mode: 0, cutoff: 0.5 }];
  scene.materials.forEach((material) => {
    const rule = resolveMaterialAlpha(material);
    const layerPixels = pixels[material.texture];
    if (layerPixels && rule.mode === 'blend') {
      for (let i = 3; i < layerPixels.length; i += 4) {
        if (texelCoverage((layerPixels[i] ?? 255) / 255, rule) === 'partial') {
          const name = scene.textures[material.texture]?.name ?? '';
          throw new Error(
            `texture "${name}" has a partially transparent texel; the model-view fixture draws cutout alpha only`,
          );
        }
      }
    }
    materials.push({ layer: layerPixels ? material.texture : -1, mode: MODE_CODES[rule.mode], cutoff: rule.cutoff });
  });
  return { texture, sizes, pixels, materials };
}

function readLayer(gl: WebGL2RenderingContext, texture: WebGLTexture, layer: number, width: number, height: number) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, layer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('cannot read back an RGBA8 texture layer');
  }
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  return pixels;
}
