import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
export const test = base.extend<{ firstRunHint: boolean }>({
  // The one-time shortcut row would cover the chips in specs about something else: it starts dismissed unless a spec asks.
  firstRunHint: [false, { option: true }],
  page: async ({ page, baseURL, firstRunHint }, use) => {
    if (!baseURL) throw new Error('baseURL is not configured');
    if (!firstRunHint) {
      await page.addInitScript(() => {
        if (sessionStorage.getItem('ms-hint-seeded')) return;
        sessionStorage.setItem('ms-hint-seeded', '1');
        localStorage.setItem('modelshot-hints-v1', '1');
      });
    }
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
  // The stylesheet is a separate request: a page measured or captured before it applies is unstyled under load.
  await page.waitForFunction(() => getComputedStyle(document.body).display === 'grid');
}

/** Shows an inspector tab; the choice is kept per browser, so a later test step finds the same tab. */
export async function openTab(page: Page, name: 'Object' | 'Material' | 'Light' | 'Look' | 'Render'): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Opens the File menu (Open, Export, Forget local data, Shortcuts). */
export async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#file-menu')).toBeVisible();
}

/** Waits until the preview is lit: the model dot carries the lighting state, the status line only the last message. */
export async function expectLit(page: Page, timeout = 120_000): Promise<void> {
  await expect(page.locator('#model-state')).toContainText('Preview lit', { timeout });
}

/** Forget local data through the File menu; `confirm` false cancels the dialog instead. */
export async function forgetLocalData(page: Page, confirm = true): Promise<void> {
  await openFileMenu(page);
  await page.getByRole('button', { name: 'Forget local data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forget local data?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: confirm ? 'Forget local data' : 'Cancel' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * The shown elements matching `controls` that the box of `over` intersects: none when it covers nothing. Boxes, not
 * hit tests: a message that lets clicks through still hides what is under it.
 */
export function coveredBy(page: Page, over: string, controls: string): Promise<string[]> {
  return page.evaluate(
    ([overSelector, controlSelector]) => {
      const top = document.querySelector(overSelector)?.getBoundingClientRect();
      if (!top || top.width === 0 || top.height === 0) throw new Error(`${overSelector} has no box`);
      const found = [...document.querySelectorAll<HTMLElement>(controlSelector)].filter(
        (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden',
      );
      if (found.length === 0) throw new Error(`nothing shown matches ${controlSelector}`);
      return found
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.left < top.right && top.left < box.right && box.top < top.bottom && top.top < box.bottom;
        })
        .map((node) => node.id || node.textContent?.trim() || node.tagName);
    },
    [over, controls] as const,
  );
}

/** Waits until the editor tools (overlay, picking, gizmo, timeline) are loaded. */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset['editor'] === 'ready');
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

/** Waits until the preview has drawn the model (some pixel apart from the backdrop's colour) and stopped changing. */
export async function waitForModel(page: Page): Promise<Rgba> {
  let image = await previewImage(page);
  for (let i = 0; i < 80; i++) {
    const corner = pixelAt(image, 0.02, 0.02);
    let drawn = false;
    for (let y = 0; y < 24 && !drawn; y++) {
      for (let x = 0; x < 24 && !drawn; x++) {
        const p = pixelAt(image, (x + 0.5) / 24, (y + 0.5) / 24);
        drawn = Math.abs(p[0] - corner[0]) + Math.abs(p[1] - corner[1]) + Math.abs(p[2] - corner[2]) > 30;
      }
    }
    const before = image;
    await page.waitForTimeout(150);
    image = await previewImage(page);
    if (drawn && before.data.equals(image.data)) return image;
  }
  throw new Error('The preview never showed a settled model.');
}

/** The frames of a GIF: its image descriptors, found by walking the blocks (image data may contain any byte). */
export function gifFrameCount(gif: Buffer): number {
  let at = 13;
  if ((gif[10] ?? 0) & 0x80) at += 3 * 2 ** (((gif[10] ?? 0) & 7) + 1);
  let frames = 0;
  const skipBlocks = (): void => {
    while ((gif[at] ?? 0) !== 0) at += (gif[at] ?? 0) + 1;
    at += 1;
  };
  while (at < gif.length) {
    const marker = gif[at++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      at += 1;
      skipBlocks();
    } else if (marker === 0x2c) {
      frames += 1;
      const flags = gif[at + 8] ?? 0;
      at += 9;
      if (flags & 0x80) at += 3 * 2 ** ((flags & 7) + 1);
      at += 1;
      skipBlocks();
    } else {
      throw new Error(`unexpected GIF block 0x${(marker ?? 0).toString(16)}`);
    }
  }
  return frames;
}

/** The `num_frames` of an APNG's acTL chunk, 0 when the PNG has none. */
export function apngFrameCount(png: Buffer): number {
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'acTL') return png.readUInt32BE(at + 8);
    at += 12 + length;
  }
  return 0;
}

export interface MadeFile {
  readonly name: string;
  /** Text content, or a size for a file of zero bytes. */
  readonly text?: string;
  readonly size?: number;
}

/** Puts Files built in the page into the file input and fires its change event, as a picker does. */
export async function chooseMadeFiles(page: Page, files: readonly MadeFile[]): Promise<void> {
  await page.locator('#file-input').evaluate((input: HTMLInputElement, made) => {
    const transfer = new DataTransfer();
    for (const file of made) {
      transfer.items.add(new File([file.text ?? new Uint8Array(file.size ?? 0)], file.name));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
}

/** The stored per-model records of the app's database (the saves are debounced and the browser may take a moment). */
export function storedModels(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve) => {
        const open = indexedDB.open('modelshot-app', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('session');
          open.result.createObjectStore('models');
        };
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('models').objectStore('models').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Record<string, unknown>[]);
          };
        };
      }),
  );
}

/** Waits until a stored record satisfies `test`. */
export async function waitForStored(page: Page, test: (record: Record<string, unknown>) => boolean): Promise<void> {
  await expect
    .poll(async () => (await storedModels(page)).some(test), { timeout: 20_000, intervals: [250] })
    .toBe(true);
}

export interface DroppedFile {
  readonly name: string;
  readonly base64?: string;
  readonly text?: string;
}

/** A fixture file on disk as a file to drop. */
export function droppedFixture(path: string): DroppedFile {
  return { name: basename(path), base64: readFileSync(path).toString('base64') };
}

/** Dispatches the drag events a file drag from the desktop produces on the window: 'enter', 'leave' or 'drop'. */
export async function dragFiles(
  page: Page,
  phase: 'enter' | 'leave' | 'drop',
  files: readonly DroppedFile[],
): Promise<void> {
  await page.evaluate(
    ({ phase: which, files: list }) => {
      const transfer = new DataTransfer();
      for (const file of list) {
        const bytes = file.base64 ? Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)) : (file.text ?? '');
        transfer.items.add(new File([bytes], file.name));
      }
      const type = which === 'enter' ? 'dragenter' : which === 'leave' ? 'dragleave' : 'drop';
      window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    },
    { phase, files },
  );
}
