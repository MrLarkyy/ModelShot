import type { Page } from '@playwright/test';

type ShiftRecord = PerformanceEntry & { value: number; hadRecentInput: boolean };
type ShiftWindow = Window & {
  __cls: number;
  __clsObserver: PerformanceObserver;
  __clsAdd: (records: PerformanceEntryList) => void;
};

export async function observeLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as ShiftWindow;
    w.__cls = 0;
    w.__clsAdd = (records) => {
      for (const entry of records as ShiftRecord[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    };
    w.__clsObserver = new PerformanceObserver((list) => w.__clsAdd(list.getEntries()));
    w.__clsObserver.observe({ type: 'layout-shift', buffered: true });
  });
}

export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
}

// takeRecords drains entries the observer has not delivered yet, so the total is complete at the read.
export function layoutShiftTotal(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as ShiftWindow;
    w.__clsAdd(w.__clsObserver.takeRecords());
    return w.__cls;
  });
}
