import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';
import { deployPorts } from './deployPort.ts';

export { expect };

const HERE = dirname(fileURLToPath(import.meta.url));
export const DIST = join(HERE, '..', 'dist');
export const CUBE_PATH = join(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'formats',
  'test',
  'fixtures',
  'bbmodel',
  'single-cube.bbmodel',
);
export const HOST_ORIGIN = `http://127.0.0.1:${deployPorts().host}`;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

export interface Observed {
  /** Every request of the context: pages, frames, workers. */
  readonly requests: Seen[];
  /** The Content-Security-Policy violations of the page and its frames so far. */
  violations(): Promise<string[]>;
}

// Every test records each request of its context and each Content-Security-Policy violation of every frame, and fails
// on an uncaught page error.
export const test = base.extend<{ observed: Observed }>({
  observed: async ({ context, page }, use) => {
    const requests: Seen[] = [];
    context.on('request', (request) =>
      requests.push({ method: request.method(), url: request.url(), body: request.postData() }),
    );
    await context.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    await use({
      requests,
      violations: async () => {
        const found: string[] = [];
        for (const frame of page.frames()) {
          found.push(...(await frame.evaluate(() => window.__cspViolations ?? []).catch(() => [])));
        }
        return found;
      },
    });
  },
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

/** The site's URL for `path`, relative to the deployed base (`app/`, `embed/v1/`). */
export function siteUrl(baseURL: string | undefined, path: string): string {
  if (!baseURL) throw new Error('baseURL is not configured');
  return new URL(path, baseURL).href;
}

export async function cubeFile(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  return { name: 'single-cube.bbmodel', mimeType: 'application/json', buffer: await readFile(CUBE_PATH) };
}

/** In the open app: Render 4 samples, then export a 32 px PNG and return its bytes. */
export async function renderAndExport(page: Page): Promise<Buffer> {
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 90_000 });
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 90_000 });

  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Width (px)').fill('32');
  await dialog.getByLabel('Height (px)').fill('32');
  await dialog.getByLabel('Samples').fill('2');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const bytes = await readFile(await (await download).path());
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  await expect(page.getByRole('alert')).toHaveCount(0);
  return bytes;
}
