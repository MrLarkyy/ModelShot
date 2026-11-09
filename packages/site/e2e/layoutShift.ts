import type { Page } from '@playwright/test';

type ShiftWindow = Window & { __cls: number };

export async function observeLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as ShiftWindow;
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
}

export function layoutShiftTotal(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ShiftWindow).__cls);
}
