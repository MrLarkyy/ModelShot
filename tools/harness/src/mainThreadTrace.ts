import type { Page } from '@playwright/test';

/** The renderer main thread's tasks while a trace ran. */
export interface MainThreadTrace {
  readonly tasks: number;
  /** The longest task by wall time: wall and CPU milliseconds. */
  readonly longestWall: number;
  readonly longestCpu: number;
  /** The largest wall − CPU of one task: time the thread did not run while in a task (descheduled, or waiting). */
  readonly largestGap: number;
  /** The most CPU time one task used. */
  readonly maxCpu: number;
  /** The longest synchronous wait for the GPU process inside one task (wall time of the waits, summed per task). */
  readonly maxGpuWait: number;
  /**
   * The most one task blocked the page: its CPU time plus the time it waited synchronously for the GPU process
   * (`GPU_WAIT_EVENTS`), but not time the OS simply did not run the thread. Tasks Playwright's `evaluate` runs count
   * like any other top-level task.
   */
  readonly maxBlocking: number;
}

interface TraceEvent {
  readonly ph: string;
  readonly cat?: string;
  readonly name: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly dur?: number;
  readonly tdur?: number;
  readonly args?: { readonly name?: string };
}

/**
 * The command-buffer client's synchronous waits for the GPU process, as the pinned Chrome traces them (category
 * `gpu`): `WaitForGetOffset` under a readback or a state query (`readPixels`, `getError`, `finish`), `WaitForToken`
 * when an upload (`texSubImage2D`, `bufferData`) needs transfer-buffer space the GPU process has not freed yet. Found in
 * this Chrome's traces of such calls after heavy draws (MS-16 round 8); the outer wrappers (`ImplementationBase::
 * WaitForCmd`, `CommandBufferHelper::Finish`, mojo `GpuChannel::WaitFor*InRange`) cover the same time and are not
 * counted again.
 */
export const GPU_WAIT_EVENTS: ReadonlySet<string> = new Set([
  'CommandBufferProxyImpl::WaitForGetOffset',
  'CommandBufferProxyImpl::WaitForToken',
]);

const TASK_EVENTS = new Set(['ThreadControllerImpl::RunTask', 'RunTask']);

/**
 * Runs `body` under a Chrome trace (top-level tasks with their thread CPU time, and the GPU client's waits, through
 * CDP) and sums up the page's main thread (`CrRendererMain`). A task's blocking time is the CPU it used plus the time it
 * waited for the GPU process; wall time beyond that is the OS not running the thread on a loaded machine. Throws when
 * the trace holds no main thread, no task or a task without CPU time: a measure that silently reads 0 proves nothing.
 */
export async function traceMainThread(page: Page, body: () => Promise<unknown>): Promise<MainThreadTrace> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (event) => {
    for (const e of event.value as unknown as TraceEvent[]) events.push(e);
  });
  const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
  await cdp.send('Tracing.start', { categories: 'toplevel,gpu', options: 'record-continuously' });
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
  if (main.size === 0) throw new Error('the trace has no CrRendererMain thread');
  const onMain = (e: TraceEvent) => e.ph === 'X' && e.dur !== undefined && main.has(`${e.pid}:${e.tid}`);
  const tasks = events.filter((e) => onMain(e) && TASK_EVENTS.has(e.name)).sort((a, b) => a.ts - b.ts);
  const waits = events.filter((e) => onMain(e) && GPU_WAIT_EVENTS.has(e.name)).sort((a, b) => a.ts - b.ts);
  if (tasks.length === 0) throw new Error('the trace has no task on the main thread');
  const withoutCpu = tasks.filter((e) => e.tdur === undefined).length;
  if (withoutCpu > 0) throw new Error(`${withoutCpu} of ${tasks.length} main-thread tasks carry no CPU time (tdur)`);
  const result = {
    tasks: tasks.length,
    longestWall: 0,
    longestCpu: 0,
    largestGap: 0,
    maxCpu: 0,
    maxGpuWait: 0,
    maxBlocking: 0,
  };
  let w = 0;
  // Nested RunTask events (a task inside a task) are visited too; each counts its own nested waits.
  for (const task of tasks) {
    const start = task.ts;
    const end = task.ts + (task.dur ?? 0);
    while (w < waits.length && (waits[w]?.ts ?? 0) < start) w++;
    let waited = 0;
    let waitedOffCpu = 0;
    for (let i = w; i < waits.length && (waits[i]?.ts ?? Infinity) < end; i++) {
      const wait = waits[i] as TraceEvent;
      if (wait.ts + (wait.dur ?? 0) > end) continue;
      waited += (wait.dur ?? 0) / 1000;
      waitedOffCpu += ((wait.dur ?? 0) - (wait.tdur ?? 0)) / 1000;
    }
    const wall = (task.dur ?? 0) / 1000;
    const cpu = (task.tdur ?? 0) / 1000;
    if (wall > result.longestWall) {
      result.longestWall = wall;
      result.longestCpu = cpu;
    }
    result.largestGap = Math.max(result.largestGap, wall - cpu);
    result.maxCpu = Math.max(result.maxCpu, cpu);
    result.maxGpuWait = Math.max(result.maxGpuWait, waited);
    result.maxBlocking = Math.max(result.maxBlocking, cpu + waitedOffCpu);
  }
  return result;
}
