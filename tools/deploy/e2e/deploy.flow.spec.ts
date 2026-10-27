import { cubeFile, expect, renderAndExport, test } from './deployTest.ts';

test('a model chosen on the landing page opens in the app, renders and exports, and nothing leaves the origin', async ({
  page,
  baseURL,
  observed,
}) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('the hero.');
  await page.locator('#model-input').setInputFiles(await cubeFile());
  await expect(page).toHaveURL(/\/app\/(\?open=handoff)?$/);
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await renderAndExport(page);

  const origin = new URL(baseURL!).origin;
  const network = observed.requests.filter((r) => /^https?:/.test(r.url));
  expect(network.length).toBeGreaterThan(0);
  for (const r of network) {
    expect(new URL(r.url).origin, r.url).toBe(origin);
    expect(r.method, r.url).toBe('GET');
    expect(r.body, r.url).toBeNull();
  }
  expect(await observed.violations()).toEqual([]);
});
