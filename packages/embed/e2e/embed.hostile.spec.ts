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
 * The host page is not blocked by the download: it answers a script round trip every 250 ms until `done` settles. A
 * blocked page would stay silent for the whole 30 s stall or the whole oversized body, so the bound only has to
 * separate that from a slow software-rendered machine: 5 s, not a hair-trigger tuned to an idle one.
 */
const HOST_ANSWER_MS = 5000;

async function hostStaysResponsive<T>(page: Page, done: Promise<T>): Promise<T> {
  let finished = false;
  const result = done.finally(() => (finished = true));
  // Awaited below; marked handled so a rejection while polling is not reported as unhandled.
  result.catch(() => undefined);
  while (!finished) {
    const started = Date.now();
    await page.evaluate(() => 1);
    expect(Date.now() - started, 'the host page answers').toBeLessThan(HOST_ANSWER_MS);
    await page.waitForTimeout(250);
  }
  return result;
}

for (const [name, path] of [
  ['with Content-Length', '/big-length.bbmodel'],
  ['streamed without Content-Length', '/big-stream.bbmodel'],
] as const) {
  test(`a response over 64 MiB ${name} is refused and the host stays responsive`, async ({ page }) => {
    await openHost(page);
    await addViewer(page, { model: `${HOST_ORIGIN}${path}`, loading: 'eager' });
    const alert = await hostStaysResponsive(page, frameAlert(viewerFrame(page), 60_000));
    expect(alert).toMatch(/^MODEL_TOO_LARGE: /);
    expect(alert).toContain('64 MiB');
  });
}

test('a server that stalls after its headers is stopped after 30 s', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/stall.bbmodel`, loading: 'eager' });
  const started = Date.now();
  const alert = await hostStaysResponsive(page, frameAlert(viewerFrame(page), 40_000));
  expect(alert).toMatch(/^MODEL_FETCH_TIMEOUT: /);
  expect(Date.now() - started).toBeGreaterThan(25_000);
});

test('a file the loader refuses shows the loader code', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/cors/not-json.bbmodel`, loading: 'eager' });
  expect(await frameAlert(viewerFrame(page))).toMatch(/^NOT_JSON: /);
  expect((await waitForEvent(page, 'error')).detail.code).toBe('NOT_JSON');
});

test('a URL without a model extension fails before any download', async ({ page, seen }) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/cors/download?id=3`, loading: 'eager' });
  expect(await frameAlert(viewerFrame(page))).toMatch(/^UNSUPPORTED_TYPE: /);
  expect(seen.filter((r) => r.url.includes('/cors/'))).toEqual([]);
});

test('a javascript: model URL is refused in the element with no request', async ({ page, seen }) => {
  await openHost(page);
  const before = seen.length;
  await addViewer(page, { model: 'javascript:alert(1)', loading: 'eager' });
  const event = await waitForEvent(page, 'error', 5_000);
  expect(event.detail.code).toBe('MODEL_URL_INVALID');
  await expect(page.locator('modelshot-viewer').getByRole('alert')).toHaveText(/^MODEL_URL_INVALID: /);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(0);
  // Of the embed origin only the element script was asked for, and no model request went anywhere.
  const after = seen.slice(before).map((r) => new URL(r.url));
  expect(after.filter((u) => u.origin === FRAME_ORIGIN).map((u) => u.pathname)).toEqual(['/modelshot-embed.js']);
  expect(after.filter((u) => u.origin !== FRAME_ORIGIN)).toEqual([]);
});
