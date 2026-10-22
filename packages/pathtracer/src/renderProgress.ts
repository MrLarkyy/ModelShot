import { nextCheckpoint } from './sampleSchedule';

/** Where a render stands (`PathTracer.progress`). Times come from the clock and never change a pixel. */
export interface RenderProgress {
  readonly samplesDone: number;
  /** The request's `samples`: the maximum when it has a `noiseThreshold`. */
  readonly targetSamples: number;
  /** The scale traced at (`RenderRequest.supersample` within the GPU and memory caps); 1 before `start`. */
  readonly supersample: number;
  /** The 0.99 quantile of the noise estimate at the last checkpoint; `null` without denoise or threshold. */
  readonly noise: number | null;
  /** Stopped early: the noise reached the request's `noiseThreshold`. */
  readonly converged: boolean;
  /** From the first `step` of the request to the end of the latest one. */
  readonly elapsedMs: number;
  /** Estimated time to the end at the pace so far; 0 when done, `null` before the first sample. */
  readonly remainingMs: number | null;
}

export interface RemainingEstimate {
  readonly samplesDone: number;
  readonly targetSamples: number;
  readonly elapsedMs: number;
  /** No more samples will be drawn: complete, converged or cancelled. */
  readonly finished: boolean;
  readonly noiseThreshold: number | null;
  readonly noise: number | null;
  /** The sample count `noise` was measured at. */
  readonly noiseSamples: number;
}

/**
 * Time left at the mean time per sample so far. With a threshold, the stop is predicted from the noise falling as
 * 1/√n: n·(noise/threshold)², rounded up to the checkpoint it would be seen at and capped at the target.
 */
export function estimateRemainingMs(estimate: RemainingEstimate): number | null {
  const { samplesDone, targetSamples, elapsedMs, noiseThreshold, noise, noiseSamples } = estimate;
  if (estimate.finished) return 0;
  if (samplesDone <= 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  let stop = targetSamples;
  if (noiseThreshold !== null && noise !== null && Number.isFinite(noise) && noiseSamples > 0) {
    const predicted = Math.ceil(noiseSamples * (noise / noiseThreshold) ** 2);
    const seenAt = Math.max(nextCheckpoint(predicted), nextCheckpoint(samplesDone + 1));
    stop = Math.min(targetSamples, seenAt);
  }
  return (elapsedMs / samplesDone) * Math.max(0, stop - samplesDone);
}

