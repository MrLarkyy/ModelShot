import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, fixture, openApp, test, waitForModel, waitForStored } from './appTest';

interface Part {
  readonly name: string;
  readonly base64: string;
}

async function parts(...paths: string[]): Promise<Part[]> {
  return Promise.all(
    paths.map(async (path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      base64: (await readFile(path)).toString('base64'),
    })),
  );
}

// What the landing page leaves: Files in `modelshot-handoff` / `pending` / `current`.
function putRecord(page: Page, files: Part[], extra: { v?: number; ageMs?: number } = {}): Promise<void> {
  return page.evaluate(
    ({ files, v, ageMs }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('modelshot-handoff', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('pending');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const made = files.map((f) => new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name));
          const tx = open.result.transaction('pending', 'readwrite');
          tx.objectStore('pending').put({ v, files: made, createdAt: Date.now() - ageMs }, 'current');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { files, v: extra.v ?? 1, ageMs: extra.ageMs ?? 0 },
  );
}

function pending(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('modelshot-handoff', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('pending');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const count = open.result.transaction('pending').objectStore('pending').count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
}

test('files handed over by the landing page open, and are readable after the record is deleted', async ({ page }) => {
  await openApp(page);
  await putRecord(page, await parts(fixture('bbmodel', 'single-cube.bbmodel')));
  await page.goto('/app/?open=handoff');
  await page.waitForFunction(() => window.__msApp !== undefined);
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  expect(await pending(page)).toBe(0);
  expect(new URL(page.url()).search).toBe('');
  await waitForModel(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a handed-over glTF brings its buffer and texture along', async ({ page }) => {
  await openApp(page);
  await putRecord(
    page,
    await parts(fixture('gltf', 'external.gltf'), fixture('gltf', 'external.bin'), fixture('gltf', 'external.png')),
  );
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('Opened external.gltf', { timeout: 30_000 });
});

test('a handoff that cannot be read says so and opens nothing', async ({ page }) => {
  await openApp(page);
  await putRecord(page, await parts(fixture('bbmodel', 'single-cube.bbmodel')), { v: 2 });
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('Nothing to open: unreadable handoff (VERSION)');
  await expect(page.locator('#empty')).toBeVisible();
  expect(await pending(page)).toBe(0);
});

test('a handoff older than 10 minutes is discarded', async ({ page }) => {
  await openApp(page);
  await putRecord(page, await parts(fixture('bbmodel', 'single-cube.bbmodel')), { ageMs: 11 * 60 * 1000 });
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('older than 10 minutes');
  expect(await pending(page)).toBe(0);
});

test('a reload after a handoff reopens the same model from the local session', async ({ page }) => {
  await openApp(page);
  await putRecord(page, await parts(fixture('bbmodel', 'single-cube.bbmodel')));
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await waitForStored(page, () => true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
});
