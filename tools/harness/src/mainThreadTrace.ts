import type { Page } from '@playwright/test';

/** The renderer main thread's tasks while a trace ran: the longest by wall time, and wall time no CPU accounts for. */
export interface MainThreadTrace {
  readonly tasks: number;
  /** The longest task: wall and CPU milliseconds. */
  readonly longestWall: number;
  readonly longestCpu: number;
  /** The largest wall − CPU of one task: time the OS did not run the thread while it was in a task. */
  readonly largestGap: number;
  /**
   * The most CPU time one task used: the page's own longest block, whatever the OS did meanwhile. Tasks Playwright's
   * `evaluate` runs count too (they are top-level tasks of the thread like any other).
   */
  readonly maxCpu: number;
}

interface TraceEvent {
  readonly ph: string;
  readonly name: string;
  readonly pid: number;
  readonly tid: number;
  readonly dur?: number;
  readonly tdur?: number;
  readonly args?: { readonly name?: string };
}

/**
 * Runs `body` under a Chrome trace (top-level tasks with their thread CPU time, through CDP) and sums up the page's
 * main thread (`CrRendererMain`). A task whose wall time far exceeds its CPU time was descheduled by the OS, not busy
 * with page work: what tells a slow phase of a loaded machine from a slow phase of the page.
 */
export async function traceMainThread(page: Page, body: () => Promise<void>): Promise<MainThreadTrace> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (event) => {
    for (const e of event.value as unknown as TraceEvent[]) events.push(e);
  });
  const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
  await cdp.send('Tracing.start', { categories: 'toplevel', options: 'record-continuously' });
  try {
    await body();
  } finally {
    await cdp.send('Tracing.end');
    await complete;
    await cdp.detach();
  }
  const main = new Set(
    events
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const result = { tasks: 0, longestWall: 0, longestCpu: 0, largestGap: 0, maxCpu: 0 };
  for (const e of events) {
    const isTask = e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask';
    if (e.ph !== 'X' || !isTask || e.dur === undefined || !main.has(`${e.pid}:${e.tid}`)) continue;
    const wall = e.dur / 1000;
    const cpu = (e.tdur ?? e.dur) / 1000;
    result.tasks++;
    if (wall > result.longestWall) {
      result.longestWall = wall;
      result.longestCpu = cpu;
    }
    result.largestGap = Math.max(result.largestGap, wall - cpu);
    result.maxCpu = Math.max(result.maxCpu, cpu);
  }
  return result;
}
