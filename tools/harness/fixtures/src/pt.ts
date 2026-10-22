import {
  MAX_SAMPLES,
  MAX_SEED,
  PathTracer,
  PathTracerError,
  type PathTracerWarning,
  type RenderRequest,
  type SetSceneOptions,
} from '@modelshot/pathtracer';
import { cameraProjection, cameraView, mat4Multiply, type SceneDocument } from '@modelshot/scene';
import { installSampleBench, installSampleReadout, installSceneBench } from './bench';
import { readDrawingBufferBase64 } from './context';
import type { MsFixture, PtControls, PtProbe } from './fixtureApi';
import { encodeRgbaPng } from './encodeRgbaPng';
import { installGlTracker } from './glTracker';
import { computePtProbes, sceneProbes } from './ptProbes';
import { lookByName } from './lookByName';
import { isRtSceneName, parseRtView, reverseMeshOrder, rtCamera, rtLook, rtScene, type RtSceneName } from './rtScenes';

// URL parameters: the realtime fixture's view (variant, scene, yaw, pitch, proj, fov, zoom, iso, reverse, look, depth;
// rtScenes.ts; catcher=0|1 the shadow catcher, default on; edges=<width> the rounded edges, 0 none; preset=<look
// preset id>, rim=0) plus the path-tracer-only variant `emissive`; seed (default 1), samples (default 64), batch (samples
// per step, default all), tile (tile side, default 256), size (CSS pixels, default 256), maxTriangles, track=1 (count
// GL objects), timing=1 (one sample per frame with a time readout, for a manual run on real hardware); the render
// quality (RenderRequest): supersample=1..4, denoise=1, noise=<threshold>, which the sample bench uses too.
const params = new URLSearchParams(location.search);

/** Path-tracer-only presets: a realtime view plus what only the tracer has. */
const PT_VARIANTS: Readonly<Record<string, { view: string; options: SetSceneOptions; darken?: number }>> = {
  // The showcase's brick material (the body's east face) glows warm; the post beside it picks up its light.
  emissive: { view: 'turntable-y030', options: { emission: [undefined, [4, 2.2, 0.8]] } },
  // A 4x glow over near-black texels (MS-18): divided by the floored albedo, one sample's variance overflows half floats.
  'emissive-dark': { view: 'turntable-y030', options: { emission: [undefined, [16, 8.8, 3.2]] }, darken: 1 },
};

/** `doc` with material `index` on a copy of its texture whose every texel is near-black (sRGB 2, opaque). */
function darkenMaterial(doc: SceneDocument, index: number): SceneDocument {
  const material = doc.materials[index];
  const original = material ? doc.textures[material.texture] : undefined;
  if (!material || !original) throw new Error(`material ${index} has no texture to darken`);
  const rgba = new Uint8Array(original.width * original.height * 4).map((_, i) => (i % 4 === 3 ? 255 : 2));
  const texture = { ...original, name: 'near-black', bytes: encodeRgbaPng(original.width, original.height, rgba) };
  return {
    ...doc,
    textures: [...doc.textures, texture],
    materials: doc.materials.map((m, i) => (i === index ? { ...m, texture: doc.textures.length } : m)),
  };
}

function intParam(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`query parameter ${name} must be an integer in ${min}..${max}`);
  }
  return Number(raw);
}

/** A decimal number in the URL (the tracer checks its range). */
function decimalParam(name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!/^\d{1,3}(\.\d{1,12})?$/.test(raw)) throw new Error(`query parameter ${name} must be a decimal number`);
  return Number(raw);
}

/** The quality fields of the page's request; none given: none set, as a caller of the plain API. */
function qualityParams(): Pick<RenderRequest, 'supersample' | 'denoise' | 'noiseThreshold'> {
  const supersample = params.has('supersample') ? intParam('supersample', 1, 1, 4) : undefined;
  const denoise = params.has('denoise') ? intParam('denoise', 0, 0, 1) === 1 : undefined;
  const noiseThreshold = decimalParam('noise');
  return {
    ...(supersample !== undefined ? { supersample } : {}),
    ...(denoise !== undefined ? { denoise } : {}),
    ...(noiseThreshold !== undefined ? { noiseThreshold } : {}),
  };
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
  const quality = qualityParams();
  const variantName = params.get('variant');
  const ptVariant = variantName !== null && Object.hasOwn(PT_VARIANTS, variantName) ? PT_VARIANTS[variantName] : null;
  const viewParams = new URLSearchParams(params);
  if (ptVariant) viewParams.set('variant', ptVariant.view);
  const view = parseRtView(viewParams);
  const sceneOptions: SetSceneOptions = { ...(ptVariant?.options ?? {}), shadowCatcher: view.catcher };
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const tracer = PathTracer.create(canvas, {
    look: rtLook(view),
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
    const plain = rtScene(name);
    const doc = ptVariant?.darken !== undefined ? darkenMaterial(plain, ptVariant.darken) : plain;
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
    tracer.start({ seed, samples, ...quality });
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
    tracer.start({ seed, samples, ...quality });
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
    tracer.start({ seed, samples: count, ...quality });
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
    livePrograms: () => tracker?.livePrograms() ?? -1,
    openBitmaps: () => tracker?.openBitmaps() ?? -1,
    render,
    step: (maxSamples) => tracer.step(maxSamples),
    cancelAfter: (count) => {
      tracer.start({ seed, samples, ...quality });
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
    accumulationLength: () => tracer.readAccumulation()?.length ?? null,
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
    setSceneDuringEdges: async (edges) => {
      const next = sceneOf(view.scene);
      const pending = tracer.setScene(next, sceneOptions);
      tracer.setEdges(edges);
      const result = await pending;
      if (result.applied) doc = next;
      render();
      return result.applied;
    },
    setSceneDuringLook: async (id) => {
      const next = sceneOf(view.scene);
      const pending = tracer.setScene(next, sceneOptions);
      tracer.setLook(lookByName(id));
      const result = await pending;
      if (result.applied) doc = next;
      tracer.setCamera(camera());
      render();
      return result.applied;
    },
    setLook: (id) => {
      try {
        tracer.setLook(lookByName(id));
        render();
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
    get progress() {
      return { ...tracer.progress };
    },
    get running() {
      return tracer.running;
    },
    get accumulationSize(): [number, number] {
      return [tracer.accumulationWidth, tracer.accumulationHeight];
    },
    loseDuringNoise: () => {
      if (!lose) return Promise.reject(new Error('WEBGL_lose_context is not available'));
      // Resolve on the next task after the lost event, as `lose` does: only then may the context be restored.
      const lost = new Promise<void>((resolve) =>
        canvas.addEventListener('webglcontextlost', () => setTimeout(resolve, 0), { once: true }),
      );
      const read = gl.readPixels.bind(gl) as (...args: unknown[]) => void;
      // The next float readback (the noise blocks') finds the context lost, as if it went during the step.
      gl.readPixels = (...args: unknown[]) => {
        if (args[6] instanceof Float32Array) {
          gl.readPixels = read;
          lose.loseContext();
        }
        read(...args);
      };
      return lost;
    },
    tryQuality: (fields) => {
      try {
        tracer.start({ seed, samples, ...(fields as Partial<RenderRequest>) });
        return 'ok';
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
  };
  api.pt = controls;
}

api.ready = start();
api.ready.catch(() => undefined);
