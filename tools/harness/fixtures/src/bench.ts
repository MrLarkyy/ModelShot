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

/** Times one asynchronous step (a scene load and its first frame) until the GPU finished. */
export function installSceneBench(api: MsFixture, gl: WebGL2RenderingContext, run: () => Promise<void>): void {
  api.timeScene = async () => {
    const start = performance.now();
    await run();
    finish(gl);
    return performance.now() - start;
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

/**
 * Manual frame-time readout for a run on real hardware: draws continuously on requestAnimationFrame and shows the
 * median over the last 120 frames of the frame work (draw until the GPU finished) and of the display interval.
 */
export function installFrameReadout(
  gl: WebGL2RenderingContext,
  drawFrame: () => void,
  output: HTMLElement,
  renderer: string,
): void {
  const work: number[] = [];
  const intervals: number[] = [];
  let previous = 0;
  const tick = (now: number): void => {
    if (previous > 0) intervals.push(now - previous);
    previous = now;
    const start = performance.now();
    drawFrame();
    finish(gl);
    work.push(performance.now() - start);
    if (work.length > 120) work.shift();
    if (intervals.length > 120) intervals.shift();
    const workMs = median(work);
    output.textContent =
      `frame work ${workMs.toFixed(2)} ms median (${(1000 / workMs).toFixed(0)} fps), ` +
      `display interval ${median(intervals).toFixed(2)} ms, ${work.length} frames, ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}, ${renderer}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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

/**
 * Manual time-to-samples readout for a run on real hardware (pt.html?timing=1): draws one sample per animation frame
 * until `target` and shows the elapsed time until the GPU finished each, and the mean per sample.
 */
export function installSampleReadout(
  gl: WebGL2RenderingContext,
  step: () => number,
  done: () => number,
  target: number,
  output: HTMLElement,
  renderer: string,
): void {
  const start = performance.now();
  const tick = (): void => {
    step();
    finish(gl);
    const elapsed = performance.now() - start;
    const samples = done();
    output.textContent =
      `${samples} / ${target} samples in ${elapsed.toFixed(0)} ms (${(elapsed / Math.max(1, samples)).toFixed(1)} ms ` +
      `per sample), ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}, ${renderer}`;
    if (samples < target) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Times one light bake from the call to its final lighting. */
export function installBakeBench(api: MsFixture, bake: () => Promise<void>): void {
  api.timeBake = async () => {
    const start = performance.now();
    await bake();
    return performance.now() - start;
  };
}
