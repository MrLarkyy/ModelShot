import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, openTab, test, waitForEditor, waitForStored } from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function openNested(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  await waitForEditor(page);
}

const item = (page: Page, name: string): Locator =>
  page.locator('#scene-panel [role="treeitem"]', { has: page.locator('[data-row]', { hasText: name }) }).first();

test('the outliner is a tree with levels, a footer of counts and named icon buttons', async ({ page }) => {
  await openNested(page);
  const tree = page.getByRole('tree', { name: 'Nodes and elements' });
  await expect(tree).toBeVisible();
  await expect(item(page, 'body')).toHaveAttribute('aria-level', '1');
  await expect(item(page, 'torso')).toHaveAttribute('aria-level', '2');
  await expect(item(page, 'skull')).toHaveAttribute('aria-level', '4');
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'hips')).not.toHaveAttribute('aria-expanded', /.*/);
  await expect(page.locator('#scene-panel .outliner-footer')).toHaveText(/\d+ nodes? · \d+ cubes? · 0 clips/);
  const eye = page.getByRole('button', { name: 'Hide hips' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(page.getByRole('button', { name: 'Hide hips' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Hide hips' }).locator('svg')).toHaveAttribute('data-icon', 'eye-off');
  const lock = page.getByRole('button', { name: 'Lock hips' });
  await lock.click();
  await expect(page.getByRole('button', { name: 'Lock hips' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Lock hips' }).locator('svg')).toHaveAttribute('data-icon', 'lock');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Lock hips' })).toHaveAttribute('aria-pressed', 'false');
});

test('arrow keys walk the tree, open and close groups, select and rename', async ({ page }) => {
  await openNested(page);
  await item(page, 'body').focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'torso')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'torso')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'chest')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'body')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'body')).toBeFocused();
  await expect(item(page, 'torso')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'torso')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#scene-panel [role="treeitem"]').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, 'body')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(item(page, 'body')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#scene-panel [aria-current="true"]')).toHaveText('body');
  await page.keyboard.press('F2');
  const input = page.locator('#scene-panel input[type="text"]');
  await expect(input).toBeFocused();
  await input.fill('torso-root');
  await page.keyboard.press('Enter');
  await expect(item(page, 'torso-root')).toBeFocused();
  // One tab stop: Tab from the tree leaves a row's buttons for the next control, never through every row.
  const stops = await page
    .locator('#scene-panel [role="treeitem"], #scene-panel .outliner-row button')
    .evaluateAll((nodes) => nodes.filter((n) => (n as HTMLElement).tabIndex >= 0).length);
  expect(stops).toBeLessThanOrEqual(4);
});

// How far the focus ring of the focused element (outline width plus offset around its box) stays inside every ancestor
// that clips its paint: negative is the part of the ring that is cut off.
const ringSlack = (page: Page): Promise<{ what: string; ring: string; slack: number }> =>
  page.evaluate(() => {
    const focused = document.activeElement as HTMLElement;
    const style = getComputedStyle(focused);
    const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const box = focused.getBoundingClientRect();
    let slack = Number.POSITIVE_INFINITY;
    for (let above = focused.parentElement; above; above = above.parentElement) {
      const s = getComputedStyle(above);
      const clips =
        s.overflowX !== 'visible' ||
        s.overflowY !== 'visible' ||
        s.contentVisibility !== 'visible' ||
        /paint|strict|content/.test(s.contain);
      if (!clips) continue;
      const clip = above.getBoundingClientRect();
      slack = Math.min(
        slack,
        box.left - reach - clip.left,
        box.top - reach - clip.top,
        clip.right - (box.right + reach),
        clip.bottom - (box.bottom + reach),
      );
    }
    return {
      what: `${focused.tagName.toLowerCase()}.${focused.className} ${focused.getAttribute('aria-label') ?? ''}`.trim(),
      ring: `${style.outlineStyle} ${style.outlineWidth}`,
      slack,
    };
  });

test('the focus ring of a row and of each of its controls is drawn whole, inside what clips the row', async ({
  page,
}) => {
  await openNested(page);
  const whole = async (what: RegExp): Promise<void> => {
    const ring = await ringSlack(page);
    expect(ring.what).toMatch(what);
    expect(ring.ring, `${ring.what} shows a ring`).toBe('solid 3px');
    expect(ring.slack, `${ring.what}: ring cut off by ${-ring.slack} px`).toBeGreaterThanOrEqual(0);
  };
  await item(page, 'body').focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'torso')).toBeFocused();
  await whole(/^li/);
  await page.keyboard.press('Tab');
  await whole(/Collapse torso/);
  await page.keyboard.press('Tab');
  await whole(/Hide torso/);
  await page.keyboard.press('Tab');
  await whole(/Lock torso/);
  // The name button is no tab stop: a script gives it the focus, and after keys the browser rings it.
  await item(page, 'torso').locator('button.name').focus();
  await whole(/^button\.name/);
  await page.keyboard.press('F2');
  await expect(page.locator('#scene-panel input[type="text"]')).toBeFocused();
  await whole(/^input/);
  // The last row of the list, where a ring has the least room below it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await whole(/^li/);
  await page.keyboard.press('Tab');
  await whole(/^button/);
});

test('a collapsed group stays collapsed through Undo and a reload, and the search and selection stay too', async ({
  page,
}) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Collapse torso' }).click();
  await expect(item(page, 'chest')).toHaveCount(0);
  await expect(item(page, 'torso')).toHaveAttribute('aria-expanded', 'false');
  await waitForStored(page, (record) => JSON.stringify(record['collapsedNodes']) !== undefined);
  await item(page, 'cape').locator('[data-row]').click();
  await page.getByRole('button', { name: 'Hide hips' }).click();
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('cl');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search the outliner' })).toHaveValue('cl');
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('');
  await expect(page.getByRole('button', { name: 'Hide hips' })).toHaveAttribute('aria-pressed', 'false');
  await expect(item(page, 'torso')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'chest')).toHaveCount(0);
  await expect(item(page, 'cape')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await expect(item(page, 'torso')).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'More outliner actions' }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(item(page, 'chest')).toBeVisible();
  await page.getByRole('button', { name: 'More outliner actions' }).click();
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(item(page, 'hips')).toHaveCount(0);
  await expect(item(page, 'body')).toBeVisible();
});

test('a search opens the groups above a match without changing what is stored, and marks the match as text', async ({
  page,
}) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Collapse body' }).click();
  await expect(item(page, 'hips')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('SKU');
  await expect(item(page, 'skull')).toBeVisible();
  await expect(item(page, 'skull').locator('mark')).toHaveText('sku');
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('');
  await expect(item(page, 'hips')).toHaveCount(0);
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'false');
});

test('a name that looks like markup is shown as text and a search mark never makes elements', async ({ page }) => {
  await openNested(page);
  await item(page, 'body').locator('[data-row]').dblclick();
  const input = page.locator('#scene-panel input[type="text"]');
  await input.fill('<img src=x onerror=window.__pwned=1>');
  await page.keyboard.press('Enter');
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('img');
  await expect(page.locator('#scene-panel mark').first()).toHaveText('img');
  expect(await page.locator('#scene-panel img').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwned'])).toBeUndefined();
});

test('the / key focuses the search except while typing, and H hides the selected row', async ({ page }) => {
  await openNested(page);
  await item(page, 'hips').locator('[data-row]').click();
  await page.locator('#preview').focus();
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search the outliner' });
  await expect(search).toBeFocused();
  await page.keyboard.type('a/b');
  await expect(search).toHaveValue('a/b');
  await search.fill('');
  await item(page, 'hips').focus();
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Hide hips' })).toHaveAttribute('aria-pressed', 'true');
});

test('the outliner and its lights group pass axe, and hidden or locked state shows in forced colours', async ({
  page,
}) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Hide hips' }).click();
  await page.getByRole('button', { name: 'Lock chest' }).click();
  await item(page, 'torso').locator('[data-row]').click();
  const result = await new AxeBuilder({ page }).withTags(TAGS).include('#outliner').analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  await expect(page.locator('#scene-panel .outliner-lights').getByRole('button', { name: 'Key light' })).toBeVisible();
  await page.emulateMedia({ forcedColors: 'active' });
  const cue = (name: string): Promise<string> =>
    page.getByRole('button', { name }).evaluate((n) => {
      const s = getComputedStyle(n);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.opacity}`;
    });
  expect(await cue('Hide hips')).not.toBe(await cue('Hide chest'));
  expect(await cue('Lock chest')).not.toBe(await cue('Lock hips'));
});

test('a selection inside a closed group marks the group, and H and F2 still act on it', async ({ page }) => {
  await openNested(page);
  await item(page, 'body').locator('[data-row]').click();
  await page.getByRole('button', { name: 'Collapse body' }).click();
  await openTab(page, 'Material');
  const panel = page.locator('#tabpanel-material');
  await panel.getByRole('button', { name: 'Select hips' }).click();
  await expect(panel.getByRole('button', { name: 'Texture', exact: true })).toBeFocused();
  await expect(item(page, 'hips')).toHaveCount(0);
  await expect(item(page, 'body').locator('.outliner-row')).toHaveClass(/has-selection/);
  await page.locator('#preview').focus();
  await page.keyboard.press('h');
  await page.getByRole('button', { name: 'More outliner actions' }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByRole('button', { name: 'Hide hips' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Collapse body' }).click();
  await expect(item(page, 'hips')).toHaveCount(0);
  await page.locator('#preview').focus();
  await page.keyboard.press('F2');
  await expect(page.locator('#scene-panel input[type="text"]')).toBeFocused();
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'true');
});

test('a row is named for its label, a search leaves the chevrons inert and the footer counts cubes', async ({
  page,
}) => {
  await openNested(page);
  await expect(item(page, 'hips')).toHaveAttribute('aria-label', 'hips');
  await expect(page.locator('#scene-panel .outliner-footer')).toHaveText(/5 cubes/);
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('sku');
  const chevron = page.getByRole('button', { name: 'Collapse body' });
  await expect(chevron).toHaveAttribute('aria-disabled', 'true');
  await chevron.click({ force: true });
  await item(page, 'torso').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'skull')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search the outliner' }).fill('');
  await expect(item(page, 'body')).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'torso')).toHaveAttribute('aria-expanded', 'true');
});

test('a light button keeps the focus through the rebuild a look change causes', async ({ page }) => {
  await openNested(page);
  const key = page.locator('#scene-panel .outliner-lights').getByRole('button', { name: 'Key light' });
  await key.focus();
  await page.keyboard.press('l');
  await expect(key).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#scene-panel .outliner-lights').getByRole('button', { name: 'Key light' })).toBeFocused();
});

// A model of 1950 rows: 50 groups of 19 sub-groups, each holding one cube (1000 nodes, 950 cubes).
function bigModel(): Buffer {
  const elements: unknown[] = [];
  const outliner: unknown[] = [];
  let id = 0;
  for (let g = 0; g < 50; g++) {
    const children: unknown[] = [];
    for (let s = 0; s < 19; s++) {
      const uuid = `c-${id++}`;
      elements.push({
        name: `cube ${uuid}`,
        from: [g, s, 0],
        to: [g + 1, s + 1, 1],
        origin: [g, s, 0],
        faces: { north: { uv: [0, 0, 1, 1], texture: false } },
        type: 'cube',
        uuid,
      });
      children.push({ name: `part ${g}-${s}`, origin: [0, 0, 0], uuid: `g-${g}-${s}`, children: [uuid] });
    }
    outliner.push({ name: `group ${g}`, origin: [0, 0, 0], uuid: `g-${g}`, children });
  }
  return Buffer.from(
    JSON.stringify({
      meta: { format_version: '4.9', model_format: 'bedrock', box_uv: false },
      name: 'big',
      resolution: { width: 16, height: 16 },
      elements,
      outliner,
    }),
  );
}

test('a model of 1000 nodes lists the first 500 rows, says how many are left out and counts its cubes', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'big.bbmodel', mimeType: 'application/json', buffer: bigModel() });
  await expect(page.getByRole('status')).toContainText('Opened big.bbmodel', { timeout: 120_000 });
  await waitForEditor(page);
  await expect(page.locator('#scene-panel')).toContainText(/Showing 500 of \d+/);
  await expect(page.locator('#scene-panel [role="treeitem"]')).toHaveCount(500);
  await expect(page.locator('#scene-panel .outliner-footer')).toHaveText(/1000 nodes · 950 cubes/);
});
