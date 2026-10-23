import { expect, fixture, openApp, openFiles, test } from './appTest';

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

test('opening, rendering and exporting make only same-origin GET requests without a body', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const seen: Seen[] = [];
  page.on('request', (request) =>
    seen.push({ method: request.method(), url: request.url(), body: request.postData() }),
  );

  await openApp(page);
  const initial = seen.length;
  const initialScripts = seen.slice(0, initial).filter((r) => new URL(r.url).pathname.endsWith('.js'));
  // The page loads its entry (and the e2e hook); the path tracer, the export code and the workers wait for first use.
  expect(initialScripts.map((r) => new URL(r.url).pathname.split('/').pop())).toEqual(
    expect.not.arrayContaining([expect.stringMatching(/^(loadWorker|bakeWorker|src-)/)]),
  );

  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 60_000 });
  const afterOpen = seen.slice(initial).map((r) => new URL(r.url).pathname.split('/').pop() ?? '');
  expect(afterOpen.some((name) => name.startsWith('loadWorker'))).toBe(true);
  expect(afterOpen.some((name) => name.startsWith('bakeWorker'))).toBe(true);

  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 60_000 });

  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Width (px)').fill('32');
  await dialog.getByLabel('Height (px)').fill('32');
  await dialog.getByLabel('Samples').fill('2');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await download;

  for (const request of seen) {
    const url = new URL(request.url);
    if (url.protocol === 'blob:' || url.protocol === 'data:') continue;
    expect(url.origin, request.url).toBe(origin);
    expect(request.method, request.url).toBe('GET');
    expect(request.body, request.url).toBeNull();
    expect(request.url, 'a model name or its bytes in a URL').not.toMatch(/single-cube|bbmodel|base64/i);
  }
});

test('the page makes no request while a model is dropped on it, and a dropped file is read in the page', async ({
  page,
}) => {
  await openApp(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{"meta":{}}'], 'dropped.bbmodel'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toContainText('dropped.bbmodel');
  expect(requests.filter((url) => !url.includes('/assets/'))).toEqual([]);
});
