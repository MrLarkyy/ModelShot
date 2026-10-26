import { CUBE, FRAME_ORIGIN, addViewer, expect, openHost, test, viewerFrame, waitLit, type Seen } from './embedTest';

const frameDocuments = (seen: readonly Seen[]): Seen[] =>
  seen.filter((r) => {
    const url = new URL(r.url);
    return url.origin === FRAME_ORIGIN && (url.pathname === '/' || url.pathname.endsWith('.html'));
  });

test('an element far below the fold makes no frame request until scrolled near', async ({ page, seen }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE }, 3000);
  // Time for an observer callback and a request, had either happened.
  await page.waitForTimeout(1500);
  expect(frameDocuments(seen)).toEqual([]);
  expect(seen.filter((r) => r.url.includes('single-cube'))).toEqual([]);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(0);

  // 260 px below the viewport: still nothing. Within 200 px: the frame comes.
  const scrollToGap = (gapPx: number) =>
    page.evaluate((gapPx) => {
      const top = document.querySelector('modelshot-viewer')!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - window.innerHeight - gapPx);
    }, gapPx);
  await scrollToGap(260);
  await page.waitForTimeout(1500);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(0);
  await scrollToGap(150);
  await expect(page.locator('modelshot-viewer iframe')).toHaveCount(1, { timeout: 10_000 });
  await waitLit(viewerFrame(page));
  expect(frameDocuments(seen)).toHaveLength(1);
});

test('loading=eager loads at once, below the fold too', async ({ page, seen }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, loading: 'eager' }, 3000);
  await expect(page.locator('modelshot-viewer iframe')).toHaveCount(1, { timeout: 2_000 });
  await expect.poll(() => frameDocuments(seen).length, { timeout: 10_000 }).toBe(1);
});
