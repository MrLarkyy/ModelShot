import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const HERE = dirname(fileURLToPath(import.meta.url));
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

test('the Light tab lists the look lights read-only with no placeholder control', async ({ page }) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Key light' }).click();
  await expect(page.getByRole('tab', { name: 'Light' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tabpanel-light')).toContainText('Rim light');
  await expect(page.locator('#tabpanel-light')).toContainText('Lights come from the Studio look');
  await expect(page.locator('#tabpanel-light').getByRole('button', { name: 'Add light' })).toHaveCount(0);
  await expect(page.locator('#tabpanel-light').getByRole('group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: /Add light \(coming/ })).toBeDisabled();
  await openTab(page, 'Object');
});

test('the inspector rail never wraps and its selected tab looks the same focused or not', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const separator = page.getByRole('separator', { name: 'Resize the inspector' });
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const key of ['Home', 'End', 'Home']) {
    await separator.focus();
    await page.keyboard.press(key);
    const tops = await tabs.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().top)));
    expect(tops, `rail at ${await separator.getAttribute('aria-valuenow')} px`).toEqual(
      [...tops].sort((a, b) => a - b),
    );
    const lefts = await tabs.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().left)));
    expect(new Set(lefts).size, 'one column').toBe(1);
    expect(await page.getByRole('tablist').evaluate((n) => n.getAttribute('aria-orientation'))).toBe('vertical');
  }
  const selected = page.getByRole('tab', { name: 'Object', exact: true });
  const style = (): Promise<string> =>
    selected.evaluate((n) => {
      const s = getComputedStyle(n);
      return [s.backgroundColor, s.color, s.boxShadow].join('|');
    });
  await page.mouse.move(0, 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const unfocused = await style();
  await selected.focus();
  expect(await style()).toBe(unfocused);
});

test('Arrow keys move between the inspector tabs and Home and End go to the ends', async ({ page }) => {
  await openApp(page);
  const object = page.getByRole('tab', { name: 'Object', exact: true });
  await object.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Material', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Material', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('tab', { name: 'Material', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Render', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(object).toBeFocused();
});

test('ArrowUp in a position field commits once and one Undo restores it', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const panel = page.locator('#tabpanel-object');
  await expect(panel.getByLabel('Position X')).toHaveValue('0');
  await panel.getByLabel('Position X').focus();
  await page.keyboard.press('ArrowUp');
  await expect(panel.getByLabel('Position X')).toHaveValue('0.1');
  await expect(panel.getByLabel('Position X')).toBeFocused();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(panel.getByLabel('Position X')).toHaveValue('1.1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByLabel('Position X')).toHaveValue('0.1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByLabel('Position X')).toHaveValue('0');
});

test('a position that is not a number or out of range reverts and says so', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const x = page.locator('#tabpanel-object').getByLabel('Position X');
  await x.fill('abc');
  await x.press('Enter');
  await expect(x).toHaveValue('0');
  await expect(x).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#tabpanel-object').getByRole('status')).toContainText('Enter a number');
  await x.fill('1e9');
  await x.press('Enter');
  await expect(x).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('dragging an axis letter scrubs the value and one Undo restores the start', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const panel = page.locator('#tabpanel-object');
  const letter = panel.getByRole('group', { name: 'Position' }).locator('.xyz-axis').first();
  const box = (await letter.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, box.y + 6, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await panel.getByLabel('Position X').inputValue())).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByLabel('Position X')).toHaveValue('0');
});

test('the Object tab shows the scale from the file, read-only', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const scale = page.locator('#tabpanel-object').getByLabel('Scale X');
  await expect(scale).toHaveValue('1');
  await expect(scale).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#tabpanel-object')).toContainText('Scale is from the file');
});

test('sections open and close, and the choice is remembered across a reload', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const head = page.locator('#tabpanel-object').getByRole('button', { name: 'Transform', exact: true });
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#tabpanel-object').getByLabel('Position X')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('modelshot.sections.v1'))).toContain('object-transform');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect(
    page.locator('#tabpanel-object').getByRole('button', { name: 'Transform', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => localStorage.setItem('modelshot.sections.v1', '{not json'));
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect(
    page.locator('#tabpanel-object').getByRole('button', { name: 'Transform', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('a keyframe button in the Animation section moves the playhead there', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const keyframes = page.locator('#tabpanel-object').getByRole('button', { name: /^Go to / });
  await expect(keyframes.first()).toBeVisible();
  const count = await keyframes.count();
  const last = keyframes.nth(count - 1);
  const label = (await last.getAttribute('aria-label'))!;
  const time = Number(/Go to ([\d.]+) s/.exec(label)![1]);
  await last.click();
  await expect(page.locator('#timeline').getByRole('slider', { name: 'Playhead' })).toHaveValue(String(time), {
    timeout: 5000,
  });
});

test('the Material tab says what a group holds and selects an element from it', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await openTab(page, 'Material');
  const panel = page.locator('#tabpanel-material');
  await expect(panel).not.toContainText('Select an element to see its material');
  await expect(panel.getByRole('button', { name: /^Select / }).first()).toBeVisible();
  await panel
    .getByRole('button', { name: /^Select / })
    .first()
    .click();
  await expect(page.getByRole('tab', { name: 'Material', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('button', { name: 'Texture', exact: true })).toBeVisible();
  await expect(panel).toContainText('Alpha mode');
  await expect(panel).toContainText('Preview and render use the same values.');
  await expect(panel.getByRole('button', { name: 'Change in Look' })).toBeVisible();
  await panel.getByRole('button', { name: 'Change in Look' }).click();
  await expect(page.getByRole('tab', { name: 'Look', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('the texture thumbnail is drawn on a canvas and the page raises no policy violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="mesh:"]').first().click();
  await openTab(page, 'Material');
  const thumb = page.locator('#tabpanel-material canvas.texture-thumb').first();
  await expect(thumb).toBeVisible();
  await expect
    .poll(() =>
      thumb.evaluate((canvas) => {
        const c = canvas as HTMLCanvasElement;
        return c
          .getContext('2d')!
          .getImageData(0, 0, c.width, c.height)
          .data.some((v) => v !== 0);
      }),
    )
    .toBe(true);
  expect(violations).toEqual([]);
});

test('an element named like markup is shown as text in the title row and the Material tab', async ({ page }) => {
  await openNested(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  const name = page.locator('#tabpanel-object').getByLabel('Name', { exact: true });
  await name.fill('<img src=x onerror=window.__pwned=1>');
  await name.press('Enter');
  await expect(page.locator('.inspector-title h2')).toHaveText('<img src=x onerror=window.__pwned=1>');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwned'])).toBeUndefined();
  expect(await page.locator('.inspector-title img').count()).toBe(0);
});

const LOOK_IDS = ['studio', 'marketplace', 'rim', 'softbox'] as const;

test('the Look tab shows a card per look, and a card and the L key mark the same one', async ({ page }) => {
  await openNested(page);
  await openTab(page, 'Look');
  const cards = page.getByRole('radiogroup', { name: 'Look preset' }).getByRole('radio');
  await expect(cards).toHaveCount(LOOK_IDS.length);
  await expect(cards.first().locator('.look-swatch')).toBeVisible();
  expect(
    await cards
      .first()
      .locator('.look-swatch')
      .evaluate((n) => getComputedStyle(n).backgroundImage),
  ).toContain('gradient');
  await page.getByRole('radio', { name: 'Marketplace' }).click();
  await expect(page.getByRole('radio', { name: 'Marketplace' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('radio', { name: 'Marketplace' }).locator('svg')).toHaveCount(1);
  await page.locator('#preview').focus();
  await page.keyboard.press('l');
  await expect(page.getByRole('radio', { name: 'Rim' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Marketplace' })).toHaveAttribute('aria-checked', 'false');
  // Arrow keys move the choice and the focus together.
  await page.getByRole('radio', { name: 'Rim' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Softbox' })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Softbox' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Softbox' })).toHaveAttribute('tabindex', '0');
});

test('the Edges rows of the Material tab are the active look own values, for every look', async ({ page }) => {
  const presets = (id: string): { name: string; edges: { width: number; sharpAngleDeg: number } } =>
    JSON.parse(readFileSync(join(HERE, '..', '..', 'looks', 'src', 'presets', `${id}.json`), 'utf8')) as {
      name: string;
      edges: { width: number; sharpAngleDeg: number };
    };
  await openNested(page);
  await page.locator('#scene-panel [data-row^="mesh:"]').first().click();
  for (const id of LOOK_IDS) {
    const preset = presets(id);
    await openTab(page, 'Look');
    await page.getByRole('radio', { name: preset.name, exact: true }).click();
    await openTab(page, 'Material');
    const edges = page.locator('#tabpanel-material').locator('#section-material-edges');
    await expect(edges).toContainText(preset.edges.width.toFixed(2));
    await expect(edges).toContainText(`${preset.edges.sharpAngleDeg}°`);
    await expect(edges).toContainText(`From the ${preset.name} look.`);
  }
});

test('exposure moves with one Undo step per drag, changes the preview and starts no bake', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNested(page);
  await expectLit(page, 120_000);
  await openTab(page, 'Look');
  const slider = page.getByRole('slider', { name: 'Exposure' });
  await expect(slider).toHaveValue('0');
  const before = await previewImage(page);
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await expect(page.locator('#model-state')).toHaveAttribute('data-state', 'lit');
  await page.mouse.up();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(2);
  await expect.poll(async () => (await previewImage(page)).data.equals(before.data)).toBe(false);
  await expect(page.locator('#model-state')).toHaveAttribute('data-state', 'lit');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(slider).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Reset adjustments' }).click();
  await expect(slider).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Reset adjustments' })).toBeDisabled();
});

test('a backdrop colour is a flat colour behind the model and a look card drops it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNested(page);
  await expectLit(page, 120_000);
  await openTab(page, 'Look');
  const before = await previewImage(page);
  await page.locator('#backdrop-colour').fill('#ff0000');
  await expect(page.getByRole('radio', { name: 'Colour', exact: true })).toBeChecked();
  await expect.poll(async () => (await previewImage(page)).data.equals(before.data)).toBe(false);
  await page.getByRole('radio', { name: 'Scene', exact: true }).check({ force: true });
  await expect(page.getByRole('radio', { name: 'Scene', exact: true })).toBeChecked();
  await page.locator('#backdrop-colour').fill('#00ff00');
  await page.getByRole('radio', { name: 'Rim' }).click();
  await expect(page.getByRole('radio', { name: 'Scene', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Reset adjustments' })).toBeDisabled();
});

test('the Render tab offers sample chips, the output size and the estimate only after a render', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await waitForEditor(page);
  await openTab(page, 'Render');
  const panel = page.locator('#render-panel');
  const chip = (count: string): Locator => panel.getByRole('button', { name: `${count} per pixel` });
  await expect(chip('256')).toHaveAttribute('aria-pressed', 'true');
  await chip('64').click();
  await expect(chip('64')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('256')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByLabel('Samples', { exact: true })).toHaveValue('64');
  await expect(page.locator('#render-meta')).toContainText('64 samples');
  await expect(panel).toContainText('Render uses 256 samples by default for one still');
  await expect(panel).toContainText('Export uses 64 per frame because clips render many frames');
  await expect(panel.locator('#section-render-output')).toContainText(/\d+ × \d+ px, the size of the 3D view/);
  await expect(panel.locator('#section-render-output')).toContainText('No estimate before the first render.');
  await panel.getByLabel('Samples', { exact: true }).fill('4');
  await panel.getByLabel('Samples', { exact: true }).dispatchEvent('change');
  await expect(chip('64')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-renders', '1', { timeout: 180_000 });
  await expect(panel.locator('#section-render-output')).toContainText('estimated from your last render');
  await page.getByRole('radio', { name: 'Supersampling 2×' }).check({ force: true });
  await expect(panel.locator('#section-render-output')).toContainText('traced at');
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toContainText('Export uses 64 per frame');
});

test('the preset chips and the Camera section mark the same preset, an orbit clears both', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNested(page);
  await openTab(page, 'Render');
  const chips = page.locator('#camera-presets');
  const section = page.locator('#render-panel, #camera-panel');
  const sectionPreset = (label: string): Locator =>
    page.locator('#camera-panel').getByRole('button', { name: `${label} camera` });
  await expect(chips.getByRole('button', { name: 'Three-quarter view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionPreset('Three-quarter')).toHaveAttribute('aria-pressed', 'true');
  await chips.getByRole('button', { name: 'Front view' }).click();
  await expect(chips.getByRole('button', { name: 'Front view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionPreset('Front')).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionPreset('Three-quarter')).toHaveAttribute('aria-pressed', 'false');
  await sectionPreset('Isometric').click();
  await expect(chips.getByRole('button', { name: 'Isometric view' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#preview').focus();
  await page.keyboard.press('o');
  await expect(chips.getByRole('button', { name: 'Isometric view' })).toHaveAttribute('aria-pressed', 'false');
  await expect(sectionPreset('Isometric')).toHaveAttribute('aria-pressed', 'false');
  await chips.getByRole('button', { name: 'Side view' }).click();
  const box = (await page.locator('#viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  for (const label of ['Front', 'Side', 'Three-quarter', 'Isometric']) {
    await expect(chips.getByRole('button', { name: `${label} view` })).toHaveAttribute('aria-pressed', 'false');
    await expect(sectionPreset(label)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(section.first()).toBeVisible();
});
