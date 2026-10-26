import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { DIST, expect, siteUrl, test } from './deployTest.ts';

const WORKER_CHUNK = /[A-Za-z]*Worker-[\w-]+\.js/g;
// Files that keep their name (a page or a stable URL): everything else is named by its content hash.
const STABLE =
  /^(?:index\.html|sw\.js|modelshot-embed\.js|favicon[\w-]*\.(?:svg|png)|apple-touch-icon\.png|icon-\d+\.png|social-preview\.png)$/;

async function files(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else found.push(path);
  }
  return found;
}

test('the frame can be embedded: no X-Frame-Options, no frame-ancestors', async ({ request, baseURL }) => {
  const response = await request.get(siteUrl(baseURL, 'embed/v1/'));
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers['x-frame-options']).toBeUndefined();
  expect(headers['content-security-policy'] ?? '').not.toContain('frame-ancestors');
});

test('the element script and the worker chunks are JavaScript that any origin may load', async ({
  request,
  baseURL,
}) => {
  const urls = [siteUrl(baseURL, 'embed/v1/modelshot-embed.js'), siteUrl(baseURL, 'app/sw.js')];
  const sw = await (await request.get(siteUrl(baseURL, 'app/sw.js'))).text();
  for (const name of new Set(sw.match(WORKER_CHUNK))) urls.push(siteUrl(baseURL, `app/assets/${name}`));
  const frameHtml = await (await request.get(siteUrl(baseURL, 'embed/v1/'))).text();
  const mainScript = /src="\.\/(assets\/[^"]+\.js)"/.exec(frameHtml)?.[1];
  expect(mainScript, 'the frame page names its script').toBeDefined();
  const main = await (await request.get(siteUrl(baseURL, `embed/v1/${mainScript}`))).text();
  const frameWorkers = new Set(main.match(WORKER_CHUNK));
  expect(frameWorkers.size, 'the frame has worker chunks').toBeGreaterThan(0);
  for (const name of frameWorkers) urls.push(siteUrl(baseURL, `embed/v1/assets/${name}`));
  expect(urls.length).toBeGreaterThanOrEqual(5);

  for (const url of urls) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()['content-type'], url).toMatch(/javascript/);
    if (!url.endsWith('/sw.js')) expect(response.headers()['access-control-allow-origin'], url).toBe('*');
  }
});

test('every file but the pages and the stable URLs has a content hash in its name', async () => {
  const unhashed = (await files(DIST))
    .map((path) => relative(DIST, path).split(sep).join('/'))
    .filter((path) => !STABLE.test(path.split('/').pop() ?? ''))
    .filter((path) => !/-[\w-]{8}\.[a-z0-9]+$/.test(path));
  expect(unhashed).toEqual([]);
});
