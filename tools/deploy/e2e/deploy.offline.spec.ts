import { cubeFile, expect, renderAndExport, siteUrl, test } from './deployTest.ts';

// The service worker is the app's: it controls app/ and nothing else on the origin, and after the first load the whole
// flow works with the network cut.
test('after the first load the app works offline under its sub-path; the landing page and the frame are not controlled', async ({
  page,
  context,
  baseURL,
}) => {
  const appPath = new URL('app/', siteUrl(baseURL, './')).pathname;
  await page.goto('app/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ModelShot');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('modelshot-app-'));
    const cache = await caches.open(names[0] ?? '');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached).toContain(appPath);
  for (const worker of ['loadWorker', 'bakeWorker', 'geometryWorker']) {
    expect(
      cached.some((path) => path.startsWith(`${appPath}assets/${worker}`)),
      worker,
    ).toBe(true);
  }

  for (const path of ['./', 'embed/v1/']) {
    await page.goto(path);
    expect(await page.evaluate(() => navigator.serviceWorker.controller), `${path} is not controlled`).toBeNull();
  }

  await page.goto('app/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ModelShot');
  await page.locator('#file-input').setInputFiles(await cubeFile());
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await renderAndExport(page);
});
