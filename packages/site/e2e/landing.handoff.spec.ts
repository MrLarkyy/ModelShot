import type { Page } from '@playwright/test';
import { expect, openLanding, test } from './siteTest';

const CUBE = { name: 'cube.bbmodel', mimeType: 'application/json', buffer: Buffer.from('{"meta":{}}') };
const APP_URL = /\/app\/\?open=handoff$/;

function pendingRecords(page: Page): Promise<number> {
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

function writeRecord(page: Page, record: { v: unknown; ageMs: number }): Promise<void> {
  return page.evaluate(
    ({ v, ageMs }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('modelshot-handoff', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('pending');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const tx = open.result.transaction('pending', 'readwrite');
          const files = [new File(['{}'], 'old.bbmodel')];
          tx.objectStore('pending').put({ v, files, createdAt: Date.now() - ageMs }, 'current');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    record,
  );
}

function dropFiles(page: Page, selector: string, names: string[]): Promise<boolean> {
  return page.evaluate(
    ({ selector, names }) => {
      const transfer = new DataTransfer();
      for (const name of names) transfer.items.add(new File(['{}'], name));
      const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, names },
  );
}

test('a chosen file opens in the app on this device and the stored copy is deleted', async ({ page }) => {
  await openLanding(page, 1440);
  await page.locator('#model-input').setInputFiles(CUBE);
  await expect(page).toHaveURL(APP_URL);
  const status = page.getByRole('status');
  await expect(status).toContainText('1 file(s) kept on this device');
  await expect(status.getByRole('listitem')).toHaveText([`cube.bbmodel · ${CUBE.buffer.length} bytes`]);
  expect(await pendingRecords(page)).toBe(0);

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Nothing to open');
});

test('a file dropped on the zone opens in the app', async ({ page }) => {
  await openLanding(page, 1440);
  const navigation = page.waitForURL(APP_URL);
  expect(await dropFiles(page, '#drop-zone', ['skin.png', 'tree.bbmodel'])).toBe(true);
  await navigation;
  await expect(page.getByRole('status').getByRole('listitem')).toHaveText([/^skin\.png/, /^tree\.bbmodel/]);
  expect(await pendingRecords(page)).toBe(0);
});

test('an unsupported file shows an alert naming the rule and stays on the page', async ({ page }) => {
  await openLanding(page, 1440);
  await page
    .locator('#model-input')
    .setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert')).toContainText('"setup.exe" is not a model');
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await pendingRecords(page)).toBe(0);
});

test('more than 32 files are refused with an alert', async ({ page }) => {
  await openLanding(page, 1440);
  const files = Array.from({ length: 33 }, (_, i) => ({ ...CUBE, name: `m${i}.bbmodel` }));
  await page.locator('#model-input').setInputFiles(files);
  await expect(page.getByRole('alert')).toContainText('at most 32');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a file dropped outside the zone does not navigate the tab', async ({ page }) => {
  await openLanding(page, 1440);
  expect(await dropFiles(page, 'footer', ['cube.bbmodel'])).toBe(true);
  await expect(page.getByRole('alert')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await pendingRecords(page)).toBe(0);
});

test('the app discards a record older than 10 minutes', async ({ page }) => {
  await page.goto('/app/');
  await writeRecord(page, { v: 1, ageMs: 11 * 60 * 1000 });
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('older than 10 minutes');
  expect(await pendingRecords(page)).toBe(0);
});

test('the app refuses a record it does not understand', async ({ page }) => {
  await page.goto('/app/');
  await writeRecord(page, { v: 2, ageMs: 0 });
  await page.goto('/app/?open=handoff');
  await expect(page.getByRole('status')).toContainText('Nothing to open: unreadable handoff (VERSION)');
  expect(await pendingRecords(page)).toBe(0);
});

function chosenFiles(page: Page): Promise<number> {
  return page.locator('#model-input').evaluate((input: HTMLInputElement) => input.files?.length ?? 0);
}

test('the picker is emptied after a refused choice and after a storage failure', async ({ page }) => {
  await openLanding(page, 1440);
  await page
    .locator('#model-input')
    .setInputFiles({ name: 'setup.exe', mimeType: 'text/plain', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert')).toContainText('setup.exe');
  expect(await chosenFiles(page)).toBe(0);

  await page.evaluate(() => {
    indexedDB.open = () => {
      throw new Error('storage blocked by the test');
    };
  });
  await page.locator('#model-input').setInputFiles(CUBE);
  await expect(page.getByRole('alert')).toContainText('storage blocked by the test');
  expect(await chosenFiles(page)).toBe(0);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('coming back from the app leaves an empty picker and the same file opens again', async ({ page }) => {
  await openLanding(page, 1440);
  await page.locator('#model-input').setInputFiles(CUBE);
  await expect(page).toHaveURL(APP_URL);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  expect(await chosenFiles(page)).toBe(0);
  await page.locator('#model-input').setInputFiles(CUBE);
  await expect(page).toHaveURL(APP_URL);
  await expect(page.getByRole('status').getByRole('listitem')).toHaveText([/^cube\.bbmodel/]);
});

test('the landing page removes an expired record on load and keeps a fresh one', async ({ page }) => {
  await openLanding(page, 1440);
  await writeRecord(page, { v: 1, ageMs: 11 * 60 * 1000 });
  await page.reload();
  await expect.poll(() => pendingRecords(page)).toBe(0);

  await writeRecord(page, { v: 1, ageMs: 0 });
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await pendingRecords(page)).toBe(1);
});

// Headless Chromium reloads instead of restoring from the back/forward cache, so the restore is fired directly.
test('a page restored from the back/forward cache shows an empty picker and no old alert', async ({ page }) => {
  await openLanding(page, 1440);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#model-input')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{}'], 'cube.bbmodel'));
    input.files = transfer.files;
    document.querySelector('#drop-error')!.textContent = 'an old message';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  expect(await chosenFiles(page)).toBe(0);
  await expect(page.locator('#drop-error')).toHaveText('');
});
