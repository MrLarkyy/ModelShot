import type { Locator, Page } from '@playwright/test';
import {
  expect,
  fixture,
  openApp,
  openFiles,
  openTab,
  previewImage,
  storedModels,
  test,
  waitForStored,
  waitForEditor,
  waitForModel,
  expectLit,
} from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');
const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

const overlayPixels = (page: Page): Promise<number> => page.evaluate(() => window.__msApp!.overlayPixels());
const selected = (page: Page) => page.locator('#scene-panel [aria-current="true"]');

async function openNested(page: Page): Promise<void> {
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
}

async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#viewport').boundingBox();
  if (!box) throw new Error('no viewport');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('selecting in the outliner outlines it in the view and fills the inspector', async ({ page }) => {
  await openNested(page);
  await expect(selected(page)).toHaveCount(0);
  const before = await overlayPixels(page);
  const row = page.locator('#scene-panel [data-row^="node:"]').first();
  const name = (await row.textContent()) ?? '';
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#tabpanel-object').getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect.poll(() => overlayPixels(page)).toBeGreaterThan(before);
});

test('a click in the view selects the mesh under it, an orbit drag selects nothing', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
  const centre = await viewportCentre(page);
  const yaw = await page.evaluate(() => window.__msApp!.state().yawDeg);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 10, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__msApp!.state().yawDeg)).not.toBe(yaw);
  await expect(selected(page)).toHaveCount(0);
  await page.mouse.click(centre.x, centre.y);
  await expect(selected(page)).toHaveCount(1);
  // A click on empty ground clears the selection.
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 8, (box?.y ?? 0) + 60);
  await expect(selected(page)).toHaveCount(0);
});

test('rename, hide, lock and search work from the outliner and survive a reload', async ({ page }) => {
  await openNested(page);
  const firstRow = page.locator('#scene-panel [data-row^="node:"]').first();
  await firstRow.focus();
  await page.keyboard.press('F2');
  const input = page.locator('#scene-panel input[type="text"]');
  await expect(input).toBeFocused();
  await input.fill('Pelvis');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-panel [data-row^="node:"]').first()).toHaveText('Pelvis');

  const lock = page.getByRole('button', { name: 'Lock Pelvis' });
  await lock.click();
  await expect(page.getByRole('button', { name: 'Lock Pelvis' })).toHaveAttribute('aria-pressed', 'true');
  const hide = page.getByRole('checkbox', { name: 'Visible: Pelvis' });
  await hide.uncheck();
  await expect(page.getByRole('checkbox', { name: 'Visible: Pelvis' })).not.toBeChecked();

  const all = await page.locator('#scene-panel [data-row]').count();
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('pelv');
  await expect(page.locator('#scene-panel').getByText('1 match')).toBeVisible();
  expect(await page.locator('#scene-panel [data-row]').count()).toBeLessThan(all);
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('');

  await expect
    .poll(async () => {
      const [record] = await storedModels(page);
      return JSON.stringify([record?.['names'], record?.['lockedNodes']]);
    })
    .toBe('[{"n:0":"Pelvis"},[0]]');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await expect(page.locator('#scene-panel [data-row^="node:"]').first()).toHaveText('Pelvis');
  await expect(page.getByRole('button', { name: 'Lock Pelvis' })).toHaveAttribute('aria-pressed', 'true');
});

test('the keyboard focus stays on a row control after it changes the outliner', async ({ page }) => {
  await openNested(page);
  const box = page.locator('#scene-panel input[type="checkbox"]').first();
  await box.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#scene-panel input[type="checkbox"]').first()).not.toBeChecked();
  await expect(page.locator('#scene-panel input[type="checkbox"]').first()).toBeFocused();
  const lock = page.locator('#scene-panel button.lock').first();
  await lock.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-panel button.lock').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scene-panel button.lock').first()).toBeFocused();
});

test('the gizmo moves the node, Undo and Redo step through it, and it is remembered', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.gizmoHandles().length)).toBe(3);
  const handle = (await page.evaluate(() => window.__msApp!.gizmoHandles())).find((h) => h.axis === 0)!;
  const box = (await page.locator('#viewport').boundingBox())!;
  const mid = { x: box.x + (handle.from.x + handle.to.x) / 2, y: box.y + (handle.from.y + handle.to.y) / 2 };
  const before = await previewImage(page);
  const positionX = page.locator('#tabpanel-object').getByLabel('Position X');
  await expect(positionX).toHaveValue('0');
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 30, mid.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await positionX.inputValue())).not.toBe(0);
  await expect.poll(async () => (await previewImage(page)).data.equals(before.data)).toBe(false);
  const moved = await positionX.inputValue();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(positionX).toHaveValue('0');
  await page.keyboard.press('Control+Shift+Z');
  await expect(positionX).toHaveValue(moved);

  await expect
    .poll(async () => ((await storedModels(page))[0]?.['nodeEdits'] as unknown[] | undefined)?.length)
    .toBe(1);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect(page.locator('#tabpanel-object').getByLabel('Position X')).toHaveValue(moved);
});

test('typing a position in the Object tab edits the node', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const field = page.locator('#tabpanel-object').getByLabel('Position Y');
  await field.fill('3');
  await field.dispatchEvent('change');
  await expect(page.locator('#tabpanel-object').getByLabel('Position Y')).toHaveValue('3');
  await expect.poll(async () => JSON.stringify((await storedModels(page))[0]?.['nodeEdits'])).toContain('3');
});

test('Tab from a committed position field lands on the next field', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const panel = page.locator('#tabpanel-object');
  await panel.getByLabel('Position X').fill('2');
  await page.keyboard.press('Tab');
  await expect.poll(async () => JSON.stringify((await storedModels(page))[0]?.['nodeEdits'])).toContain('2');
  await expect(panel.getByLabel('Position X')).toHaveValue('2');
  await expect(panel.getByLabel('Position Y')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByLabel('Position Z')).toBeFocused();
});

test('the Visible checkbox of the Object tab keeps the focus after the change', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const visible = (): Locator => page.locator('#tabpanel-object').getByLabel('Visible', { exact: true });
  await visible().focus();
  await page.keyboard.press('Space');
  await expect(visible()).not.toBeChecked();
  await expect(visible()).toBeFocused();
});

test('a locked node shows no gizmo and cannot be picked', async ({ page }) => {
  await openNested(page);
  const row = page.locator('#scene-panel [data-row^="node:"]').first();
  await row.click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.gizmoHandles().length)).toBe(3);
  await page
    .getByRole('button', { name: /^Lock / })
    .first()
    .click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.gizmoHandles().length)).toBe(0);
  await expect(page.locator('#tabpanel-object').getByLabel('Position X')).toBeDisabled();
});

test('a scene that fails to build at the release of a drag keeps the old transform', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.gizmoHandles().length)).toBe(3);
  const handle = (await page.evaluate(() => window.__msApp!.gizmoHandles())).find((h) => h.axis === 0)!;
  const box = (await page.locator('#viewport').boundingBox())!;
  const mid = { x: box.x + (handle.from.x + handle.to.x) / 2, y: box.y + (handle.from.y + handle.to.y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 30, mid.y, { steps: 5 });
  await page.evaluate(() => window.__msApp!.failNextScene());
  await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('Could not update the view');
  await expect(page.locator('#tabpanel-object').getByLabel('Position X')).toHaveValue('0');
  expect((await storedModels(page))[0]?.['nodeEdits']).toBeUndefined();
});

// Opens the cube while the test holds its scene: the open waits with its files loaded until `releaseScene`.
async function openCubeHeld(page: Page): Promise<void> {
  await page.evaluate(() => window.__msApp!.holdNextScene());
  await page.locator('#file-input').setInputFiles([CUBE]);
  await expect.poll(() => page.evaluate(() => window.__msApp!.sceneHeld())).toBe(true);
}

test('a gizmo commit while another model opens is refused and the open applies', async ({ page }) => {
  await openNested(page);
  await openCubeHeld(page);
  const committed = await page.evaluate(() =>
    window.__msApp!.commitNodeEdit({ node: 0, translation: [1, 0, 0], rotation: [0, 0, 0] }),
  );
  expect(committed).toBe(false);
  await page.evaluate(() => window.__msApp!.releaseScene());
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an open whose scene fails to build says which model is still shown', async ({ page }) => {
  await openNested(page);
  await page.evaluate(() => window.__msApp!.failNextScene());
  await page.locator('#file-input').setInputFiles([CUBE]);
  await expect(page.getByRole('alert')).toContainText('Could not show single-cube.bbmodel');
  await expect(page.getByRole('status')).toContainText('Still showing nested-groups.bbmodel.');
});

test('an open whose scene is refused says which model is still shown', async ({ page }) => {
  await openNested(page);
  await page.evaluate(() => window.__msApp!.refuseNextScene());
  await page.locator('#file-input').setInputFiles([CUBE]);
  await expect(page.getByRole('alert')).toContainText('the scene changed while it was opening.');
  await expect(page.getByRole('status')).toContainText('Still showing nested-groups.bbmodel.');
});

test('changes queued before an open apply to their model first, then the open applies untouched', async ({ page }) => {
  await openNested(page);
  // Change A (hide mesh 0) is held while it sets its scene; the node edit B queues behind it, then the cube opens.
  await page.evaluate(() => window.__msApp!.holdNextScene());
  await page.locator('#scene-panel [data-focus="box:mesh:0"]').click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.sceneHeld())).toBe(true);
  await page.evaluate(() => {
    void window.__msApp!.commitNodeEdit({ node: 0, translation: [1, 0, 0], rotation: [0, 0, 0] });
  });
  await page.locator('#file-input').setInputFiles([CUBE]);
  await expect(page.getByRole('status')).toContainText('Opening single-cube.bbmodel');
  // Long enough for the cube to load and show if it did not wait for the queued changes.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('status')).toContainText('Opening single-cube.bbmodel');
  await page.evaluate(() => window.__msApp!.releaseScene());
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#scene-panel [data-focus="box:mesh:0"]')).toBeChecked();
  // The nested model keeps both changes (its record also hides what the file hides); the cube's record has none.
  await waitForStored(page, (record) => {
    const hidden = record['hiddenMeshes'] as number[] | undefined;
    const edits = record['nodeEdits'] as unknown[] | undefined;
    return (hidden?.includes(0) ?? false) && edits?.length === 1;
  });
  await waitForStored(
    page,
    (record) => (record['hiddenMeshes'] as unknown[] | undefined)?.length === 0 && record['nodeEdits'] === undefined,
  );
});

test('a look picked while a model without a saved look opens is kept and lit', async ({ page }) => {
  await openNested(page);
  await openTab(page, 'Look');
  await expect(page.getByRole('radio', { name: 'Studio' })).toBeChecked();
  await openCubeHeld(page);
  await page.getByRole('radio', { name: 'Marketplace' }).check();
  await page.evaluate(() => window.__msApp!.releaseScene());
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await expect(page.getByRole('radio', { name: 'Marketplace' })).toBeChecked();
  await expectLit(page, 120_000);
  await waitForStored(page, (record) => record['look'] === 'marketplace');
});

test('the Light tab lists the look lights read-only and adding is disabled', async ({ page }) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Key light' }).click();
  await expect(page.getByRole('tab', { name: 'Light' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tabpanel-light')).toContainText('Rim light');
  await expect(page.locator('#tabpanel-light').getByRole('button', { name: 'Add light' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: /Add light \(coming/ })).toBeDisabled();
  await openTab(page, 'Object');
});
