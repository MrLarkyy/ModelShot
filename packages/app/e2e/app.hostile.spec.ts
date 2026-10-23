import type { Page } from '@playwright/test';
import {
  chooseMadeFiles,
  expect,
  fixture,
  openApp,
  openFiles,
  pixelAt,
  previewImage,
  test,
  waitForModel,
} from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

// The page answers within a second even while a file is being refused or read.
async function expectResponsive(page: Page): Promise<void> {
  const started = Date.now();
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
  expect(Date.now() - started).toBeLessThan(1000);
}

async function expectAlert(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByRole('alert')).toContainText(text, { timeout: 5000 });
  await expectResponsive(page);
}

test('a truncated GLB shows an alert naming the file', async ({ page }) => {
  await openApp(page);
  const header = Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 0xff, 0xff, 0, 0, 0x10, 0, 0, 0]);
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: header });
  await expectAlert(page, 'broken.glb');
});

test('a bbmodel that is not JSON shows the loader error', async ({ page }) => {
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'bad.bbmodel', text: 'not json at all' }]);
  await expectAlert(page, /bad\.bbmodel.*Not JSON/);
});

test('a bbmodel over the loader file limit is refused with the limit named', async ({ page }) => {
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'huge.bbmodel', size: 65 * 1024 * 1024 }]);
  await expectAlert(page, /huge\.bbmodel.*File too large/);
});

test('files over 256 MiB in total are refused before any is read', async ({ page }) => {
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'big.bbmodel', size: 300 * 1024 * 1024 }]);
  await expectAlert(page, '256 MiB');
});

test('a file of another kind is refused, and so are several models', async ({ page }) => {
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'notes.txt', text: 'hello' }]);
  await expectAlert(page, 'notes.txt');
  await chooseMadeFiles(page, [
    { name: 'a.bbmodel', text: '{}' },
    { name: 'b.obj', text: 'v 0 0 0' },
  ]);
  await expectAlert(page, 'one model at a time');
});

test('a load that hangs is stopped by the watchdog, the page stays responsive and the model stays', async ({
  page,
}) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const before = await waitForModel(page);
  await page.evaluate(() => {
    window.__msApp!.setWatchdogMs(500);
    window.__msApp!.hangNextLoad();
  });
  await page.locator('#file-input').setInputFiles([fixture('bbmodel', 'flat-cube.bbmodel')]);
  await expectAlert(page, /flat-cube\.bbmodel.*took longer/);
  const after = await previewImage(page);
  expect(pixelAt(after, 0.5, 0.5)).toEqual(pixelAt(before, 0.5, 0.5));
  // A good file opens right after.
  await openFiles(page, [fixture('bbmodel', 'flat-cube.bbmodel')], 'flat-cube.bbmodel');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a failed open keeps the model that is shown', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const before = await waitForModel(page);
  await chooseMadeFiles(page, [{ name: 'bad.bbmodel', text: '{"meta":{}}' }]);
  await expectAlert(page, 'bad.bbmodel');
  const after = await previewImage(page);
  expect(pixelAt(after, 0.5, 0.5)).toEqual(pixelAt(before, 0.5, 0.5));
  await expect(page.getByRole('button', { name: 'Render' })).toBeEnabled();
});

test('a tampered stored session is ignored and the app starts empty', async ({ page }) => {
  await openApp(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('modelshot-app', 1);
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const tx = open.result.transaction('session', 'readwrite');
          tx.objectStore('session').put(
            { v: 1, files: ['not a file'], modelKey: 'zz', savedAt: Date.now() },
            'current',
          );
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
