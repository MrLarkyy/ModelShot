import cameraRaySource from '../shaders/include/cameraRay.glsl?raw';
import shadeSource from '../shaders/include/shade.glsl?raw';
import precisionSource from '../shaders/include/precision.glsl?raw';
import texelAlphaSource from '../shaders/include/texelAlpha.glsl?raw';
import vertexSource from '../shaders/fullscreen.vert.glsl?raw';
import raycastSource from '../shaders/raycast.frag.glsl?raw';
import { createProgram } from './context';
import { MODEL_VIEW_LOOK, cameraViewProjection, invert, viewAxis } from './modelViewCamera';
import { setMaterialUniforms, setShadeUniforms } from './modelUniforms';
import type { SceneTriangles } from './sceneTriangles';
import type { UploadedTextures } from './sceneUpload';
import { MODEL_SHADER_DEFINES } from './modelShaderDefines';
import { buildShader } from './shaderSource';

/** Brute force: every pixel tests every triangle, twice (camera ray, shadow ray). */
export const MAX_RAYCAST_TRIANGLES = 256;
const ROWS_PER_TRIANGLE = 9;

/**
 * One camera ray through each pixel centre to the nearest hit whose texel passes the alpha test (single-sided faces
 * only from the front; coincident hits by render order), shaded with the interpolated vertex normal, then one shadow
 * ray toward the light blocked by any alpha-passing hit except a camera-only one, single-sided faces only when their front faces the light.
 * Deterministic: no samples, no seed.
 */
export function renderRaycast(
  gl: WebGL2RenderingContext,
  triangles: SceneTriangles,
  textures: UploadedTextures,
  size: number,
): void {
  const maxSide = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  if (triangles.count > MAX_RAYCAST_TRIANGLES || triangles.count > maxSide) {
    throw new Error(
      `the raycast variant draws at most ${MAX_RAYCAST_TRIANGLES} triangles, the model has ${triangles.count}`,
    );
  }
  const vertex = buildShader(vertexSource, []);
  const fragment = buildShader(
    raycastSource,
    [precisionSource, texelAlphaSource, shadeSource, cameraRaySource],
    MODEL_SHADER_DEFINES,
  );
  const program = createProgram(gl, vertex, fragment);
  const data = createTriangleTexture(gl, triangles);
  const viewProjection = cameraViewProjection(1);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, size, size);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(program);
  setMaterialUniforms(gl, program, textures, 0);
  setShadeUniforms(gl, program);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, data);
  gl.uniform1i(gl.getUniformLocation(program, 'u_triangles'), 2);
  gl.uniform1i(gl.getUniformLocation(program, 'u_triangleCount'), triangles.count);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_inverseViewProjection'), false, invert(viewProjection));
  gl.uniform3fv(gl.getUniformLocation(program, 'u_eye'), MODEL_VIEW_LOOK.eye);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_forward'), viewAxis());
  gl.uniform2f(gl.getUniformLocation(program, 'u_viewportSize'), size, size);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_background'), MODEL_VIEW_LOOK.background);
  gl.bindVertexArray(gl.createVertexArray());
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

/** Row layout documented in raycast.frag.glsl. */
function createTriangleTexture(gl: WebGL2RenderingContext, triangles: SceneTriangles): WebGLTexture {
  const rows = new Float32Array(Math.max(1, triangles.count) * ROWS_PER_TRIANGLE * 4);
  for (let t = 0; t < triangles.count; t++) {
    const base = t * ROWS_PER_TRIANGLE * 4;
    const p = (c: number) => triangles.positions.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3);
    const uv = (c: number) => triangles.uvs.subarray(t * 6 + c * 2, t * 6 + c * 2 + 2);
    rows.set([...p(0), triangles.materials[t] ?? 0], base);
    rows.set([...p(1), triangles.doubleSided[t] ?? 0], base + 4);
    rows.set([...p(2), triangles.renderOrders[t] ?? 0], base + 8);
    rows.set([...uv(0), ...uv(1)], base + 12);
    rows.set([...uv(2), triangles.cameraOnly[t] ?? 0, 0], base + 16);
    rows.set(triangles.rects.subarray(t * 4, t * 4 + 4), base + 20);
    for (let c = 0; c < 3; c++)
      rows.set([...triangles.normals.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3), 0], base + 24 + c * 4);
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    ROWS_PER_TRIANGLE,
    Math.max(1, triangles.count),
    0,
    gl.RGBA,
    gl.FLOAT,
    rows,
  );
  return texture;
}
