/** Longest event-loop delay seen since the probe started. */
export interface EventLoopLag {
  readonly max: () => number;
  /** Forgets the lag so far: `max()` then covers what runs from now on. */
  readonly reset: () => void;
  readonly stop: () => void;
}

const HEARTBEAT_MS = 10;

/**
 * A 10 ms heartbeat on the main thread: each beat records how much later than due it ran, so `max()` is the longest
 * time the page could not respond (a long task, a blocking GL call) while it ran.
 */
export function startEventLoopLag(): EventLoopLag {
  let worst = 0;
  let due = performance.now() + HEARTBEAT_MS;
  let timer = 0;
  const beat = (): void => {
    const now = performance.now();
    worst = Math.max(worst, now - due);
    due = now + HEARTBEAT_MS;
    timer = window.setTimeout(beat, HEARTBEAT_MS);
  };
  timer = window.setTimeout(beat, HEARTBEAT_MS);
  return {
    max: () => worst,
    reset: () => {
      worst = 0;
    },
    stop: () => window.clearTimeout(timer),
  };
}
