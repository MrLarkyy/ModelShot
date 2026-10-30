import type { Page } from '@playwright/test';
import {
  FRAME_ORIGIN,
  HOST_ORIGIN,
  addViewer,
  expect,
  frameAlert,
  openHost,
  test,
  viewerFrame,
  waitForEvent,
} from './embedTest';

/**
 * A task this long on the frame's thread is jank the host page can see (the frame shares its process). Reading and
 * parsing the 63 MiB model there took about 300 ms on an idle machine and several times that under load; with the
 * load worker listing its references the frame thread only hands the file over.
 */
const LONG_TASK_MS = 100;

interface FrameTimeline {
  readonly longTasks: readonly { readonly start: number; readonly duration: number }[];
  readonly resources: readonly { readonly name: string; readonly startTime: number; readonly responseEnd: number }[];
  /** When `#stage` first took each `data-state`. */
  readonly states: Readonly<Record<string, number>>;
}

declare global {
  interface Window {
    __timeline?: { longTasks: { start: number; duration: number }[]; states: Record<string, number> };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((frameOrigin) => {
    if (location.origin !== frameOrigin) return;
    const timeline = { longTasks: [] as { start: number; duration: number }[], states: {} as Record<string, number> };
    window.__timeline = timeline;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        timeline.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    document.addEventListener('DOMContentLoaded', () => {
      const stage = document.getElementById('stage');
      if (!stage) return;
      new MutationObserver(() => {
        const state = stage.dataset['state'] ?? '';
        timeline.states[state] ??= performance.now();
      }).observe(stage, { attributes: true, attributeFilter: ['data-state'] });
    });
  }, FRAME_ORIGIN);
});

async function frameTimeline(page: Page): Promise<FrameTimeline> {
  const frame = page.frames().find((f) => f.url().startsWith(FRAME_ORIGIN));
  if (!frame) throw new Error('no embed frame');
  return frame.evaluate(() => ({
    longTasks: window.__timeline?.longTasks ?? [],
    states: window.__timeline?.states ?? {},
    resources: performance
      .getEntriesByType('resource')
      .map((r) => ({
        name: r.name,
        startTime: r.startTime,
        responseEnd: (r as PerformanceResourceTiming).responseEnd,
      })),
  }));
}

/**
 * The frame's long tasks from the end of the model's response to its first file request, or, when there is none, to
 * the failure: the time the frame used to read and list the model on its own thread.
 */
function listingWindow(timeline: FrameTimeline, model: string) {
  const response = timeline.resources.find((r) => r.name === model);
  if (!response) throw new Error(`no resource timing for ${model}`);
  const from = response.responseEnd;
  const sidecar = timeline.resources.find((r) => r.name.includes('/sidecars/') && r.startTime >= from);
  const to = sidecar?.startTime ?? timeline.states['failed'];
  if (to === undefined) throw new Error('neither a file request nor a failure after the model');
  const overlapping = timeline.longTasks.filter((t) => t.start < to && t.start + t.duration > from);
  return {
    windowMs: Math.round(to - from),
    longest: Math.round(Math.max(0, ...overlapping.map((t) => t.duration))),
    longTasks: overlapping.map((t) => Math.round(t.duration)),
  };
}

for (const [name, outcome] of [
  ['big.gltf', 'shown'],
  ['long-uri.gltf', 'SIDECAR_REFUSED'],
  ['duplicates.gltf', 'TOO_MANY_TEXTURES'],
] as const) {
  test(`/mainthread/${name} leaves the frame thread free between its response and its files (${outcome})`, async ({
    page,
  }, testInfo) => {
    const model = `${HOST_ORIGIN}/mainthread/${name}`;
    await openHost(page);
    await addViewer(page, { model, loading: 'eager' });
    if (outcome === 'shown') {
      await waitForEvent(page, 'load');
      await expect(viewerFrame(page).locator('#stage')).toHaveAttribute('data-state', 'shown');
    } else {
      expect(await frameAlert(viewerFrame(page), 120_000)).toMatch(new RegExp(`^${outcome}: `));
    }
    const measured = listingWindow(await frameTimeline(page), model);
    await testInfo.attach('frame-main-thread', {
      body: JSON.stringify({ model: name, ...measured }),
      contentType: 'application/json',
    });
    console.log(`frame main thread ${name}: ${JSON.stringify(measured)}`);
    expect(measured.longest, `no frame task of ${LONG_TASK_MS} ms or more while the model is listed`).toBeLessThan(
      LONG_TASK_MS,
    );
  });
}
