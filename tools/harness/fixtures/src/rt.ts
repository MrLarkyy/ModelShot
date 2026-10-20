import { observeCanvasSize, RealtimeRenderer, type RendererWarning } from '@modelshot/renderer-rt';
import { cameraProjection, cameraView, mat4Multiply, type SceneDocument } from '@modelshot/scene';
import { installFrameBench, installFrameReadout } from './bench';
import { readDrawingBufferBase64 } from './context';
import type { MsFixture, RtControls } from './fixtureApi';
import { installGlTracker } from './glTracker';
import { isRtSceneName, parseRtView, reverseMeshOrder, rtCamera, rtScene, type RtSceneName } from './rtScenes';

// URL parameters: variant (a preset of rtScenes.ts) or scene, yaw, pitch, proj=persp|ortho, fov, zoom, iso=0|1,
// aa=0|1, fallback=1, reverse=1; size (CSS pixels, default 256), maxTextureSide, track=1 (count GL objects),
// fps=1 (continuous drawing with a frame-time readout, for a manual run on real hardware).
const params = new URLSearchParams(location.search);

function intParam(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`query parameter ${name} must be an integer in ${min}..${max}`);
  }
  return Number(raw);
}

const tracker = params.get('track') === '1' ? installGlTracker() : null;
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const api: MsFixture = {
  ready: Promise.resolve(),
  renderer: '',
  floatRenderTargets: false,
  get width() {
    return canvas.width;
  },
  get height() {
    return canvas.height;
  },
  samplesDone: 0,
  readRGBA: () => {
    throw new Error('fixture not ready');
  },
};
window.__msFixture = api;

async function start(): Promise<void> {
  const size = intParam('size', 256, 16, 4096);
  const maxTextureSide = intParam('maxTextureSide', 4096, 1, 16384);
  const continuous = params.get('fps') === '1';
  const view = parseRtView(params);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const renderer = RealtimeRenderer.create(canvas, {
    forceFallback: view.fallback,
    texelAntialias: view.texelAntialias,
    preserveDrawingBuffer: !continuous,
    maxTextureSide,
  });
  const capabilities = renderer.capabilities;
  if (!capabilities) throw new Error('renderer has no capabilities');
  // The same context the renderer created (getContext returns it again).
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 context missing');
  api.renderer = capabilities.limits.renderer;
  api.floatRenderTargets = capabilities.limits.colorBufferFloat;
  api.readRGBA = () => readDrawingBufferBase64(gl, canvas.width, canvas.height);

  const sceneOf = (name: RtSceneName): SceneDocument => {
    const doc = rtScene(name);
    return view.reverse ? reverseMeshOrder(doc) : doc;
  };
  let doc = sceneOf(view.scene);
  let warnings: readonly RendererWarning[] = [];
  const frame = (): void => {
    renderer.setCamera(rtCamera(doc, view, canvas.width / canvas.height));
    renderer.render();
  };

  renderer.resize({ cssWidth: size, cssHeight: size, devicePixelRatio: window.devicePixelRatio });
  warnings = (await renderer.setScene(doc)).warnings;
  frame();

  const resized: (() => void)[] = [];
  observeCanvasSize(canvas, (cssSize) => {
    const before = `${canvas.width}x${canvas.height}`;
    renderer.resize(cssSize);
    if (`${canvas.width}x${canvas.height}` !== before) frame();
    for (const resolve of resized.splice(0)) resolve();
  });

  installFrameBench(api, gl, () => renderer.render());
  if (continuous) {
    const output = document.createElement('output');
    document.body.appendChild(output);
    installFrameReadout(gl, () => renderer.render(), output, capabilities.limits.renderer);
  }

  const lose = gl.getExtension('WEBGL_lose_context');
  const controls: RtControls = {
    path: capabilities.path,
    msaaSamples: capabilities.msaaSamples,
    get warnings() {
      return warnings.map(({ code, texture }) => ({ code, texture }));
    },
    get contextLost() {
      return renderer.contextLost;
    },
    liveGlObjects: () => tracker?.liveGlObjects() ?? -1,
    openBitmaps: () => tracker?.openBitmaps() ?? -1,
    render: () => renderer.render(),
    lose: () =>
      new Promise((resolve, reject) => {
        if (!lose) return reject(new Error('WEBGL_lose_context is not available'));
        canvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
        lose.loseContext();
      }),
    restore: () =>
      new Promise((resolve, reject) => {
        if (!lose) return reject(new Error('WEBGL_lose_context is not available'));
        const stop = renderer.onContextRestored(() => {
          stop();
          resolve();
        });
        lose.restoreContext();
      }),
    dispose: () => renderer.dispose(),
    setScenes: async (names) => {
      const docs = names.map((name) => {
        if (!isRtSceneName(name)) throw new Error(`unknown scene "${name}"`);
        return sceneOf(name);
      });
      const results = await Promise.all(docs.map((next) => renderer.setScene(next)));
      results.forEach((result, i) => {
        if (result.applied) {
          doc = docs[i] ?? doc;
          warnings = result.warnings;
        }
      });
      frame();
      return results.map((result) => result.applied);
    },
    disposeDuringDecode: async () => {
      const pending = renderer.setScene(sceneOf('showcase'));
      renderer.dispose();
      return (await pending).applied;
    },
    project: (x, y, z) => {
      const aspect = canvas.width / canvas.height;
      const camera = rtCamera(doc, view, aspect);
      const m = mat4Multiply(cameraProjection(camera, aspect), cameraView(camera));
      const row = (r: number): number => (m[r] ?? 0) * x + (m[4 + r] ?? 0) * y + (m[8 + r] ?? 0) * z + (m[12 + r] ?? 0);
      const w = row(3);
      return [((row(0) / w) * 0.5 + 0.5) * canvas.width, (0.5 - (row(1) / w) * 0.5) * canvas.height];
    },
    setCssSize: (width, height) =>
      new Promise((resolve) => {
        resized.push(resolve);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }),
  };
  api.rt = controls;
}

api.ready = start();
api.ready.catch(() => undefined);
