import { expect, openLanding, test } from './siteTest';

test('the landing page loads everything from its own origin, fonts included', async ({ page, baseURL }) => {
  const requests: { url: string; method: string; status: number }[] = [];
  page.on('response', (response) =>
    requests.push({ url: response.url(), method: response.request().method(), status: response.status() }),
  );
  await openLanding(page, 1440);
  await page.waitForLoadState('networkidle');
  const origin = new URL(baseURL!).origin;
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((r) => new URL(r.url).origin !== origin)).toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
  const fonts = requests.filter((r) => r.url.endsWith('.woff2'));
  expect(fonts.length).toBeGreaterThanOrEqual(4);
  expect(fonts.every((r) => r.status === 200)).toBe(true);
});

test('the only off-origin references are links to the source repository', async ({ page }) => {
  await openLanding(page, 1440);
  const external = await page.evaluate(() =>
    [...document.querySelectorAll('[href], [src], [srcset], [action], [content]')].flatMap((element) =>
      ['href', 'src', 'srcset', 'action', 'content']
        .map((name) => element.getAttribute(name) ?? '')
        .filter((value) => /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value))
        .map((value) => `${element.tagName.toLowerCase()} ${value}`),
    ),
  );
  expect(external.every((ref) => /^a https:\/\/github\.com\/MrLarkyy\/ModelShot(?:\/|$)/.test(ref))).toBe(true);
});
