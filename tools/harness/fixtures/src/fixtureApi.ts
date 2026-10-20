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
}

/** A pixel (x right, y down from the top-left, as in the PNG) and the RGBA of the texel it should show. */
export interface ModelViewProbe {
  name: string;
  x: number;
  y: number;
  texel: number[];
}

declare global {
  interface Window {
    __msFixture?: MsFixture;
  }
}
