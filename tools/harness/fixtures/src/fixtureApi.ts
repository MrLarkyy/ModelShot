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
  /** Model-view fixture: pixels to check in the rendered image. */
  probes?: ModelViewProbe[];
  rt?: RtControls;
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
  /** Depth-key variant (`raster` or `linear`) the renderer uses for the current camera and path. */
  depthKeyMode: () => string;
  /** Image position (pixels, top-left origin) of a world point under the current camera. */
  project: (x: number, y: number, z: number) => [number, number];
  /** Sets the canvas CSS size; resolves after the resize observer resized the backing store and redrew. */
  setCssSize: (width: number, height: number) => Promise<void>;
}

declare global {
  interface Window {
    __msFixture?: MsFixture;
  }
}
