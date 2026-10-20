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
  /** Load-and-first-frame bench (rt.html): milliseconds until the GPU finished. */
  timeScene?: () => Promise<number>;
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
  /** Shows the document in a player pose preset (setScene of the posed document; baked light of the same layout stays). */
  pose: (preset: string) => Promise<void>;
  /** Hash of the lighting the renderer shows, '' for none. */
  readonly lightingHash: string;
  /** The worker loses its WebGL context and gets it back (LightBaker test hook). */
  loseBakerContext: () => void;
  disposeBaker: () => void;
  readonly bakerTerminated: boolean;
  /** setLighting with the shown lighting changed in one way: whether the renderer took it. */
  tryLighting: (change: 'key' | 'size' | 'length') => boolean;
  /** Longest main-thread event-loop lag in milliseconds since load (lag=1), else -1. */
  maxLag: () => number;
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
  /** Live WebGL objects and open ImageBitmaps; -1 unless the page was opened with track=1. */
  liveGlObjects: () => number;
  openBitmaps: () => number;
  /** Restarts the page's request and draws it to the end in the page's batches; returns the samples done. */
  render: () => number;
  /** One `step(maxSamples)` of the current request; returns the samples it drew. */
  step: (maxSamples: number) => number;
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
  /** Image position (pixels, top-left origin) of a world point under the current camera. */
  project: (x: number, y: number, z: number) => [number, number];
}

declare global {
  interface Window {
    __msFixture?: MsFixture;
  }
}
