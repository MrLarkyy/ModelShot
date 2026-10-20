import { MODEL_VIEW_LOOK } from './modelViewCamera';
import { MAX_MATERIALS, type DrawMaterial, type UploadedTextures } from './sceneUpload';

/** The material table and texture array of `texelAlpha.glsl`, the texture on unit `unit`. */
export function setMaterialUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  textures: UploadedTextures,
  unit: number,
): void {
  const location = (name: string) => gl.getUniformLocation(program, name);
  const table = <T>(pick: (material: DrawMaterial) => T, fill: T): T[] =>
    Array.from({ length: MAX_MATERIALS }, (_, i) => {
      const material = textures.materials[i];
      return material ? pick(material) : fill;
    });
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, textures.texture);
  gl.uniform1i(location('u_textures'), unit);
  const layers = table((m) => m.layer, -1);
  const modes = table((m) => m.mode, 0);
  const cutoffs = table((m) => m.cutoff, 0.5);
  gl.uniform1iv(location('u_materialLayer'), layers);
  gl.uniform1iv(location('u_materialMode'), modes);
  gl.uniform1fv(location('u_materialCutoff'), cutoffs);
  const sizes = Array.from({ length: MAX_MATERIALS }, (_, i) => textures.sizes[i] ?? [1, 1]);
  gl.uniform2iv(location('u_layerSize'), sizes.flat());
  gl.uniform3fv(location('u_untexturedColor'), MODEL_VIEW_LOOK.untextured);
}

/** The light and ambient term of `shade.glsl`. */
export function setShadeUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  gl.uniform3fv(gl.getUniformLocation(program, 'u_toLight'), MODEL_VIEW_LOOK.toLight);
  gl.uniform1f(gl.getUniformLocation(program, 'u_ambient'), MODEL_VIEW_LOOK.ambient);
}
