import { LightBaker, PathTracerError, type BakeResult } from '@modelshot/pathtracer';
import { observeCanvasSize, RealtimeRenderer, type BakedLighting, type RendererWarning } from '@modelshot/renderer-rt';
import {
  cameraProjection,
  cameraView,
  mat4Multiply,
  mat4TransformPoint,
  playerPosePreset,
  poseScene,
  worldMatrices,
  type SceneDocument,
} from '@modelshot/scene';
import { installBakeBench, installFrameBench, installFrameReadout, installSceneBench } from './bench';
import { readDrawingBufferBase64 } from './context';
import { spinMainThread, startEventLoopLag } from './eventLoopLag';
import type { MsFixture, RtBakeOutcome, RtBakeRequest, RtControls } from './fixtureApi';
import { breakFramebuffers } from './breakFramebuffers';
import { installGlTracker } from './glTracker';
import { computePtProbes, sceneProbes } from './ptProbes';
import {
  hideMeshes,
  isRtSceneName,
  parseRtView,
  reverseMeshOrder,
  rtCamera,
  rtScene,
  type RtSceneName,
} from './rtScenes';

// URL parameters: variant (a preset of rtScenes.ts) or scene, yaw, pitch, proj=persp|ortho, fov, zoom, iso=0|1,
// aa=0|1, fallback=1, reverse=1, look=model-view|above|below with depth=framed|inside, hide=<mesh name>; size (CSS pixels, default 256), maxTextureSide, track=1 (count GL objects),
// fps=1 (continuous drawing with a frame-time readout, for a manual run on real hardware); bake=<samples> (bake the
// light before the first frame; 0 none), catcher=0|1, bakeSeed (default 1), bakeTile (default 64), pose=<player
// preset> (the scene re-posed, framed as loaded), lag=1 (main-thread event-loop lag probe).
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
const lag = params.get('lag') === '1' ? startEventLoopLag() : null;

/** FNV-1a over the lighting's halves: equal for byte-identical lighting. */
function lightingHash(lighting: BakedLighting | null): string {
  if (!lighting) return '';
  let h = 0x811c9dc5;
  for (const data of [lighting.data, lighting.catcher?.data ?? new Uint16Array(0)]) {
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ (data[i] ?? 0), 16777619) >>> 0;
  }
  return `${lighting.width}x${lighting.height}:${h.toString(16)}:${lighting.catcher?.width ?? 0}`;
}

function errorText(error: unknown): string {
  if (error instanceof PathTracerError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
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
  const bakeSeed = intParam('bakeSeed', 1, 0, 99999);
  const bakeTile = intParam('bakeTile', 64, 16, 512);
  const poseName = params.get('pose');
  const pose = poseName === null ? null : playerPosePreset(poseName);
  if (poseName !== null && !pose) throw new Error(`unknown pose "${poseName}"`);
  const continuous = params.get('fps') === '1';
  const view = parseRtView(params);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const renderer = RealtimeRenderer.create(canvas, {
    forceFallback: view.fallback,
    texelAntialias: view.texelAntialias,
    preserveDrawingBuffer: !continuous,
    maxTextureSide,
    ...(view.edges !== null ? { edges: { width: view.edges } } : {}),
  });
  const capabilities = renderer.capabilities;
  if (!capabilities) throw new Error('renderer has no capabilities');
  // The same context the renderer created (getContext returns it again).
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 context missing');
  api.renderer = capabilities.limits.renderer;
  api.floatRenderTargets = capabilities.limits.colorBufferFloat;
  api.readRGBA = () => readDrawingBufferBase64(gl, canvas.width, canvas.height);

  // The camera frames the scene as loaded, so hiding a mesh (hide=) leaves the view unchanged.
  const framing = new WeakMap<SceneDocument, SceneDocument>();
  const sceneOf = (name: RtSceneName): SceneDocument => {
    const loaded = rtScene(name);
    const shown = view.hide === null ? loaded : hideMeshes(loaded, view.hide);
    const ordered = view.reverse ? reverseMeshOrder(shown) : shown;
    const doc = pose ? poseScene(ordered, pose).document : ordered;
    framing.set(doc, loaded);
    return doc;
  };
  const cameraOf = (aspect: number) => rtCamera(framing.get(doc) ?? doc, view, aspect);
  let doc = sceneOf(view.scene);
  let warnings: readonly RendererWarning[] = [];
  const frame = (): void => {
    renderer.setCamera(cameraOf(canvas.width / canvas.height));
    renderer.render();
  };

  renderer.resize({ cssWidth: size, cssHeight: size, devicePixelRatio: window.devicePixelRatio });
  warnings = (await renderer.setScene(doc)).warnings;
  frame();

  let baker: LightBaker | null = null;
  let shown: BakedLighting | null = null;
  // The camera is already set: an update re-uploads the light and draws, nothing more on the main thread.
  const timed = <T>(phase: string, fn: () => T): T => (lag ? lag.work(phase, fn) : fn());
  const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  // An update hands the light over, lets the renderer upload it a frame's budget per task, then draws it complete.
  const show = async (lighting: BakedLighting): Promise<void> => {
    if (!timed('set-lighting', () => renderer.setLighting(lighting))) return;
    shown = lighting;
    while (timed('upload', () => renderer.advanceLighting())) await nextTask();
    timed('render', () => renderer.render());
  };
  const outcome = (
    result: BakeResult,
    progress: number[],
    progressHashes: string[],
    hashes: boolean,
  ): RtBakeOutcome => ({
    applied: result.applied,
    progress,
    progressHashes,
    warnings: result.warnings.map(({ code, texture }) => ({ code, ...(texture !== undefined ? { texture } : {}) })),
    hash: hashes ? lightingHash(result.lighting) : '',
    error: '',
  });
  const failed = (error: unknown, progress: number[]): RtBakeOutcome => ({
    applied: false,
    progress,
    progressHashes: [],
    warnings: [],
    hash: '',
    error: errorText(error),
  });
  // `hashes`: hash every update for the determinism tests; the bake bench leaves it out (main-thread work of its own).
  const runBake = async (
    target: SceneDocument,
    request: RtBakeRequest,
    display: boolean,
    hashes = true,
  ): Promise<RtBakeOutcome> => {
    baker ??= LightBaker.create({ testHooks: true });
    const progress: number[] = [];
    const progressHashes: string[] = [];
    try {
      const active = baker;
      // The call itself (validation, the document's structured clone) is main-thread work too.
      const call = () =>
        active.bake(target, {
          samples: request.samples,
          seed: request.seed ?? bakeSeed,
          tileSize: request.tile ?? bakeTile,
          shadowCatcher: request.catcher ?? view.catcher,
          countCappedTraversals: request.countCapped ?? false,
          onProgress: ({ samplesDone, samples, lighting }) => {
            progress.push(samplesDone);
            if (hashes) progressHashes.push(lightingHash(lighting));
            console.log(`[bake] ${samplesDone} / ${samples} samples`);
            if (display) void show(lighting);
          },
        });
      const result = await timed('bake-call', call);
      if (display && result.lighting) await show(result.lighting);
      return outcome(result, progress, progressHashes, hashes);
    } catch (error) {
      return failed(error, progress);
    }
  };
  if (view.bake > 0) {
    const first = await runBake(doc, { samples: view.bake }, true);
    if (first.error) throw new Error(first.error);
  }
  installBakeBench(api, async () => {
    const result = await runBake(doc, { samples: view.bake || 16 }, true, false);
    if (result.error) throw new Error(result.error);
  });

  const resized: (() => void)[] = [];
  observeCanvasSize(canvas, (cssSize) => {
    const before = `${canvas.width}x${canvas.height}`;
    renderer.resize(cssSize);
    if (`${canvas.width}x${canvas.height}` !== before) frame();
    for (const resolve of resized.splice(0)) resolve();
  });

  installFrameBench(api, gl, () => renderer.render());
  installSceneBench(api, gl, async () => {
    doc = sceneOf('large-order');
    warnings = (await renderer.setScene(doc)).warnings;
    frame();
  });
  if (continuous) {
    const output = document.createElement('output');
    document.body.appendChild(output);
    installFrameReadout(gl, () => renderer.render(), output, capabilities.limits.renderer);
  }

  const lose = gl.getExtension('WEBGL_lose_context');
  const controls: RtControls = {
    get path() {
      return renderer.capabilities?.path ?? 'fallback';
    },
    get msaaSamples() {
      return renderer.capabilities?.msaaSamples ?? 0;
    },
    breakFramebuffers,
    get warnings() {
      return warnings.map(({ code, texture }) => ({ code, texture }));
    },
    get contextLost() {
      return renderer.contextLost;
    },
    liveGlObjects: () => tracker?.liveGlObjects() ?? -1,
    openBitmaps: () => tracker?.openBitmaps() ?? -1,
    render: () => renderer.render(),
    setEdges: (edges) => {
      try {
        renderer.setEdges(edges);
        frame();
        return 'ok';
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    drawCallsPerFrame: () => {
      let calls = 0;
      const drawElements = gl.drawElements.bind(gl);
      gl.drawElements = (...args: Parameters<WebGL2RenderingContext['drawElements']>): void => {
        calls++;
        drawElements(...args);
      };
      try {
        renderer.render();
      } finally {
        delete (gl as Partial<Pick<WebGL2RenderingContext, 'drawElements'>>).drawElements;
      }
      return calls;
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
        const stop = renderer.onContextRestored(() => {
          stop();
          resolve();
        });
        lose.restoreContext();
      }),
    dispose: () => {
      renderer.dispose();
      baker?.dispose();
    },
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
    depthKeyMode: () => renderer.depthKeyMode ?? 'none',
    project: (x, y, z) => {
      const aspect = canvas.width / canvas.height;
      const camera = cameraOf(aspect);
      const m = mat4Multiply(cameraProjection(camera, aspect), cameraView(camera));
      const row = (r: number): number => (m[r] ?? 0) * x + (m[4 + r] ?? 0) * y + (m[8 + r] ?? 0) * z + (m[12 + r] ?? 0);
      const w = row(3);
      return [((row(0) / w) * 0.5 + 0.5) * canvas.width, (0.5 - (row(1) / w) * 0.5) * canvas.height];
    },
    nodePoint: (name, x, y, z) => {
      const index = doc.nodes.findIndex((node) => node.name === name);
      const world = worldMatrices(doc.nodes)[index];
      if (!world) throw new Error(`no node "${name}"`);
      return mat4TransformPoint(world, [x, y, z]);
    },
    setCssSize: (width, height) =>
      new Promise((resolve) => {
        resized.push(resolve);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }),
    get probes() {
      return computePtProbes(doc, sceneProbes(view.scene), (point) => controls.project(...point));
    },
    bake: (request) => runBake(doc, request, true),
    bakeTwice: async (first, second) => {
      const results = await Promise.all([runBake(doc, first, true), runBake(doc, second, true)]);
      return { applied: results.map((result) => result.applied), hash: lightingHash(shown) };
    },
    bakeCapped: async (name, samples) => {
      if (!isRtSceneName(name)) throw new Error(`unknown scene "${name}"`);
      baker ??= LightBaker.create({ testHooks: true });
      try {
        const { lighting } = await baker.bake(rtScene(name), { samples, countCappedTraversals: true });
        let texels = 0;
        for (const data of [lighting?.data, lighting?.catcher?.data]) {
          for (let i = 0; i < (data?.length ?? 0); i += 4) if ((data?.[i] ?? 0) !== 0) texels++;
        }
        return { texels, error: '' };
      } catch (error) {
        return { texels: -1, error: errorText(error) };
      }
    },
    uploadStates: async () => {
      baker ??= LightBaker.create({ testHooks: true });
      const bakeWith = async (seed: number): Promise<BakedLighting> => {
        const { lighting } = await (baker ?? LightBaker.create()).bake(doc, { samples: 4, seed });
        if (!lighting) throw new Error('bake not applied');
        return lighting;
      };
      const [a, b, c] = [await bakeWith(1), await bakeWith(2), await bakeWith(3)];
      const frame = (): string => {
        renderer.render();
        let h = 0x811c9dc5;
        const rgba = readDrawingBufferBase64(gl, canvas.width, canvas.height);
        for (let i = 0; i < rgba.length; i++) h = Math.imul(h ^ rgba.charCodeAt(i), 16777619) >>> 0;
        return h.toString(16);
      };
      const drain = (): void => {
        while (renderer.advanceLighting());
      };
      const showAll = (lighting: BakedLighting | null): string => {
        renderer.setLighting(lighting);
        drain();
        return frame();
      };
      const unbaked = showAll(null);
      const refC = showAll(c);
      const refA = showAll(a);
      // B is written into back textures: one frame's budget later the frame still shows A.
      renderer.setLighting(b);
      renderer.advanceLighting();
      const midB = frame();
      const midBPending = renderer.lightingPending;
      // C replaces B mid-upload; drained, it shows exactly C.
      renderer.setLighting(c);
      renderer.advanceLighting();
      drain();
      const afterC = frame();
      // null mid-upload: unbaked, nothing pending.
      renderer.setLighting(b);
      renderer.advanceLighting();
      renderer.setLighting(null);
      const nullPending = renderer.lightingPending;
      const afterNull = frame();
      // Another layout mid-upload: the scene's own unbaked frame, nothing pending.
      showAll(a);
      renderer.setLighting(b);
      renderer.advanceLighting();
      const other = rtScene('flat');
      await renderer.setScene(other);
      const otherPending = renderer.lightingPending;
      const otherFrame = frame();
      renderer.setLighting(null);
      const otherUnbaked = frame();
      await renderer.setScene(doc);
      // A context loss mid-upload: the restore uploads the retained lighting, C, whole.
      showAll(a);
      renderer.setLighting(c);
      renderer.advanceLighting();
      await controls.lose();
      await controls.restore();
      const restoredPending = renderer.lightingPending;
      const restored = frame();
      shown = c;
      return {
        unbaked,
        refA,
        refC,
        midB,
        midBPending,
        afterC,
        afterNull,
        nullPending,
        otherFrame,
        otherUnbaked,
        otherPending,
        restored,
        restoredPending,
      };
    },
    bakeAfterFailure: async (request) => {
      const overflow = rtScene('lightmap-overflow');
      const failing: SceneDocument = { ...overflow, materials: doc.materials, textures: doc.textures };
      const first = await runBake(failing, request, false);
      return [first, await runBake(doc, request, true)];
    },
    bakeScene: (name, samples) => {
      if (!isRtSceneName(name)) throw new Error(`unknown scene "${name}"`);
      return runBake(rtScene(name), { samples }, false);
    },
    pose: async (preset) => {
      const posePreset = playerPosePreset(preset);
      if (!posePreset) throw new Error(`unknown pose "${preset}"`);
      const posed = poseScene(doc, posePreset).document;
      framing.set(posed, framing.get(doc) ?? doc);
      doc = posed;
      warnings = (await renderer.setScene(doc)).warnings;
      if (!renderer.lightmapLayout || renderer.lightmapLayout.layoutKey !== shown?.layoutKey) shown = null;
      frame();
    },
    get lightingHash() {
      return lightingHash(shown);
    },
    loseBakerContext: (options) => baker?.loseContext(options),
    disposeBaker: () => baker?.dispose(),
    get bakerTerminated() {
      return baker?.terminated ?? false;
    },
    tryLighting: (change) => {
      if (!shown) throw new Error('no lighting shown');
      const changed: BakedLighting =
        change === 'key'
          ? { ...shown, layoutKey: `${shown.layoutKey}x` }
          : change === 'size'
            ? { ...shown, height: shown.height + 1 }
            : { ...shown, data: shown.data.subarray(4) };
      return renderer.setLighting(changed);
    },
    maxLag: () => lag?.max() ?? -1,
    mainThreadBlock: () => lag?.block() ?? -1,
    blockReport: () => lag?.report() ?? { phases: {}, longTasks: [], slowPhases: [] },
    spinMainThread,
    resetLag: () => lag?.reset(),
  };
  api.rt = controls;
}

api.ready = start();
api.ready.catch(() => undefined);
