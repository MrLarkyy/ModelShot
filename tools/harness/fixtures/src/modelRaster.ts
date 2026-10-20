import cameraRaySource from '../shaders/include/cameraRay.glsl?raw';
import shadeSource from '../shaders/include/shade.glsl?raw';
import precisionSource from '../shaders/include/precision.glsl?raw';
import texelAlphaSource from '../shaders/include/texelAlpha.glsl?raw';
import fragmentSource from '../shaders/model.frag.glsl?raw';
import vertexSource from '../shaders/model.vert.glsl?raw';
import shadowSource from '../shaders/shadowDepth.frag.glsl?raw';
import { createProgram } from './context';
import { MODEL_SHADER_DEFINES } from './modelShaderDefines';
import { buildShader } from './shaderSource';
import { MODEL_VIEW_LOOK, cameraViewProjection, invert, lightViewProjection, viewAxis } from './modelViewCamera';
import { setMaterialUniforms, setShadeUniforms } from './modelUniforms';
import type { SceneTriangles } from './sceneTriangles';
import type { UploadedTextures } from './sceneUpload';

/**
 * Rasterises the scene into the default framebuffer: a depth-only pass from the light, alpha-tested, culling back
 * faces of single-sided runs as seen from the light (so only the opaque texels of a face whose front faces the light
 * cast a shadow); then the camera pass with the same per-run culling, alpha discard, a hard shadow-map lookup from
 * the receiver moved along its normal, and a depth of its own: the ray distance minus `renderOrder ·
 * RENDER_ORDER_TIE_DISTANCE`, the key the raycast compares, so both resolve render order identically.
 */
export function renderRaster(
  gl: WebGL2RenderingContext,
  triangles: SceneTriangles,
  textures: UploadedTextures,
  size: number,
): void {
  const vertex = buildVertex(vertexSource);
  const cameraProgram = createProgram(gl, vertex, buildFragment(fragmentSource, true));
  const shadowProgram = createProgram(gl, vertex, buildFragment(shadowSource, false));
  const vao = createVertexArray(gl, triangles);
  const shadow = createShadowMap(gl, MODEL_VIEW_LOOK.shadowMapSize);
  const light = lightViewProjection();

  gl.bindVertexArray(vao);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer);
  gl.viewport(0, 0, MODEL_VIEW_LOOK.shadowMapSize, MODEL_VIEW_LOOK.shadowMapSize);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.cullFace(gl.BACK);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);
  gl.useProgram(shadowProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(shadowProgram, 'u_viewProjection'), false, light);
  setMaterialUniforms(gl, shadowProgram, textures, 0);
  for (const run of triangles.runs) {
    setCulling(gl, run.doubleSided);
    gl.drawArrays(gl.TRIANGLES, run.first * 3, run.count * 3);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);

  const target = createCameraTarget(gl, size);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.viewport(0, 0, size, size);
  const [r, g, b] = MODEL_VIEW_LOOK.background;
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(cameraProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(cameraProgram, 'u_viewProjection'), false, cameraViewProjection(1));
  gl.uniformMatrix4fv(gl.getUniformLocation(cameraProgram, 'u_lightViewProjection'), false, light);
  gl.uniform3fv(gl.getUniformLocation(cameraProgram, 'u_eye'), MODEL_VIEW_LOOK.eye);
  gl.uniform3fv(gl.getUniformLocation(cameraProgram, 'u_forward'), viewAxis());
  gl.uniformMatrix4fv(
    gl.getUniformLocation(cameraProgram, 'u_inverseViewProjection'),
    false,
    invert(cameraViewProjection(1)),
  );
  gl.uniform2f(gl.getUniformLocation(cameraProgram, 'u_viewportSize'), size, size);
  setMaterialUniforms(gl, cameraProgram, textures, 0);
  setShadeUniforms(gl, cameraProgram);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, shadow.texture);
  gl.uniform1i(gl.getUniformLocation(cameraProgram, 'u_shadowMap'), 1);
  // LESS: at an exactly equal key the first triangle drawn stays, as the raycast keeps the first hit.
  gl.depthFunc(gl.LESS);
  const renderOrder = gl.getUniformLocation(cameraProgram, 'u_renderOrder');
  for (const run of triangles.runs) {
    setCulling(gl, run.doubleSided);
    gl.uniform1f(renderOrder, run.renderOrder);
    gl.drawArrays(gl.TRIANGLES, run.first * 3, run.count * 3);
  }
  gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * The camera pass draws into its own RGBA8 + DEPTH_COMPONENT24 target: the default framebuffer may have a 16-bit
 * depth buffer (WebGL guarantees only that), whose step over DEPTH_RANGE (about 0.003 units) is coarser than
 * RENDER_ORDER_TIE_DISTANCE; 24 bits give about 1.2e-5 units.
 */
function createCameraTarget(gl: WebGL2RenderingContext, size: number): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  for (const [format, attachment] of [
    [gl.RGBA8, gl.COLOR_ATTACHMENT0],
    [gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
  ] as const) {
    const buffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, format, size, size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('RGBA8 + DEPTH_COMPONENT24 camera target is incomplete');
  }
  return framebuffer;
}

/** Single-sided runs show only their front (counter-clockwise) side, to the camera and to the light alike. */
function setCulling(gl: WebGL2RenderingContext, doubleSided: boolean): void {
  if (doubleSided) gl.disable(gl.CULL_FACE);
  else gl.enable(gl.CULL_FACE);
}

function buildVertex(stage: string): string {
  return buildShader(stage, [precisionSource], MODEL_SHADER_DEFINES);
}

function buildFragment(stage: string, shaded: boolean): string {
  const includes = [precisionSource, texelAlphaSource];
  return buildShader(stage, shaded ? [...includes, shadeSource, cameraRaySource] : includes, MODEL_SHADER_DEFINES);
}

/** Attribute `index` of this list is `layout(location = index)` in model.vert.glsl. */
function createVertexArray(gl: WebGL2RenderingContext, triangles: SceneTriangles): WebGLVertexArrayObject {
  const n = triangles.count * 3;
  const rects = new Float32Array(n * 4);
  const materials = new Int32Array(n);
  const corners = [0, 1, 2].map(() => new Float32Array(n * 3));
  for (let t = 0; t < triangles.count; t++) {
    for (let c = 0; c < 3; c++) {
      rects.set(triangles.rects.subarray(t * 4, t * 4 + 4), (t * 3 + c) * 4);
      materials[t * 3 + c] = triangles.materials[t] ?? 0;
      corners.forEach((array, k) =>
        array.set(triangles.positions.subarray(t * 9 + k * 3, t * 9 + k * 3 + 3), (t * 3 + c) * 3),
      );
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attributes: [Float32Array | Int32Array, number][] = [
    [triangles.positions, 3],
    [triangles.normals, 3],
    [triangles.uvs, 2],
    [rects, 4],
    [materials, 1],
    ...corners.map((array): [Float32Array, number] => [array, 3]),
  ];
  attributes.forEach(([data, components], index) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(index);
    if (data instanceof Int32Array) gl.vertexAttribIPointer(index, components, gl.INT, 0, 0);
    else gl.vertexAttribPointer(index, components, gl.FLOAT, false, 0, 0);
  });
  gl.bindVertexArray(null);
  return vao;
}

function createShadowMap(gl: WebGL2RenderingContext, side: number) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, side, side);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('DEPTH_COMPONENT24 shadow map is incomplete');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
}
