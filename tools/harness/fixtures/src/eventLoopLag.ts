/** The longest main-thread stretches since the probe started (or was reset), for a bench to print. */
export interface BlockReport {
  /** Longest duration per named phase of page work (`work`). */
  readonly phases: Readonly<Record<string, number>>;
  /** Every long task (50 ms or more) the browser reported: start (ms since the probe began) and duration. */
  readonly longTasks: readonly { readonly start: number; readonly duration: number }[];
  /** The phases of 5 ms or more, with their start, to put next to the long tasks. */
  readonly slowPhases: readonly { readonly phase: string; readonly start: number; readonly duration: number }[];
}

/** How long the main thread was blocked since the probe started (or was reset). */
export interface EventLoopLag {
  /** Longest delay of a 10 ms heartbeat: page work, but also any time the OS gave the page no CPU. */
  readonly max: () => number;
  /**
   * Longest main-thread block from page work: the longest task the browser reports as a long task (50 ms or more),
   * or else the longest stretch run through `work`.
   */
  readonly block: () => number;
  /** Runs `fn` and counts its duration as main-thread work of `phase`. */
  readonly work: <T>(phase: string, fn: () => T) => T;
  readonly report: () => BlockReport;
  /** Forgets everything so far: the measures cover what runs from now on. */
  readonly reset: () => void;
  readonly stop: () => void;
}

const HEARTBEAT_MS = 10;
const SLOW_PHASE_MS = 5;
const MAX_SLOW_PHASES = 200;

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
 * Long Tasks API for any task over 50 ms, and the timed phases of `work` below that. Worker message handlers are timed
 * as phase `worker-message` and posts to a worker as `worker-post` (installed before any worker is created).
 */
export function startEventLoopLag(): EventLoopLag {
  const origin = performance.now();
  let worst = 0;
  let worked = 0;
  let phases: Record<string, number> = {};
  let longTasks: { start: number; duration: number }[] = [];
  let slowPhases: { phase: string; start: number; duration: number }[] = [];
  let due = performance.now() + HEARTBEAT_MS;
  let timer = 0;
  const beat = (): void => {
    const now = performance.now();
    worst = Math.max(worst, now - due);
    due = now + HEARTBEAT_MS;
    timer = window.setTimeout(beat, HEARTBEAT_MS);
  };
  timer = window.setTimeout(beat, HEARTBEAT_MS);
  const record = (entries: PerformanceEntryList): void => {
    for (const entry of entries) longTasks.push({ start: entry.startTime - origin, duration: entry.duration });
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: 'longtask' });
  const work = <T>(phase: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      worked = Math.max(worked, duration);
      phases[phase] = Math.max(phases[phase] ?? 0, duration);
      if (duration >= SLOW_PHASE_MS && slowPhases.length < MAX_SLOW_PHASES) {
        slowPhases.push({ phase, start: start - origin, duration });
      }
    }
  };
  const addListener = Reflect.get(Worker.prototype, 'addEventListener') as (
    this: Worker,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  Worker.prototype.addEventListener = function (
    this: Worker,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const timed =
      type === 'message' && typeof listener === 'function'
        ? (event: Event) => work('worker-message', () => listener.call(this, event))
        : listener;
    addListener.call(this, type, timed, options);
  };
  // Posting to a worker (the bake's document and mesh stream) is main-thread work of its own.
  const postMessage = Reflect.get(Worker.prototype, 'postMessage') as (this: Worker, ...args: unknown[]) => void;
  Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]): void {
    work('worker-post', () => postMessage.apply(this, args));
  } as Worker['postMessage'];
  // Entries of tasks that ended before this one are queued, but their observer callback may not have run yet.
  const flush = (): void => record(observer.takeRecords());
  return {
    max: () => worst,
    block: () => {
      flush();
      return Math.max(worked, ...longTasks.map((task) => task.duration));
    },
    work,
    report: () => {
      flush();
      return { phases: { ...phases }, longTasks: [...longTasks], slowPhases: [...slowPhases] };
    },
    reset: () => {
      flush();
      worst = 0;
      worked = 0;
      phases = {};
      longTasks = [];
      slowPhases = [];
    },
    stop: () => {
      window.clearTimeout(timer);
      observer.disconnect();
      Worker.prototype.addEventListener = addListener;
      Worker.prototype.postMessage = postMessage as Worker['postMessage'];
    },
  };
}
