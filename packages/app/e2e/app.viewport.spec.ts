import type { Page } from '@playwright/test';
import { expect, expectLit, fixture, openApp, openFiles, test, waitForEditor, waitForModel } from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');

// The one-time hint row is part of the view's layout: every spec here has it on show.
test.use({ firstRunHint: true });

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
      ...rect('hint row', '#first-run-hint'),
      ...rect('render bar', '.render-bar'),
      ...(axis ? [{ name: 'axis gizmo', ...axis }] : []),
    ];
  });
}

const apart = (a: Box, b: Box): boolean =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

// Two animation frames: what was set before is drawn after (a frame count, not a time).
const drawn = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

const touching = (boxes: Box[]): string[] =>
  boxes.flatMap((a, i) => boxes.slice(i + 1).flatMap((b) => (apart(a, b) ? [] : [`${a.name} and ${b.name}`])));

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
  // Two bakes, each allowed 120 s on a loaded machine.
  test.setTimeout(300_000);
  await openNested(page);
  await expect(page.locator('#stats')).toBeHidden();
  await page.getByRole('button', { name: 'Overlays' }).click();
  await page.getByRole('checkbox', { name: 'Statistics' }).check();
  await page.keyboard.press('Escape');
  const stats = page.locator('#stats');
  await expect(stats).toBeVisible();
  await expect(stats).toContainText('fps');
  await expect(stats).toContainText('triangles');
  // The first model's bake ran before the editor tools loaded: its time is a number, not "bake -".
  await expectLit(page, 120_000);
  await expect(stats).toHaveText(/bake \d+ ms/);
  await expect(page.locator('#view-camera')).toContainText('Perspective');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = localStorage.getItem('modelshot.layout.v1');
        return saved === null ? false : (JSON.parse(saved) as { overlays: { stats: boolean } }).overlays.stats;
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await waitForEditor(page);
  await expect(page.locator('#stats')).toBeVisible();
  await expectLit(page, 120_000);
  await expect(page.locator('#stats')).toHaveText(/bake \d+ ms/);
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
    // The axis gizmo is placed from measured boxes after the first frame: wait for that, not for a time.
    await expect
      .poll(async () => {
        const found = await viewBoxes(page);
        return found.some((box) => box.name === 'axis gizmo') ? touching(found) : ['no axis gizmo yet'];
      })
      .toEqual([]);
    const boxes = await viewBoxes(page);
    expect(boxes.map((box) => box.name)).toEqual(
      expect.arrayContaining(['rail', 'view bar', 'info chips', 'hint row', 'render bar', 'axis gizmo']),
    );
    expect(touching(boxes)).toEqual([]);
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
  const anchor = (): Promise<string> => page.evaluate(() => JSON.stringify(window.__msApp!.keyLightAt()));
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
    // The overlay draws with the next frame; two animation frames on, the helper stands where the camera put it.
    await drawn(page);
    const at = JSON.parse(await anchor()) as { x: number; y: number };
    expect(at, `${yaw}/${pitch}`).not.toBeNull();
    expect(at.x, `${yaw}/${pitch}`).toBeGreaterThanOrEqual(16);
    expect(at.x).toBeLessThanOrEqual(view.width - 16);
    expect(at.y).toBeGreaterThanOrEqual(16);
    expect(at.y).toBeLessThanOrEqual(view.height - 16);
  }
  await page.evaluate(() => {
    const hook = window.__msApp!;
    hook.orbit.setState({ ...hook.state(), yawDeg: 210, pitchDeg: 20 });
  });
  await drawn(page);
  const at = await page.evaluate(() => window.__msApp!.keyLightAt());
  expect(at).not.toBeNull();
  await page.mouse.move(view.x + at!.x, view.y + at!.y);
  await expect(page.locator('#helper-label')).toBeVisible();
  await expect(page.locator('#helper-label')).toHaveText('Key light');
  await page.mouse.move(view.x + view.width / 2, view.y + view.height - 20);
  await expect(page.locator('#helper-label')).toBeHidden();
});
