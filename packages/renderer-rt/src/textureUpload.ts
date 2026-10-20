import { COVERAGE_PARTIAL, texelCoverageByte, type AlphaModeId } from '@modelshot/looks';

/** Which of the 256 alpha bytes occur in a texture, as 256 flags. */
export type AlphaLevels = Uint8Array;

export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** RGBA8, rows top to bottom, straight alpha. */
  readonly data: Uint8Array;
}

/** Shown where a texture is missing or rejected: a 2x2 grey checker (no hue, so it never reads as the sentinel). */
export const PLACEHOLDER_IMAGE: RawImage = {
  width: 2,
  height: 2,
  data: new Uint8Array([200, 200, 200, 255, 96, 96, 96, 255, 96, 96, 96, 255, 200, 200, 200, 255]),
};

/** Faces without a material or texture. */
export const UNTEXTURED_IMAGE: RawImage = { width: 1, height: 1, data: new Uint8Array([214, 214, 214, 255]) };

/**
 * Uploads an image as SRGB8_ALPHA8 with NEAREST filtering and a single level: pixel art needs exact texels, and
 * mipmaps would average across atlas regions. No flip and no premultiplication, so texel (0, 0) is the top-left pixel
 * and alpha stays exact.
 */
export function uploadTexture(gl: WebGL2RenderingContext, image: ImageBitmap | RawImage): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, image.width, image.height);
  if ('data' in image) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
  return texture;
}

/** The alpha bytes present in an RGBA8 image. */
export function alphaLevelsOf(rgba: Uint8Array): AlphaLevels {
  const levels = new Uint8Array(256);
  for (let i = 3; i < rgba.length; i += 4) levels[rgba[i] ?? 255] = 1;
  return levels;
}

/** Whether any present alpha byte is partially covering under the given mode id and cutoff byte. */
export function hasPartialCoverage(levels: AlphaLevels, modeId: AlphaModeId, cutoffByte: number): boolean {
  for (let k = 0; k < 256; k++) {
    if (levels[k] === 1 && texelCoverageByte(k, modeId, cutoffByte) === COVERAGE_PARTIAL) return true;
  }
  return false;
}

/**
 * Reads an uploaded texture back through a temporary framebuffer (one readback per texture, at scene load) and
 * returns the alpha bytes it holds, so each draw knows whether its alpha rule leaves partial texels for the
 * transparency pass.
 */
export function readAlphaLevels(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
): AlphaLevels {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  // When the readback is impossible every byte counts as present: drawing a texture in both passes is always correct.
  let levels: AlphaLevels = new Uint8Array(256).fill(1);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    levels = alphaLevelsOf(pixels);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  return levels;
}
