import type { MsFixture } from './fixtureApi';

function finish(gl: WebGL2RenderingContext): void {
  gl.finish();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

export function installFrameBench(api: MsFixture, gl: WebGL2RenderingContext, drawFrame: () => void): void {
  api.renderFrames = (count) => {
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      drawFrame();
      finish(gl);
      times.push(performance.now() - start);
    }
    return times;
  };
}

export function installSampleBench(
  api: MsFixture,
  gl: WebGL2RenderingContext,
  accumulate: (samples: number) => void,
): void {
  api.timeToSamples = (samples) => {
    const start = performance.now();
    accumulate(samples);
    finish(gl);
    return performance.now() - start;
  };
}
