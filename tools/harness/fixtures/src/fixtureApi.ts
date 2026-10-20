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
}

declare global {
  interface Window {
    __msFixture?: MsFixture;
  }
}
