import fragmentSource from '../shaders/progressive.frag.glsl?raw';
import resolveSource from '../shaders/resolve.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen.vert.glsl?raw';
import { installSampleBench } from './bench';
import { createContext, createProgram, readDrawingBufferBase64, requireFloatTargets } from './context';
import type { MsFixture } from './fixtureApi';

const SIZE = 256;
const MAX_SEED = 2 ** 32 - 1;
const MAX_SAMPLES = 4096;

function parseBounded(params: URLSearchParams, name: string, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null || !/^\d{1,10}$/.test(raw)) throw new Error(`query parameter ${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`query parameter ${name} must be in ${min}..${max}`);
  return value;
}

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
  const params = new URLSearchParams(location.search);
  const seed = parseBounded(params, 'seed', 0, MAX_SEED);
  const samples = parseBounded(params, 'samples', 1, MAX_SAMPLES);
  requireFloatTargets(ctx);

  const accumProgram = createProgram(gl, vertexSource, fragmentSource);
  const resolveProgram = createProgram(gl, vertexSource, resolveSource);
  const seedLocation = gl.getUniformLocation(accumProgram, 'u_seed');
  const sampleLocation = gl.getUniformLocation(accumProgram, 'u_sample');
  const accumLocation = gl.getUniformLocation(resolveProgram, 'u_accum');
  const samplesLocation = gl.getUniformLocation(resolveProgram, 'u_samples');
  const vao = gl.createVertexArray();

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, SIZE, SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('RGBA16F accumulation target is incomplete');
  }
  gl.bindVertexArray(vao);

  const accumulate = (count: number): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, SIZE, SIZE);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(accumProgram);
    gl.uniform1ui(seedLocation, seed);
    for (let i = 0; i < count; i++) {
      gl.uniform1ui(sampleLocation, i);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  };

  const resolve = (count: number): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, SIZE, SIZE);
    gl.useProgram(resolveProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(accumLocation, 0);
    gl.uniform1f(samplesLocation, count);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  accumulate(samples);
  resolve(samples);
  api.samplesDone = samples;
  installSampleBench(api, gl, (count) => {
    accumulate(count);
    resolve(count);
  });
}

try {
  start();
  api.ready = Promise.race([ctx.lost, Promise.resolve()]);
} catch (error) {
  api.ready = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  api.ready.catch(() => undefined);
}
