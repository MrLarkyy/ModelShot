import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, test } from './appTest';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

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
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('every control can be reached with Tab, has a name and shows where the focus is', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  const reached = new Map<string, boolean>();
  for (let i = 0; i < 80; i++) {
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
    reached.set(focus.name, focus.outline);
  }
  for (const name of [
    'Skip to the 3D view',
    'Open…',
    'Render',
    'Export…',
    'Shortcuts',
    '3D view of the model',
    'Studio',
    'Field of view',
    'Perspective',
    'Frame the model',
    'Reset the view',
    'Front view',
    'Isometric view',
    'Samples',
    'Supersampling',
    'Denoise',
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
  await expect(page.getByRole('radio', { name: 'Marketplace' })).toBeChecked();
  await page.locator('#preview').focus();
  await page.keyboard.press('o');
  expect(await page.evaluate(() => window.__msApp!.state().projection)).toBe('orthographic');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4096');
  await samples.dispatchEvent('change');
  await page.locator('#preview').focus();
  await page.keyboard.press('r');
  await expect(page.getByRole('status')).toContainText('Rendering', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toContainText('Render cancelled', { timeout: 30_000 });
});

test('a render that cannot get a graphics context says it failed and can be started again', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (this.id === 'result') return null;
      return (original as (...a: unknown[]) => RenderingContext | null).apply(this, args);
    } as typeof original;
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
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.focus();
  await page.keyboard.type('r1l');
  await expect(page.getByRole('status')).not.toContainText('Rendering');
  await expect(page.getByRole('radio', { name: 'Studio' })).toBeChecked();
});

test('a reduced-motion setting turns the view damping off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  expect(await page.evaluate(() => window.__msApp!.orbit.damping)).toBe(false);
});
