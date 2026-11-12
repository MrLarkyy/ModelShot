import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { dragFiles, expect, fixture, openApp, openFileMenu, openFiles, openTab, test, waitForEditor } from './appTest';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// `covered`: a popup or drawer is open over the view, so the chips under it are not targets of the moment (they are scanned
// uncovered in every other test).
async function violations(page: Page, covered = false): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (covered) builder.exclude('#viewport-chips');
  const result = await builder.analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

// The scans read settled colours: a tab panel or drawer caught mid fade-in has its text at partial opacity and fails
// contrast at random. Motion itself is covered by app.motion.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('axe finds no WCAG A/AA violation on the empty app', async ({ page }) => {
  await openApp(page);
  expect(await violations(page)).toEqual([]);
});

test('axe finds no violation with a model open, with an error shown and in the dialogs', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  expect(await violations(page)).toEqual([]);
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'x.bbmodel', mimeType: 'application/json', buffer: Buffer.from('x') });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await openFileMenu(page);
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('axe finds no violation in any inspector tab of an animated model with a node selected', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  for (const tab of ['Object', 'Material', 'Light', 'Look', 'Render'] as const) {
    await openTab(page, tab);
    expect(await violations(page), tab).toEqual([]);
  }
  // The timeline with a pose on show: the playhead moved, the clip playing.
  await page.locator('#timeline').getByRole('slider', { name: 'Playhead' }).fill('0.5');
  expect(await violations(page), 'scrubbed').toEqual([]);
  await page.locator('#timeline').getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#timeline').getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(await violations(page), 'playing').toEqual([]);
});

test('axe finds no violation in any inspector tab at 1024 px and with the rail at its narrowest and widest', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  for (const key of ['Home', 'End']) {
    await page.getByRole('separator', { name: 'Resize the inspector' }).focus();
    await page.keyboard.press(key);
    for (const tab of ['Object', 'Material', 'Light'] as const) {
      await openTab(page, tab);
      expect(await violations(page), `${tab} with the inspector at ${key}`).toEqual([]);
    }
  }
});

test('axe finds no violation with the File, Add and Overlays menus open', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await waitForEditor(page);
  for (const [name, id] of [
    ['File', 'file-menu-button'],
    ['Add', 'add-menu-button'],
    ['Overlays', 'overlay-menu-button'],
  ] as const) {
    const button = page.locator(`#${id}`);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await violations(page, true), name).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
});

test('axe finds no violation at 900 px with the outliner and the inspector drawer open', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await waitForEditor(page);
  expect(await violations(page), 'closed').toEqual([]);
  for (const name of ['Outliner', 'Inspector']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator(`#${name.toLowerCase()}`)).toBeVisible();
    // The drawer slides in: the colours are checked once it stands still.
    await page.waitForTimeout(400);
    expect(await violations(page, true), name).toEqual([]);
  }
});

async function walk(page: Page, reached: Map<string, boolean>, presses = 90): Promise<void> {
  await page.locator('.skip-link').focus();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as (HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }) | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const name =
        element.getAttribute('aria-label') ??
        element.labels?.[0]?.textContent?.trim() ??
        element.textContent?.trim() ??
        '';
      return {
        name: name.replace(/\s+/g, ' '),
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
      };
    });
    if (!focus) continue;
    expect(focus.name, 'a focused control has a name').not.toBe('');
    reached.set(focus.name, (reached.get(focus.name) ?? true) && focus.outline);
  }
}

test('every control can be reached with Tab, has a name and shows where the focus is', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  const reached = new Map<string, boolean>();
  for (const tab of ['Object', 'Material', 'Light', 'Look', 'Render'] as const) {
    await openTab(page, tab);
    await walk(page, reached);
  }
  // The menu closes when the focus leaves it, so it is walked from its own button.
  await page.getByRole('button', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    reached.set(name, true);
  }
  for (const name of [
    'Skip to the 3D view',
    'Outliner',
    'Inspector',
    'Timeline',
    'File',
    'Render',
    'Export…',
    'Search the outliner',
    'Resize the outliner',
    'Resize the inspector',
    '3D view of the model',
    'Front view',
    'Isometric view',
    'Overlays',
    'Object',
    'Material',
    'Look',
    'Studio',
    'Field of view',
    'Perspective',
    'Frame the model',
    'Reset the view',
    'Samples',
    'Supersampling',
    'Denoise',
    'Open…',
    'Shortcuts',
    'Forget local data',
  ]) {
    expect(
      [...reached.keys()].some((key) => key.includes(name)),
      `${name} is reachable by Tab`,
    ).toBe(true);
  }
  expect([...reached.entries()].filter(([, visible]) => !visible).map(([name]) => name)).toEqual([]);
});

test('the export dialog keeps the focus inside while it is open and returns it on close', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await page.getByRole('button', { name: 'Export…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    // The page behind a modal dialog is inert: focus is in the dialog, or has left the page for the browser's own UI.
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return active === null || active === document.body || active.closest('dialog') !== null;
      }),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export…' })).toBeFocused();
});

test('the shortcuts work from the keyboard and never override the view keys', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await openTab(page, 'Look');
  await expect(page.getByRole('radio', { name: 'Marketplace' })).toBeChecked();
  await page.locator('#preview').focus();
  await page.keyboard.press('o');
  expect(await page.evaluate(() => window.__msApp!.state().projection)).toBe('orthographic');
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4096');
  await samples.dispatchEvent('change');
  // Held before its first sample: the shortcut is what is checked, and a cancelled long render leaves queued GPU work.
  await page.evaluate(() => window.__msApp!.holdRenders());
  await page.locator('#preview').focus();
  await page.keyboard.press('r');
  await expect(page.getByRole('status')).toContainText('Rendering', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toContainText('Render cancelled', { timeout: 30_000 });
});

test('a render that cannot get a graphics context says it failed and can be started again', async ({ page }) => {
  await page.addInitScript(() => {
    type GetContext = (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
    const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as GetContext;
    Reflect.set(HTMLCanvasElement.prototype, 'getContext', function (this: HTMLCanvasElement, ...args: unknown[]) {
      return this.id === 'result' ? null : original.apply(this, args);
    });
  });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await page.locator('#preview').focus();
  await page.keyboard.press('r');
  await expect(page.getByRole('status')).toContainText('Render failed.', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toContainText('The render failed');
  await expect(page.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
});

test('typing in a field does not trigger a shortcut', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.focus();
  await page.keyboard.type('r1l');
  await expect(page.getByRole('status')).not.toContainText('Rendering');
  await openTab(page, 'Look');
  await expect(page.getByRole('radio', { name: 'Studio' })).toBeChecked();
});

test('a reduced-motion setting turns the view damping off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  expect(await page.evaluate(() => window.__msApp!.orbit.damping)).toBe(false);
});

test('axe finds no violation with a toast, the File menu, the forget dialog and More open', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await expect(page.getByRole('status')).toHaveClass(/toast-shown/);
  expect(await violations(page), 'toast').toEqual([]);
  await openFileMenu(page);
  expect(await violations(page, true), 'file menu').toEqual([]);
  await page.getByRole('button', { name: 'Forget local data' }).click();
  await expect(page.getByRole('dialog', { name: 'Forget local data?' })).toBeVisible();
  expect(await violations(page), 'forget dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  expect(await violations(page, true), 'More at 375 px').toEqual([]);
});

test('the status line is one role=status and an error stays in role=alert until it is dismissed', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'x.bbmodel', mimeType: 'application/json', buffer: Buffer.from('x') });
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await page.getByRole('status').evaluate((n) => n.classList.remove('toast-shown'));
  await expect(alert).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(1);
  expect(await violations(page), 'alert with dismiss').toEqual([]);
  await page.getByRole('button', { name: 'Dismiss the error' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
});

for (const [width, height] of [
  [1440, 900],
  [375, 667],
] as const) {
  test(`axe finds no violation on the empty state at ${width} px, in the drag state and with the error`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    expect(await violations(page), 'empty').toEqual([]);
    await dragFiles(page, 'enter', [{ name: 'a.bbmodel', text: '{}' }]);
    await expect(page.locator('#empty')).toHaveAttribute('data-drag', '');
    expect(await violations(page), 'drag over').toEqual([]);
    await dragFiles(page, 'drop', [{ name: 'notes.txt', text: 'hello' }]);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await violations(page), 'error').toEqual([]);
  });
}

test.describe('first run hint', () => {
  test.use({ firstRunHint: true });

  test('axe finds no violation with the shortcut hint row', async ({ page }) => {
    await openApp(page);
    await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
    await expect(page.getByRole('region', { name: 'Shortcut hints' })).toBeVisible();
    expect(await violations(page, true)).toEqual([]);
  });
});
