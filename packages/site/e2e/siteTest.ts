import { expect, test as base, type Page } from '@playwright/test';

export { expect };

export const WIDTHS = [360, 768, 1440] as const;

// Every page of every landing spec: a request off the site origin, or any request but GET, fails the test, and so
// does an uncaught page error. Local-first: opening a model never uploads it.
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL is not configured');
    const origin = new URL(baseURL).origin;
    const refused: string[] = [];
    const errors: string[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin === origin && request.method() === 'GET') {
        await route.continue();
      } else {
        refused.push(`${request.method()} ${request.url()}`);
        await route.abort();
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(refused, `requests that are not GET on ${origin}`).toEqual([]);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

// Loads every brand face the page uses and fails if one is missing, so no golden is taken with a fallback font.
export async function waitForFonts(page: Page): Promise<void> {
  const loaded = await page.evaluate(async () => {
    const faces = ['600 1em Unbounded', '800 1em Unbounded', '400 1em Manrope', '500 1em Manrope', '700 1em Manrope'];
    faces.push('500 1em "IBM Plex Mono"');
    const results = await Promise.all(faces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
    return faces.filter((face, i) => results[i]!.length > 0 && document.fonts.check(face));
  });
  expect(loaded).toHaveLength(6);
}

export async function openLanding(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await waitForFonts(page);
}
