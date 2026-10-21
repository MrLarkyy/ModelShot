import {
  MAX_SAMPLES,
  MAX_SEED,
  PathTracer,
  PathTracerError,
  type PathTracerWarning,
  type SetSceneOptions,
} from '@modelshot/pathtracer';
import { cameraProjection, cameraView, mat4Multiply, type SceneDocument } from '@modelshot/scene';
import { installSampleBench, installSampleReadout, installSceneBench } from './bench';
import { readDrawingBufferBase64 } from './context';
import type { MsFixture, PtControls, PtProbe } from './fixtureApi';
import { installGlTracker } from './glTracker';
import { computePtProbes, sceneProbes } from './ptProbes';
import { isRtSceneName, parseRtView, reverseMeshOrder, rtCamera, rtScene, type RtSceneName } from './rtScenes';

// URL parameters: the realtime fixture's view (variant, scene, yaw, pitch, proj, fov, zoom, iso, reverse, look, depth;
// rtScenes.ts; catcher=0|1 the shadow catcher, default on; edges=<width> the rounded edges, 0 none) plus the path-tracer-only variant `emissive`; seed (default 1), samples (default 64), batch (samples
// per step, default all), tile (tile side, default 256), size (CSS pixels, default 256), maxTriangles, track=1 (count
// GL objects), timing=1 (one sample per frame with a time readout, for a manual run on real hardware).
const params = new URLSearchParams(location.search);

/** Path-tracer-only presets: a realtime view plus what only the tracer has. */
const PT_VARIANTS: Readonly<Record<string, { view: string; options: SetSceneOptions }>> = {
  // The showcase's brick material (the body's east face) glows warm; the post beside it picks up its light.
  emissive: { view: 'turntable-y030', options: { emission: [undefined, [4, 2.2, 0.8]] } },
};

function intParam(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
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
  const seed = intParam('seed', 1, 0, MAX_SEED);
  const samples = intParam('samples', 64, 1, MAX_SAMPLES);
  const batch = intParam('batch', samples, 1, MAX_SAMPLES);
  const tileSize = intParam('tile', 256, 16, 4096);
  const maxTriangles = intParam('maxTriangles', 200_000, 0, 10_000_000);
  const timing = params.get('timing') === '1';
  const variantName = params.get('variant');
  const ptVariant = variantName !== null && Object.hasOwn(PT_VARIANTS, variantName) ? PT_VARIANTS[variantName] : null;
  const viewParams = new URLSearchParams(params);
  if (ptVariant) viewParams.set('variant', ptVariant.view);
  const view = parseRtView(viewParams);
  const sceneOptions: SetSceneOptions = { ...(ptVariant?.options ?? {}), shadowCatcher: view.catcher };
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const tracer = PathTracer.create(canvas, {
    preserveDrawingBuffer: !timing,
    tileSize,
    maxTriangles,
    ...(view.edges !== null ? { edges: { width: view.edges } } : {}),
  });
  const capabilities = tracer.capabilities;
  if (!capabilities) throw new Error('path tracer has no capabilities');
  // The same context the tracer created (getContext returns it again).
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 context missing');
  api.renderer = capabilities.renderer;
  api.floatRenderTargets = gl.getExtension('EXT_color_buffer_float') !== null;
  api.readRGBA = () => readDrawingBufferBase64(gl, canvas.width, canvas.height);
  Object.defineProperty(api, 'samplesDone', { get: () => tracer.samplesDone });

  const sceneOf = (name: RtSceneName): SceneDocument => {
    const doc = rtScene(name);
    return view.reverse ? reverseMeshOrder(doc) : doc;
  };
  let doc = sceneOf(view.scene);
  let warnings: readonly PathTracerWarning[] = [];
  let triangles = 0;
  const camera = () => rtCamera(doc, view, canvas.width / canvas.height);
  const project = (x: number, y: number, z: number): [number, number] => {
    const aspect = canvas.width / canvas.height;
    const c = rtCamera(doc, view, aspect);
    const m = mat4Multiply(cameraProjection(c, aspect), cameraView(c));
    const row = (r: number): number => (m[r] ?? 0) * x + (m[4 + r] ?? 0) * y + (m[8 + r] ?? 0) * z + (m[12 + r] ?? 0);
    const w = row(3);
    return [((row(0) / w) * 0.5 + 0.5) * canvas.width, (0.5 - (row(1) / w) * 0.5) * canvas.height];
  };
  const probes = (): PtProbe[] => computePtProbes(doc, sceneProbes(view.scene), (p) => project(...p));
  const render = (): number => {
    tracer.start({ seed, samples });
    while (tracer.step(batch) > 0);
    return tracer.samplesDone;
  };

  tracer.resize({ cssWidth: size, cssHeight: size, devicePixelRatio: window.devicePixelRatio });
  const result = await tracer.setScene(doc, sceneOptions);
  warnings = result.warnings;
  triangles = result.triangles;
  tracer.setCamera(camera());

  if (timing) {
    const output = document.createElement('output');
    document.body.appendChild(output);
    tracer.start({ seed, samples });
    installSampleReadout(
      gl,
      () => tracer.step(1),
      () => tracer.samplesDone,
      samples,
      output,
      capabilities.renderer,
    );
  } else {
    render();
  }

  installSampleBench(api, gl, (count) => {
    tracer.start({ seed, samples: count });
    while (tracer.step(count) > 0);
  });
  installSceneBench(api, gl, async () => {
    doc = sceneOf('large-order');
    const loaded = await tracer.setScene(doc, { shadowCatcher: view.catcher });
    warnings = loaded.warnings;
    triangles = loaded.triangles;
    tracer.setCamera(camera());
    tracer.start({ seed, samples: 1 });
    tracer.step(1);
  });

  const lose = gl.getExtension('WEBGL_lose_context');
  const controls: PtControls = {
    get warnings() {
      return warnings.map(({ code, texture, count }) => ({
        code,
        ...(texture !== undefined ? { texture } : {}),
        ...(count !== undefined ? { count } : {}),
      }));
    },
    get triangles() {
      return triangles;
    },
    get contextLost() {
      return tracer.contextLost;
    },
    get samplesDone() {
      return tracer.samplesDone;
    },
    get probes() {
      return probes();
    },
    liveGlObjects: () => tracker?.liveGlObjects() ?? -1,
    openBitmaps: () => tracker?.openBitmaps() ?? -1,
    render,
    step: (maxSamples) => tracer.step(maxSamples),
    cancelAfter: (count) => {
      tracer.start({ seed, samples });
      tracer.step(count);
      tracer.cancel();
      const cancelled = tracer.samplesDone;
      tracer.step(samples);
      return { cancelled, afterStep: tracer.samplesDone };
    },
    lose: () =>
      new Promise((resolve, reject) => {
        if (!lose) return reject(new Error('WEBGL_lose_context is not available'));
        // Resolve on the next task: the browser allows restoreContext only after the lost event's dispatch ended.
        canvas.addEventListener('webglcontextlost', () => setTimeout(resolve, 0), { once: true });
        lose.loseContext();
      }),
    restore: () =>
      new Promise((resolve, reject) => {
        if (!lose) return reject(new Error('WEBGL_lose_context is not available'));
        const stop = tracer.onContextRestored(() => {
          stop();
          resolve();
        });
        lose.restoreContext();
      }),
    dispose: () => tracer.dispose(),
    setScenes: async (names) => {
      const docs = names.map((name) => {
        if (!isRtSceneName(name)) throw new Error(`unknown scene "${name}"`);
        return sceneOf(name);
      });
      const results = await Promise.all(docs.map((next) => tracer.setScene(next, sceneOptions)));
      results.forEach((r, i) => {
        if (r.applied) {
          doc = docs[i] ?? doc;
          warnings = r.warnings;
          triangles = r.triangles;
        }
      });
      tracer.setCamera(camera());
      render();
      return results.map((r) => r.applied);
    },
    capped: () => {
      const sums = tracer.readAccumulation();
      if (!sums) throw new Error('no accumulation to read');
      let traversals = 0;
      let pixels = 0;
      for (let i = 3; i < sums.length; i += 4) {
        const count = sums[i] ?? 0;
        traversals += count;
        if (count > 0) pixels++;
      }
      return { traversals, pixels };
    },
    tryHugeMaterials: async () => {
      const material = doc.materials[0] ?? { name: 'm', texture: -1 };
      try {
        await tracer.setScene({ ...doc, materials: new Array<typeof material>(1_400_000).fill(material) });
        return 'ok';
      } catch (error) {
        return error instanceof PathTracerError ? error.code : String(error);
      }
    },
    tryStart: (trySeed, trySamples) => {
      try {
        tracer.start({ seed: trySeed, samples: trySamples });
        return 'ok';
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    tryFov: (fovYDeg) => {
      try {
        tracer.setCamera({ ...camera(), projection: { kind: 'perspective', fovYDeg } });
        return 'ok';
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    setEdges: (edges) => {
      try {
        tracer.setEdges(edges);
        render();
        return 'ok';
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    project,
  };
  api.pt = controls;
}

api.ready = start();
api.ready.catch(() => undefined);
