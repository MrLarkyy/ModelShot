import { expect, fixture, openApp, openFiles, previewImage, test, waitForModel } from './appTest';

test('opens a glTF with its buffer and texture', async ({ page }) => {
  await openApp(page);
  await openFiles(
    page,
    [fixture('gltf', 'external.gltf'), fixture('gltf', 'external.bin'), fixture('gltf', 'external.png')],
    'external.gltf',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await waitForModel(page);
});

test('opens a glTF without its buffer and says which file is missing', async ({ page }) => {
  await openApp(page);
  await page.locator('#file-input').setInputFiles([fixture('gltf', 'external.gltf')]);
  await expect(page.getByRole('alert')).toContainText('external.gltf', { timeout: 15_000 });
});

test('opens an OBJ with its material library and texture', async ({ page }) => {
  await openApp(page);
  await openFiles(
    page,
    [fixture('obj', 'shapes.obj'), fixture('obj', 'shapes.mtl'), fixture('obj', 'shapes.png')],
    'shapes.obj',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await waitForModel(page);
});

test('opens a skin PNG as a player model with an arms choice', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('skins', 'skin-classic.png')], 'skin-classic.png');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const classic = await waitForModel(page);
  await page.getByRole('radio', { name: 'Slim (3 px)' }).check();
  await expect(page.getByRole('status')).toContainText('Opened skin-classic.png');
  await page.waitForTimeout(500);
  const slim = await previewImage(page);
  expect(slim.width).toBe(classic.width);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Slim (3 px)' })).toBeChecked();
});

test('opens a legacy 64 x 32 skin', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('skins', 'skin-legacy.png')], 'skin-legacy.png');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('hides and shows a node from the scene panel', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  const before = await waitForModel(page);
  const boxes = page.locator('#scene-panel input[type="checkbox"]');
  expect(await boxes.count()).toBeGreaterThan(1);
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).uncheck();
  await page.waitForTimeout(500);
  const hidden = await previewImage(page);
  let differing = 0;
  for (let i = 0; i < before.data.length; i += 4) if (before.data[i] !== hidden.data[i]) differing++;
  expect(differing).toBeGreaterThan(100);
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
});
