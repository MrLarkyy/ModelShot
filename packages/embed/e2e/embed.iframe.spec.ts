import { CUBE, FRAME_ORIGIN, expect, frameAlert, openHost, pixel, shot, test, waitLit } from './embedTest';

async function addIframe(page: import('@playwright/test').Page, fragment: string): Promise<void> {
  await page.evaluate(
    ({ src }) => {
      window.addEventListener('message', (event) => {
        const data = event.data as { source?: string; type?: 'load' | 'error'; code?: string; message?: string };
        if (data.source === 'modelshot-embed' && data.type) {
          window.__embedEvents?.push({
            type: data.type,
            detail: { code: data.code ?? '', message: data.message ?? '' },
          });
        }
      });
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = 'Model';
      iframe.width = '300';
      iframe.height = '300';
      iframe.style.border = '0';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.referrerPolicy = 'no-referrer';
      document.body.append(iframe);
    },
    { src: `${FRAME_ORIGIN}/#${fragment}` },
  );
}

test('a plain iframe of the frame page with the fragment shows the model and posts load', async ({ page }) => {
  await openHost(page);
  await addIframe(page, `v=1&model=${encodeURIComponent(CUBE)}`);
  const frame = page.frameLocator('iframe');
  await waitLit(frame);
  await expect.poll(() => page.evaluate(() => window.__embedEvents?.map((e) => e.type))).toEqual(['load']);
  const image = await shot(page, 'iframe');
  const centre = pixel(image, 150, 150);
  const corner = pixel(image, 4, 4);
  expect(Math.max(...centre.map((c, i) => Math.abs(c - corner[i]!)))).toBeGreaterThan(8);
});

test('a plain iframe reports an unsupported version and an invalid value, and ignores a query string', async ({
  page,
}) => {
  await openHost(page);
  await addIframe(page, `v=2&model=${encodeURIComponent(CUBE)}`);
  expect(await frameAlert(page.frameLocator('iframe'), 10_000)).toMatch(/^UNSUPPORTED_VERSION: /);
  await expect
    .poll(() => page.evaluate(() => window.__embedEvents?.map((e) => e.detail.code)))
    .toEqual(['UNSUPPORTED_VERSION']);

  const navigate = (src: string) =>
    page.evaluate((src) => {
      document.querySelector('iframe')!.src = src;
    }, src);
  // The model only in the query: the frame reads the fragment alone.
  await navigate(`${FRAME_ORIGIN}/?model=${encodeURIComponent(CUBE)}#v=1`);
  await expect(page.frameLocator('iframe').getByRole('alert')).toHaveText(/^MISSING_MODEL: /, { timeout: 10_000 });
  await navigate(`${FRAME_ORIGIN}/#v=1&model=${encodeURIComponent(CUBE)}&pitch=95`);
  await expect(page.frameLocator('iframe').getByRole('alert')).toHaveText(/^INVALID_PARAM: pitch /, {
    timeout: 10_000,
  });
});
