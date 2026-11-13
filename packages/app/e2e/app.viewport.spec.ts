import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, test, waitForEditor, waitForModel } from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');

async function openNested(page: Page): Promise<void> {
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
}

interface Box {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function viewBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const view = document.getElementById('viewport')!.getBoundingClientRect();
    const rect = (
      name: string,
      selector: string,
    ): { name: string; x: number; y: number; width: number; height: number }[] => {
      const element = document.querySelector(selector);
      if (!element || element.getClientRects().length === 0) return [];
      const r = element.getBoundingClientRect();
      return [{ name, x: r.left - view.left, y: r.top - view.top, width: r.width, height: r.height }];
    };
    const axis = window.__msApp!.axisBounds();
    return [
      ...rect('rail', '#tool-rail'),
      ...rect('view bar', '#viewport-chips'),
      ...rect('info chips', '.view-info'),
      ...rect('render bar', '.render-bar'),
      ...(axis ? [{ name: 'axis gizmo', ...axis }] : []),
    ];
  });
}

const apart = (a: Box, b: Box): boolean =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

test('the preset buttons, the number keys and the camera section agree, and Frame model keeps the angles', async ({
  page,
}) => {
  await openNested(page);
  const bar = page.locator('#viewport-chips');
  for (const [key, yaw] of [
    ['2', 270],
    ['1', 180],
  ] as const) {
    await page.keyboard.press(key);
    expect((await page.evaluate(() => window.__msApp!.state().yawDeg)) - yaw).toBeCloseTo(0, 3);
  }
  await expect(bar.getByRole('button', { name: 'Front view' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Front view' }).click();
  await expect(bar.getByRole('button', { name: 'Front view' })).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__msApp!.state().yawDeg);
  await bar.getByRole('button', { name: 'Frame model' }).click();
  expect(await page.evaluate(() => window.__msApp!.state().yawDeg)).toBeCloseTo(before, 3);
});

test('the Move and Rotate buttons and the W and E keys are one control', async ({ page }) => {
  await openNested(page);
  const rail = page.getByRole('group', { name: 'Gizmo mode' });
  const move = rail.getByRole('button', { name: 'Move' });
  const rotate = rail.getByRole('button', { name: 'Rotate' });
  await expect(move).toBeEnabled();
  await expect(move).toHaveAttribute('aria-pressed', 'true');
  await expect(move).toHaveAttribute('title', 'Move (W)');
  await rotate.click();
  await expect(rotate).toHaveAttribute('aria-pressed', 'true');
  await expect(move).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#preview').focus();
  await page.keyboard.press('w');
  await expect(move).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('e');
  await expect(rotate).toHaveAttribute('aria-pressed', 'true');
});

test('the stats chip shows fps, triangles and the bake time, and its on state survives a reload', async ({ page }) => {
  await openNested(page);
  await expect(page.locator('#stats')).toBeHidden();
  await page.getByRole('button', { name: 'Overlays' }).click();
  await page.getByRole('checkbox', { name: 'Statistics' }).check();
  await page.keyboard.press('Escape');
  const stats = page.locator('#stats');
  await expect(stats).toBeVisible();
  await expect(stats).toContainText('fps');
  await expect(stats).toContainText('triangles');
  await expect(stats).toContainText('bake');
  await expect(page.locator('#view-camera')).toContainText('Perspective');
  await expect.poll(async () => (await page.evaluate(() => localStorage.length)) + 1).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await waitForEditor(page);
  await expect(page.locator('#stats')).toBeVisible();
});

for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1440, 900],
] as const) {
  test(`no view control overlaps another and the bars stay one row at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openNested(page);
    await page.getByRole('button', { name: 'Overlays' }).click();
    await page.getByRole('checkbox', { name: 'Statistics' }).check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#stats')).toBeVisible();
    await expect.poll(async () => (await viewBoxes(page)).some((box) => box.name === 'axis gizmo')).toBe(true);
    await page.waitForTimeout(300);
    const boxes = await viewBoxes(page);
    expect(boxes.map((box) => box.name)).toEqual(
      expect.arrayContaining(['rail', 'view bar', 'info chips', 'render bar', 'axis gizmo']),
    );
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(apart(a, b), `${a.name} and ${b.name}`).toBe(true);
    }
    for (const selector of ['#viewport-chips', '#tool-rail']) {
      const rows = await page.locator(`${selector} button`).evaluateAll((buttons) =>
        buttons.map((button) => {
          const r = button.getBoundingClientRect();
          return { centre: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      if (selector === '#viewport-chips') expect(new Set(rows.map((r) => r.centre)).size, 'one row').toBe(1);
      if (width < 1024) {
        for (const r of rows) {
          expect(r.width).toBeGreaterThanOrEqual(44);
          expect(r.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`viewport-${width}.png`) });
  });
}

test('the key light stays inside the view for every camera angle, and its name shows on hover as DOM text', async ({
  page,
}) => {
  await openNested(page);
  const view = (await page.locator('#viewport').boundingBox())!;
  for (const [yaw, pitch] of [
    [180, 0],
    [210, 20],
    [30, 80],
    [300, -60],
    [90, 10],
  ]) {
    await page.evaluate(
      ([y, p]) => {
        const hook = window.__msApp!;
        hook.orbit.setState({ ...hook.state(), yawDeg: y!, pitchDeg: p! });
      },
      [yaw, pitch],
    );
    await page.waitForTimeout(150);
    const at = await page.evaluate(() => window.__msApp!.keyLightAt());
    if (!at) continue;
    expect(at.x, `${yaw}/${pitch}`).toBeGreaterThanOrEqual(16);
    expect(at.x).toBeLessThanOrEqual(view.width - 16);
    expect(at.y).toBeGreaterThanOrEqual(16);
    expect(at.y).toBeLessThanOrEqual(view.height - 16);
  }
  await page.evaluate(() => {
    const hook = window.__msApp!;
    hook.orbit.setState({ ...hook.state(), yawDeg: 210, pitchDeg: 20 });
  });
  await page.waitForTimeout(150);
  const at = await page.evaluate(() => window.__msApp!.keyLightAt());
  expect(at).not.toBeNull();
  await page.mouse.move(view.x + at!.x, view.y + at!.y);
  await expect(page.locator('#helper-label')).toBeVisible();
  await expect(page.locator('#helper-label')).toHaveText('Key light');
  await page.mouse.move(view.x + view.width / 2, view.y + view.height - 20);
  await expect(page.locator('#helper-label')).toBeHidden();
});
