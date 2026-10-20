import fragmentSource from '../shaders/gradient.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen.vert.glsl?raw';
import { installFrameBench } from './bench';
import { createContext, createProgram, readDrawingBufferBase64 } from './context';
import type { MsFixture } from './fixtureApi';

const SIZE = 256;
const VARIANTS: Record<string, number> = { broken: 1, nudge: 2 };

const ctx = createContext(SIZE);
const { gl } = ctx;
const api: MsFixture = {
  ready: Promise.resolve(),
  renderer: ctx.renderer,
  floatRenderTargets: ctx.floatRenderTargets,
  width: SIZE,
  height: SIZE,
  samplesDone: 0,
  readRGBA: () => readDrawingBufferBase64(gl, SIZE, SIZE),
};
window.__msFixture = api;

function start(): void {
  const variantName = new URLSearchParams(location.search).get('variant');
  const variant = variantName === null ? 0 : VARIANTS[variantName];
  if (variant === undefined) throw new Error(`unknown variant "${String(variantName)}"`);
  const program = createProgram(gl, vertexSource, fragmentSource);
  const variantLocation = gl.getUniformLocation(program, 'u_variant');
  const vao = gl.createVertexArray();
  const drawFrame = (): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, SIZE, SIZE);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1i(variantLocation, variant);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  drawFrame();
  installFrameBench(api, gl, drawFrame);
}

try {
  start();
  api.ready = Promise.race([ctx.lost, Promise.resolve()]);
} catch (error) {
  api.ready = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  api.ready.catch(() => undefined);
}
