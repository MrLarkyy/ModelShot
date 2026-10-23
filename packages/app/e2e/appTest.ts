import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';

export { expect };

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'formats', 'test', 'fixtures');

export function fixture(...parts: string[]): string {
  return join(FIXTURES, ...parts);
}

export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

// Every page of every app spec: a request off the app origin, or any request but GET, fails the test, and so does an
// uncaught page error. Local-first: opening, rendering and exporting a model never upload it.
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
      } else if (request.url().startsWith('blob:') || request.url().startsWith('data:')) {
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

export async function openApp(page: Page, path = '/app/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ModelShot');
  await page.waitForFunction(() => window.__msApp !== undefined);
}

export async function openFiles(page: Page, paths: string[], shown: string): Promise<void> {
  await page.locator('#file-input').setInputFiles(paths);
  await expect(page.getByRole('status')).toContainText(`Opened ${shown}`, { timeout: 30_000 });
}

function decode(raw: { width: number; height: number; data: string }): Rgba {
  return { width: raw.width, height: raw.height, data: Buffer.from(raw.data, 'base64') };
}

export async function previewImage(page: Page): Promise<Rgba> {
  return decode(await page.evaluate(() => window.__msApp!.previewPixels()));
}

export async function renderImage(page: Page): Promise<Rgba> {
  const raw = await page.evaluate(() => window.__msApp!.renderPixels());
  if (!raw) throw new Error('no rendered image');
  return decode(raw);
}

export function pixelAt(image: Rgba, fx: number, fy: number): [number, number, number, number] {
  const x = Math.min(image.width - 1, Math.floor(fx * image.width));
  const y = Math.min(image.height - 1, Math.floor(fy * image.height));
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0, image.data[i + 3] ?? 0];
}

export function meanColour(image: Rgba): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    r += image.data[i * 4] ?? 0;
    g += image.data[i * 4 + 1] ?? 0;
    b += image.data[i * 4 + 2] ?? 0;
  }
  return [r / n, g / n, b / n];
}

/** Waits until the preview has drawn the model at least once (more than the backdrop's colour range). */
export async function waitForModel(page: Page): Promise<Rgba> {
  let image = await previewImage(page);
  for (let i = 0; i < 50; i++) {
    const centre = pixelAt(image, 0.5, 0.5);
    const corner = pixelAt(image, 0.02, 0.02);
    if (Math.abs(centre[0] - corner[0]) + Math.abs(centre[1] - corner[1]) + Math.abs(centre[2] - corner[2]) > 30) {
      return image;
    }
    await page.waitForTimeout(100);
    image = await previewImage(page);
  }
  return image;
}
