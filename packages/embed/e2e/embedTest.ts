import { expect, test as base, type APIRequestContext, type FrameLocator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { embedPorts } from './embedPort';

export { expect };

const ports = embedPorts();
export const FRAME_ORIGIN = `http://127.0.0.1:${ports.frame}`;
export const HOST_ORIGIN = `http://127.0.0.1:${ports.host}`;
export const CUBE = `${HOST_ORIGIN}/cors/single-cube.bbmodel`;
/** Status text once the bake lit the preview (the app's Viewer). */
export const LIT = 'Preview lit.';
export const LIT_TIMEOUT = 90_000;

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

/** What the host and model server was asked (hostServer.mjs `/__requests`). */
export interface HostRequest {
  readonly method: string;
  readonly path: string;
  readonly cookie: string | null;
  readonly referer: string | null;
  readonly origin: string | null;
}

export interface EmbedEvent {
  readonly type: 'load' | 'error';
  readonly detail: { readonly code?: string; readonly message?: string };
}

declare global {
  interface Window {
    __embedEvents?: EmbedEvent[];
    __cspViolations?: string[];
  }
}

// Every page of every embed spec records each request it makes and fails on an uncaught error in the host page or
// a frame; every frame records Content-Security-Policy violations.
export const test = base.extend<{ seen: Seen[] }>({
  seen: async ({ page }, use) => {
    const seen: Seen[] = [];
    page.on('request', (request) =>
      seen.push({ method: request.method(), url: request.url(), body: request.postData() }),
    );
    await use(seen);
  },
  page: async ({ page, request }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    await hostRequests(request, true);
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

export async function hostRequests(request: APIRequestContext, clear = false): Promise<HostRequest[]> {
  const response = await request.get(`${HOST_ORIGIN}/__requests${clear ? '?clear=1' : ''}`);
  return (await response.json()) as HostRequest[];
}

export async function openHost(page: Page): Promise<void> {
  await page.goto(`${HOST_ORIGIN}/host.html`);
  await page.evaluate(() => {
    window.__embedEvents = [];
  });
}

/** Loads the element script from the embed origin and adds `<modelshot-viewer>` with `attributes`, after `spacerPx`. */
export async function addViewer(page: Page, attributes: Record<string, string>, spacerPx = 0): Promise<void> {
  await page.evaluate(
    async ({ script, attributes, spacerPx }) => {
      await import(script);
      if (spacerPx > 0) {
        const spacer = document.createElement('div');
        spacer.style.height = `${spacerPx}px`;
        document.body.append(spacer);
      }
      const viewer = document.createElement('modelshot-viewer');
      for (const [name, value] of Object.entries(attributes)) viewer.setAttribute(name, value);
      for (const type of ['load', 'error'] as const) {
        viewer.addEventListener(type, (event) =>
          window.__embedEvents?.push({ type, detail: (event as CustomEvent<EmbedEvent['detail']>).detail }),
        );
      }
      document.body.append(viewer);
    },
    { script: `${FRAME_ORIGIN}/modelshot-embed.js`, attributes, spacerPx },
  );
}

export async function setAttributes(page: Page, attributes: Record<string, string | null>): Promise<void> {
  await page.evaluate((attributes) => {
    const viewer = document.querySelector('modelshot-viewer');
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null) viewer?.removeAttribute(name);
      else viewer?.setAttribute(name, value);
    }
  }, attributes);
}

export function viewerFrame(page: Page): FrameLocator {
  return page.frameLocator('modelshot-viewer iframe');
}

export async function events(page: Page): Promise<EmbedEvent[]> {
  return page.evaluate(() => window.__embedEvents ?? []);
}

/** Waits for the element's event of `type`. */
export async function waitForEvent(page: Page, type: EmbedEvent['type'], timeout = LIT_TIMEOUT): Promise<EmbedEvent> {
  await expect.poll(async () => (await events(page)).some((e) => e.type === type), { timeout }).toBe(true);
  return (await events(page)).find((e) => e.type === type)!;
}

/** The frame's alert once it shows one. */
export async function frameAlert(frame: FrameLocator, timeout = LIT_TIMEOUT): Promise<string> {
  const alert = frame.getByRole('alert');
  await expect(alert).toBeVisible({ timeout });
  return (await alert.textContent()) ?? '';
}

export async function waitLit(frame: FrameLocator): Promise<void> {
  await expect(frame.getByRole('status')).toHaveText(LIT, { timeout: LIT_TIMEOUT });
}

export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

export async function shot(page: Page, selector = 'modelshot-viewer'): Promise<Rgba> {
  const png = PNG.sync.read(await page.locator(selector).screenshot());
  return { width: png.width, height: png.height, data: png.data };
}

export function pixel(image: Rgba, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
}

/** Mean absolute difference per channel, 0..255. */
export function meanDifference(a: Rgba, b: Rgba): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
    count += 3;
  }
  return sum / count;
}

/** The CSP violations seen by the frame page. */
export async function cspViolations(page: Page): Promise<string[]> {
  const frame = page.frames().find((f) => f.url().startsWith(FRAME_ORIGIN));
  return frame ? frame.evaluate(() => window.__cspViolations ?? []) : [];
}
