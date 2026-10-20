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
  /** Sets the canvas CSS size; resolves after the resize observer resized the backing store and redrew. */
  setCssSize: (width: number, height: number) => Promise<void>;
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
