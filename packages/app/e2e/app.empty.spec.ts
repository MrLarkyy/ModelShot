import type { Page } from '@playwright/test';
import {
  dragFiles,
  droppedFixture,
  expect,
  fixture,
  forgetLocalData,
  openApp,
  openFiles,
  test,
  waitForEditor,
} from './appTest';

const FLAT = fixture('bbmodel', 'flat-cube.bbmodel');
const CUBE = fixture('bbmodel', 'single-cube.bbmodel');
const ANIMATED = fixture('bbmodel', 'animated.bbmodel');

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} is not shown`);
  return found;
};

for (const [width, height] of [
  [1440, 900],
  [375, 667],
] as const) {
  test(`the empty state says what to open and that it stays local at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    const card = page.locator('#empty');
    await expect(card.getByRole('heading', { name: 'Open a model' })).toBeVisible();
    await expect(card).toContainText('Blockbench');
    await expect(card).toContainText('glTF/GLB');
    await expect(card).toContainText('OBJ');
    await expect(card.getByText('Your file stays in this browser tab and is never uploaded.')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Open…' }).first()).toBeVisible();
    for (const name of ['Blockbench model', 'Player skin', 'glTF or OBJ']) {
      await expect(card.getByRole('button', { name })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`empty-${width}.png`) });
  });
}

test('Open works from the keyboard, the entry cards narrow the picker and a later Open lists everything', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const accept = (): Promise<string> =>
    page
      .locator('#file-input')
      .getAttribute('accept')
      .then((v) => v ?? '');
  await page.locator('#empty-open').focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await chooser;
  const full = await accept();
  expect(full).toContain('.bbmodel');
  expect(full).toContain('.glb');

  const viaCtrl = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await viaCtrl;

  for (const [name, narrowed] of [
    ['Blockbench model', '.bbmodel,.png,.jpg,.jpeg'],
    ['Player skin', '.png'],
    ['glTF or OBJ', '.gltf,.glb,.bin,.obj,.mtl,.png,.jpg,.jpeg'],
  ] as const) {
    const chosen = page.waitForEvent('filechooser');
    await page.getByRole('button', { name }).click();
    await chosen;
    expect(await accept(), name).toBe(narrowed);
    const later = page.waitForEvent('filechooser');
    await page.locator('#empty-open').click();
    await later;
    expect(await accept(), `Open after ${name}`).toBe(full);
  }
});

test('a drag is not highlighted while a dialog would refuse the drop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await dragFiles(page, 'enter', [{ name: 'a.bbmodel', text: '{}' }]);
  await expect(page.locator('#empty')).not.toHaveAttribute('data-drag', '');
  await dragFiles(page, 'leave', [{ name: 'a.bbmodel', text: '{}' }]);
});

test('a drag over the empty page highlights the card, a drop opens the model', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const file = droppedFixture(FLAT);
  await dragFiles(page, 'enter', [file]);
  await expect(page.locator('#empty')).toHaveAttribute('data-drag', '');
  await expect(page.locator('#drop-overlay')).toBeHidden();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('empty-drag-over.png') });
  await dragFiles(page, 'leave', [file]);
  await expect(page.locator('#empty')).not.toHaveAttribute('data-drag', '');
  await dragFiles(page, 'enter', [file]);
  await dragFiles(page, 'drop', [file]);
  await expect(page.getByRole('status')).toContainText('Opened flat-cube.bbmodel', { timeout: 30_000 });
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#preview')).toBeVisible();
  // With a model open the full overlay takes the drag, the card is gone.
  await dragFiles(page, 'enter', [file]);
  await expect(page.locator('#drop-overlay')).toBeVisible();
  await dragFiles(page, 'leave', [file]);
  await expect(page.locator('#drop-overlay')).toBeHidden();
});

test('an unsupported or truncated file shows the existing error and the page stays responsive', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await dragFiles(page, 'drop', [{ name: 'notes.txt', text: 'hello' }]);
  await expect(page.getByRole('alert')).toContainText('.bbmodel');
  await expect(page.locator('#empty')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('empty-error.png') });
  await page.getByRole('button', { name: 'Dismiss the error' }).click();
  await dragFiles(page, 'drop', [{ name: 'broken.glb', text: 'glTF\u0002\u0000\u0000\u0000truncated' }]);
  // The page answers while the reader works, and the error is the loader's, not the 30 s watchdog's.
  const started = Date.now();
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
  expect(Date.now() - started).toBeLessThan(1000);
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).not.toContainText('took longer than');
  await expect(page.locator('#empty')).toBeVisible();
});

test('no band under the canvas, and the empty panels are explained', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const preview = await box(page, '#preview');
  const view = await box(page, '#viewport');
  const stage = await box(page, '.stage');
  const timeline = await box(page, '#timeline');
  expect(preview.y + preview.height).toBeCloseTo(view.y + view.height, 0);
  expect(view.y + view.height).toBeCloseTo(stage.y + stage.height, 0);
  expect(timeline.y).toBeGreaterThanOrEqual(view.y + view.height - 1);
  expect(timeline.height, 'the timeline is one row').toBeLessThan(60);
  await expect(page.locator('#preview')).toBeHidden();
  await expect(page.locator('#outliner')).toContainText('Open a model to list its groups, meshes and lights.');
  await expect(page.locator('#inspector')).toContainText('Open a model to edit its objects, materials and light.');
  await expect(page.locator('#timeline')).toContainText('Animations of the open model play here.');
  await expect(page.locator('#timeline-separator')).toBeHidden();
});

test('a model without animation keeps the timeline a bar, an animated one gets the full timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#timeline')).toContainText('This model has no animations.');
  expect((await box(page, '#timeline')).height).toBeLessThan(60);
  await expect(page.locator('#timeline-separator')).toBeHidden();
  await openFiles(page, [ANIMATED], 'animated.bbmodel');
  await expect(page.locator('#timeline-separator')).toBeVisible();
  expect((await box(page, '#timeline')).height).toBeGreaterThan(60);
});

test.describe('first run hint', () => {
  test.use({ firstRunHint: true });

  test('shows after the first open, stays dismissed, and returns after Forget local data', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    const hint = page.getByRole('region', { name: 'Shortcut hints' });
    await expect(hint).toBeHidden();
    await openFiles(page, [CUBE], 'single-cube.bbmodel');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Ctrl+O / Cmd+O');
    await hint.getByRole('button', { name: 'Dismiss shortcut hints' }).click();
    await expect(hint).toBeHidden();
    await expect(page.locator('#preview')).toBeFocused();
    await page.reload();
    await page.waitForFunction(() => window.__msApp !== undefined);
    await openFiles(page, [CUBE], 'single-cube.bbmodel');
    await expect(hint).toBeHidden();
    await forgetLocalData(page);
    expect(await page.evaluate(() => localStorage.getItem('modelshot-hints-v1'))).toBeNull();
    await openFiles(page, [FLAT], 'flat-cube.bbmodel');
    await expect(hint).toBeVisible();
  });
});
