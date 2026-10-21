/** How long the main thread was blocked since the probe started (or was reset). */
export interface EventLoopLag {
  /** Longest delay of a 10 ms heartbeat: page work, but also any time the OS gave the page no CPU. */
  readonly max: () => number;
  /**
   * Longest main-thread block from page work: the longest task the browser reports as a long task (50 ms or more),
   * or else the longest stretch run through `work`.
   */
  readonly block: () => number;
  /** Runs `fn` and counts its duration as main-thread work. */
  readonly work: <T>(fn: () => T) => T;
  /** Forgets everything so far: the measures cover what runs from now on. */
  readonly reset: () => void;
  readonly stop: () => void;
}

const HEARTBEAT_MS = 10;

/**
 * Keeps the main thread busy for `ms` in a task of its own (a timer, as page work runs; a test of the long-task
 * measure) and resolves after it.
 */
export function spinMainThread(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const end = performance.now() + ms;
      while (performance.now() < end);
      resolve();
    }, 0);
  });
}

/**
 * Main-thread responsiveness probes. The heartbeat (a 10 ms timer, each beat recording how late it ran) also counts
 * time the page did not get the CPU at all; on SwiftShader, whose GPU process spreads every draw over all cores, a
 * bake delays it by up to 200 ms while no task of the page runs (MS-16). `block()` measures the page's own work: the
 * Long Tasks API for any task over 50 ms, and the timed stretches of `work` below that.
 */
export function startEventLoopLag(): EventLoopLag {
  let worst = 0;
  let longest = 0;
  let worked = 0;
  let due = performance.now() + HEARTBEAT_MS;
  let timer = 0;
  const beat = (): void => {
    const now = performance.now();
    worst = Math.max(worst, now - due);
    due = now + HEARTBEAT_MS;
    timer = window.setTimeout(beat, HEARTBEAT_MS);
  };
  timer = window.setTimeout(beat, HEARTBEAT_MS);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration);
  });
  observer.observe({ type: 'longtask' });
  return {
    max: () => worst,
    block: () => {
      // Entries of tasks that ended before this one are queued, but their observer callback may not have run yet.
      for (const entry of observer.takeRecords()) longest = Math.max(longest, entry.duration);
      return Math.max(longest, worked);
    },
    work: (fn) => {
      const start = performance.now();
      try {
        return fn();
      } finally {
        worked = Math.max(worked, performance.now() - start);
      }
    },
    reset: () => {
      worst = 0;
      longest = 0;
      worked = 0;
    },
    stop: () => {
      window.clearTimeout(timer);
      observer.disconnect();
    },
  };
}
