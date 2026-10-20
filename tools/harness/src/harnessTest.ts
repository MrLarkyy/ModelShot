import { expect, test as base } from '@playwright/test';

export { expect };

// Every page of every spec: a request off the fixture origin fails the test.
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL is not configured');
    const origin = new URL(baseURL).origin;
    const offOrigin: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (new URL(url).origin === origin) {
        await route.continue();
      } else {
        offOrigin.push(url);
        await route.abort();
      }
    });
    await use(page);
    expect(offOrigin, `requests off ${origin}`).toEqual([]);
  },
});
