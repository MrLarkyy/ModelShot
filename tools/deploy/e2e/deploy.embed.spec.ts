import { CUBE_PATH, HOST_ORIGIN, expect, siteUrl, test } from './deployTest.ts';
import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';

const MODEL_URL = 'https://models.test/cube.bbmodel';

interface Seen {
  readonly type: 'load' | 'error';
  readonly detail: { readonly code?: string };
}

declare global {
  interface Window {
    __embedEvents?: Seen[];
  }
}

async function routeModel(context: BrowserContext): Promise<void> {
  const body = await readFile(CUBE_PATH);
  await context.route(MODEL_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body,
    }),
  );
}

// A host page on another origin, the way a wiki or a marketplace page loads the element: a module script from the
// versioned path, then the element.
async function addViewer(page: Page, script: string): Promise<void> {
  await page.goto(`${HOST_ORIGIN}/host.html`);
  await page.evaluate(
    async ({ script, model }) => {
      window.__embedEvents = [];
      await new Promise<void>((resolve, reject) => {
        const tag = document.createElement('script');
        tag.type = 'module';
        tag.src = script;
        tag.referrerPolicy = 'no-referrer';
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error(`could not load ${script}`));
        document.head.append(tag);
      });
      const viewer = document.createElement('modelshot-viewer');
      viewer.setAttribute('model', model);
      for (const type of ['load', 'error'] as const) {
        viewer.addEventListener(type, (event) =>
          window.__embedEvents?.push({ type, detail: (event as CustomEvent<Seen['detail']>).detail }),
        );
      }
      document.body.append(viewer);
    },
    { script, model: MODEL_URL },
  );
}

test('a host page on another origin loads the viewer from embed/v1/ and shows the model', async ({
  page,
  context,
  baseURL,
  observed,
}) => {
  await routeModel(context);
  await addViewer(page, siteUrl(baseURL, 'embed/v1/modelshot-embed.js'));
  await expect
    .poll(async () => page.evaluate(() => (window.__embedEvents ?? []).map((e) => e.type)), { timeout: 240_000 })
    .toContain('load');
  expect(await page.evaluate(() => (window.__embedEvents ?? []).filter((e) => e.type === 'error'))).toEqual([]);
  const frameSource = await page.locator('modelshot-viewer iframe').getAttribute('src');
  expect(frameSource).toContain(siteUrl(baseURL, 'embed/v1/#v=1&'));

  const allowed = [new URL(baseURL!).origin, HOST_ORIGIN, new URL(MODEL_URL).origin];
  for (const r of observed.requests.filter((r) => /^https?:/.test(r.url))) {
    expect(allowed, r.url).toContain(new URL(r.url).origin);
    expect(r.method, r.url).toBe('GET');
    expect(r.body, r.url).toBeNull();
  }
  expect(await observed.violations()).toEqual([]);
});

// A host page cached for ten minutes can name a frame whose lazy chunk the next deploy has removed: the frame says
// so, it does not hang.
test('a lazy chunk that is gone after a deploy gives a status or an error, not a hang', async ({
  page,
  context,
  baseURL,
}) => {
  await routeModel(context);
  await context.route('**/embed/v1/assets/bakeWorker*', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await addViewer(page, siteUrl(baseURL, 'embed/v1/modelshot-embed.js'));
  const frame = page.frameLocator('modelshot-viewer iframe');
  await expect
    .poll(
      async () => {
        if (await frame.getByRole('alert').isVisible()) return 'alert';
        return (await frame.locator('#stage').getAttribute('data-light')) === 'unbaked' ? 'unbaked' : 'waiting';
      },
      { timeout: 120_000 },
    )
    .not.toBe('waiting');
});
