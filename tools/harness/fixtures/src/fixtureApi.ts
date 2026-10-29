import type { BlockReport } from './eventLoopLag';
import type { DrawState } from './drawStates';

export interface MsFixture {
  ready: Promise<void>;
  renderer: string;
  floatRenderTargets: boolean;
  width: number;
  height: number;
  samplesDone: number;
  readRGBA: () => string;
  renderFrames?: (count: number) => number[];
  timeToSamples?: (samples: number) => number;
  /** Draws a request of `samples` by `step(1)`; the longest step in ms, each timed until the GPU finished. */
  maxStepMs?: (samples: number) => number;
  /** Load-and-first-frame bench (rt.html): milliseconds until the GPU finished. */
  /** setScene and the first frame of a scene (the realtime fixture: default `large-order`, else that scene), in ms. */
  timeScene?: (scene?: string) => Promise<number>;
  /** Light-bake bench (rt.html): milliseconds from the call to the final lighting. */
  timeBake?: () => Promise<number>;
  /** Model-view fixture: pixels to check in the rendered image. */
  probes?: ModelViewProbe[];
  rt?: RtControls;
  pt?: PtControls;
}

/** A pixel (x right, y down from the top-left, as in the PNG) and the RGBA of the texel it should show. */
export interface ModelViewProbe {
  name: string;
  x: number;
  y: number;
  texel: number[];
}

/** A light bake of the realtime fixture (LightBaker options). */
export interface RtBakeRequest {
  samples: number;
  seed?: number;
  tile?: number;
  catcher?: boolean;
  /** Test hook: texels count capped traversals instead of light. */
  countCapped?: boolean;
}

/** How a bake ended: the samples of each progress update, the final lighting's hash, or the error (`code: message`). */
export interface RtBakeOutcome {
  applied: boolean;
  progress: number[];
  /** Hash of the lighting at each progress update. */
  progressHashes: string[];
  warnings: { code: string; texture?: number }[];
  hash: string;
  error: string;
}

/** Extra controls of the realtime renderer fixture (rt.html). */
export interface RtControls {
  readonly path: 'float' | 'fallback';
  readonly msaaSamples: number;
  readonly warnings: readonly { readonly code: string; readonly texture: number }[];
  readonly contextLost: boolean;
  /** Live WebGL objects and open ImageBitmaps; -1 unless the page was opened with track=1. */
  liveGlObjects: () => number;
  openBitmaps: () => number;
  render: () => void;
  /** Mesh draw calls (drawElements) of one rendered frame. */
  drawCallsPerFrame: () => number;
  /** Program, alpha-to-coverage and draw-framebuffer samples at every draw call of one rendered frame. */
  drawStatesPerFrame: () => DrawState[];
  /** Makes every framebuffer report itself incomplete from now on (see breakFramebuffers.ts). */
  breakFramebuffers: () => void;
  /** WEBGL_lose_context: resolves once the context is lost, or restored and redrawn. */
  lose: () => Promise<void>;
  restore: () => Promise<void>;
  dispose: () => void;
  /** Calls setScene for every name at once; resolves with which calls were applied. */
  setScenes: (names: string[]) => Promise<boolean[]>;
  /** Starts a setScene, disposes the renderer before it finishes; resolves with whether it was applied. */
  disposeDuringDecode: () => Promise<boolean>;
  /** Depth-key variant (`raster` or `exact`) of the last frame, `none` before one. */
  depthKeyMode: () => string;
  /** `setEdges` then a frame: `ok`, or the error it threw (`name: message`). */
  setEdges: (edges: { width?: number; sharpAngleDeg?: number }) => string;
  /** `setLook` of a preset by id (or a broken copy: `bad`) then a frame: `ok`, or the error (`name: message`). */
  setLook: (id: string) => string;
  /**
   * Bakes the shown document under the preset `id` (64 samples), offers the light to the renderer under its current look
   * and then under that preset: whether each `setLighting` took it.
   */
  bakeUnderLook: (id: string) => Promise<{ current: boolean; same: boolean }>;
  /** Image position (pixels, top-left origin) of a world point under the current camera. */
  project: (x: number, y: number, z: number) => [number, number];
  /** World position of a model-space point under the first node named `name` (its world matrix in the shown pose). */
  nodePoint: (name: string, x: number, y: number, z: number) => [number, number, number];
  /** Sets the canvas CSS size; resolves after the resize observer resized the backing store and redrew. */
  setCssSize: (width: number, height: number) => Promise<void>;
  /** Pixels of the scene's shadow probes (ptProbes.ts) under the current camera; empty for other scenes. */
  readonly probes: readonly PtProbe[];
  /** Bakes the shown document, drawing each update; a failure comes back as `error`. */
  bake: (request: RtBakeRequest) => Promise<RtBakeOutcome>;
  /** Starts two bakes of the shown document back to back: their applied flags and the shown lighting's hash. */
  bakeTwice: (first: RtBakeRequest, second: RtBakeRequest) => Promise<{ applied: boolean[]; hash: string }>;
  /** Bakes a named scene without showing it. */
  bakeScene: (name: string, samples: number) => Promise<RtBakeOutcome>;
  /** Bakes a named scene counting the traversals its rays stop at the node cap: texels with any, or the error. */
  bakeCapped: (name: string, samples: number) => Promise<{ texels: number; error: string }>;
  /**
   * Bakes the shown document's textures with lightmap-overflow's meshes (refused with SCENE_TOO_LARGE after the bytes
   * were posted), then the shown document with the same textures array: both outcomes.
   */
  bakeAfterFailure: (request: RtBakeRequest) => Promise<RtBakeOutcome[]>;
  /**
   * Drives the renderer's banded light upload through its states with three bakes (seeds 1, 2, 3) of the shown
   * document: frame hashes and `lightingPending` at each step.
   */
  uploadStates: () => Promise<Record<string, string | boolean>>;
  /** Shows the document in a player pose preset (setScene of the posed document; baked light of the same layout stays). */
  pose: (preset: string) => Promise<void>;
  /** Hash of the lighting the renderer shows, '' for none. */
  readonly lightingHash: string;
  /** The worker loses its WebGL context and gets it back (LightBaker test hook), now or before a progress mark. */
  loseBakerContext: (options?: { beforeMark?: number; failRestore?: boolean }) => void;
  disposeBaker: () => void;
  readonly bakerTerminated: boolean;
  /** setLighting with the shown lighting changed in one way: whether the renderer took it. */
  tryLighting: (change: 'key' | 'size' | 'length') => boolean;
  /** Longest main-thread event-loop lag in milliseconds since load (lag=1), else -1. */
  maxLag: () => number;
  /** Longest main-thread block from page work since load or `resetLag` (lag=1: long tasks, bake calls and updates). */
  mainThreadBlock: () => number;
  /** Per-phase maxima, long tasks and slow phases since load or `resetLag` (lag=1). */
  blockReport: () => BlockReport;
  /** Busy main thread for `ms` outside any timed bake work (checks that `mainThreadBlock` sees long tasks). */
  spinMainThread: (ms: number) => Promise<void>;
  resetLag: () => void;
}

/** A point of interest in a path-traced image: x right, y down from the top-left, in pixels (not rounded). */
export interface PtProbe {
  name: string;
  x: number;
  y: number;
}

/** Extra controls of the path-tracer fixture (pt.html). */
export interface PtControls {
  readonly warnings: readonly { readonly code: string; readonly texture?: number; readonly count?: number }[];
  readonly triangles: number;
  readonly contextLost: boolean;
  readonly samplesDone: number;
  /** Pixels of chosen texels and of their key-light shadows on the ground (alpha-plane scenes), else empty. */
  readonly probes: readonly PtProbe[];
  /** `PathTracer.geometryInWorker`: setScene builds the geometry in its worker (not the main thread). */
  readonly geometryInWorker: boolean;
  /** Builds the bench's 200 000-triangle document (`large-order`) for `setLarge`, outside any measured window. */
  prepareLarge: () => void;
  /** setScene of the document `prepareLarge` built, then the camera set on it; nothing drawn. */
  setLarge: () => Promise<{ applied: boolean; triangles: number }>;
  /** `readAccumulation()`'s bytes in base64, or `null` when it returns none. */
  accumulationBase64: () => string | null;
  /** Live WebGL objects and open ImageBitmaps; -1 unless the page was opened with track=1. */
  liveGlObjects: () => number;
  openBitmaps: () => number;
  /** Restarts the page's request and draws it to the end in the page's batches; returns the samples done. */
  render: () => number;
  /** Starts the page's request again, drawing nothing. */
  restart: () => void;
  /** One `step(maxSamples)` of the current request; returns the samples it drew. */
  step: (maxSamples: number) => number;
  /** `PathTracer.guiding`: a denoised request is in its guide phase, where a step may draw 0 samples. */
  readonly guiding: boolean;
  /** Cancels the current request. */
  cancel: () => void;
  /** Whether the default framebuffer is the one bound to FRAMEBUFFER. */
  defaultFramebufferBound: () => boolean;
  /**
   * Loses the context in the middle of a request: what `step(1)` and `guiding` give straight after `loseContext()`
   * and after the lost event.
   */
  loseProbe: () => Promise<{ sync: { drawn: number; guiding: boolean }; event: { drawn: number; guiding: boolean } }>;
  /** Loses the context and restores it with the GPU rebuild failing: `step(1)` and `guiding` after the restore. */
  failedRestoreProbe: () => Promise<{ drawn: number; guiding: boolean }>;
  /** Draw calls since the last call, guide and other; zeros unless the page was opened with track=1. */
  drawCounts: () => { guide: number; other: number };
  /** Restarts the request, draws `samples`, cancels, then steps again: samples done after the cancel and after. */
  cancelAfter: (samples: number) => { cancelled: number; afterStep: number };
  /** WEBGL_lose_context: resolves once the context is lost, or restored. */
  lose: () => Promise<void>;
  restore: () => Promise<void>;
  dispose: () => void;
  /** Calls setScene for every name at once; resolves with which calls were applied. */
  setScenes: (names: string[]) => Promise<boolean[]>;
  /** Traversals stopped by the per-ray node cap in the samples done (accumulation alpha): total and pixels with any. */
  capped: () => { traversals: number; pixels: number };
  /** setScene of the current scene with 1.4 M materials (over the material table): the error code, or `ok`. */
  tryHugeMaterials: () => Promise<string>;
  /** The error `start` throws for this request (`name: message`), or `ok`. */
  tryStart: (seed: number, samples: number) => string;
  /** The error `setCamera` throws for the page's camera with this vertical field of view, or `ok`. */
  tryFov: (fovYDeg: number) => string;
  /** setScene of the page's scene anew, `setEdges` while it decodes, then the request drawn: whether it applied. */
  setSceneDuringEdges: (edges: { width?: number; sharpAngleDeg?: number }) => Promise<boolean>;
  /** `setEdges` then the page's request drawn to the end: `ok`, or the error it threw (`name: message`). */
  setEdges: (edges: { width?: number; sharpAngleDeg?: number }) => string;
  /** setScene of a fresh copy of the page's scene (a full upload at the current sharp angle), then the request drawn. */
  reloadScene: () => Promise<boolean>;
  /**
   * A pose-only setScene of the shown scene (same textures and materials), `setEdges` after its first data band, then
   * the request drawn: whether both happened, and the layer texture storage/write calls made meanwhile.
   */
  poseDuringEdges: (edges: {
    width?: number;
    sharpAngleDeg?: number;
  }) => Promise<{ applied: boolean; layerUploads: number }>;
  /** setScene of the page's scene anew, `setLook` of a preset while it decodes, then the request drawn: applied. */
  setSceneDuringLook: (id: string) => Promise<boolean>;
  /** `setLook` of a preset by id (or a broken copy: `bad`), then the request drawn: `ok`, or the error. */
  setLook: (id: string) => string;
  /** Image position (pixels, top-left origin) of a world point under the current camera. */
  project: (x: number, y: number, z: number) => [number, number];
  /** Length of `readAccumulation()`, or `null` when it returns none. */
  accumulationLength: () => number | null;
  /** Live WebGL programs; -1 unless the page was opened with track=1. */
  livePrograms: () => number;
  /** Loses the context inside the next float readback (the noise estimate's), mid-step; resolves once it is lost. */
  loseDuringNoise: () => Promise<void>;
  /** `PathTracer.progress` and `running` of the current request. */
  readonly progress: PtProgress;
  readonly running: boolean;
  /** `accumulationWidth` × `accumulationHeight`: the traced size. */
  readonly accumulationSize: [number, number];
  /** The error `start` throws for the page's seed and samples with these quality fields (`name: message`), or `ok`. */
  tryQuality: (fields: { supersample?: unknown; denoise?: unknown; noiseThreshold?: unknown }) => string;
}

/** `RenderProgress` of the path tracer. */
export interface PtProgress {
  samplesDone: number;
  targetSamples: number;
  supersample: number;
  noise: number | null;
  converged: boolean;
  elapsedMs: number;
  remainingMs: number | null;
}

declare global {
  interface Window {
    __msFixture?: MsFixture;
  }
}
