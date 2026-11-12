import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { dragFiles, expect, fixture, openApp, openFileMenu, openFiles, openTab, test, waitForEditor } from './appTest';

const SHOT_BLUE = 'rgb(47, 75, 255)';
const BLUE_HOVER = 'rgb(26, 51, 214)';
const BLUE_LIGHT = 'rgb(140, 155, 255)';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface ButtonLook {
  readonly name: string;
  readonly primary: boolean;
  readonly background: string;
}

async function visibleButtons(page: Page): Promise<ButtonLook[]> {
  await page.mouse.move(0, 0);
  return page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden')
      .map((b) => ({
        name: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim(),
        primary: b.classList.contains('primary'),
        background: getComputedStyle(b).backgroundColor,
      })),
  );
}

function expectOnlyPrimariesBlue(buttons: ButtonLook[], where: string): void {
  expect(buttons.length, where).toBeGreaterThan(0);
  for (const b of buttons) {
    const blue = b.background === SHOT_BLUE || b.background === BLUE_HOVER;
    expect(blue, `${where}: ${b.name} is blue only when primary`).toBe(b.primary);
  }
}

async function showSpecimen(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await openApp(page);
  await page.evaluate(() => window.__msApp!.showSpecimen());
  await expect(page.locator('#specimen')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('no button is blue unless it is primary; Export and Render are the only primaries on the screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  expectOnlyPrimariesBlue(await visibleButtons(page), 'empty app');
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  for (const tab of ['Object', 'Material', 'Light', 'Look', 'Render'] as const) {
    await openTab(page, tab);
    expectOnlyPrimariesBlue(await visibleButtons(page), tab);
  }
  const main = (await visibleButtons(page)).filter((b) => b.primary).map((b) => b.name);
  expect(main).toEqual(['Export…', 'Render']);
  await openFileMenu(page);
  expectOnlyPrimariesBlue(await visibleButtons(page), 'File menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export…' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  const inDialog = await dialog
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((b) => ({ name: b.textContent?.trim() ?? '', primary: b.classList.contains('primary') })),
    );
  expect(inDialog.filter((b) => b.primary).map((b) => b.name)).toEqual(['Export']);
  expectOnlyPrimariesBlue(await visibleButtons(page), 'export dialog');
});

test('elements with the hidden attribute stay hidden', async ({ page }) => {
  await openApp(page);
  for (const selector of ['#share-button', '#render-progress', '#file-menu', '#add-menu', '#overlay-menu']) {
    await expect(page.locator(selector), selector).toBeHidden();
  }
});

for (const [width, height] of [
  [1440, 900],
  [375, 812],
] as const) {
  test(`the specimen at ${width} px matches its golden`, async ({ page }) => {
    await showSpecimen(page, width, height);
    // The specimen scrolls inside the fixed view: grow the window to its height so one image holds all of it.
    const full = await page.locator('#specimen').evaluate((node) => node.scrollHeight);
    await page.setViewportSize({ width, height: full });
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`specimen-${width}.png`);
  });

  test(`axe finds no violation on the specimen at ${width} px`, async ({ page }) => {
    await showSpecimen(page, width, height);
    const result = await new AxeBuilder({ page }).withTags(TAGS).include('#specimen').analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

const HOVERED = [
  '#specimen button:enabled',
  '#specimen select:enabled',
  '#specimen input[type=checkbox]:enabled',
  '#specimen input[type=radio]:enabled:not(.segment input)',
  '#specimen input[type=range]:enabled',
  '#specimen .slider input[type=number]:enabled',
  '#specimen .xyz-cell:has(input:enabled)',
  '#specimen .segment:has(input:enabled)',
].join(', ');

// Where a control's hover shows: the segment's label is a wrapper, its span paints.
async function look(control: Locator): Promise<string> {
  return control.evaluate((node) => {
    const target = node.classList.contains('segment') ? (node.querySelector('span') ?? node) : node;
    const style = getComputedStyle(target);
    return [style.backgroundColor, style.borderColor, style.color, style.outlineStyle, style.opacity].join('|');
  });
}

test('hovering changes every enabled specimen control and a disabled one stays as it is', async ({ page }) => {
  await showSpecimen(page, 1440, 900);
  const controls = page.locator(HOVERED);
  const count = await controls.count();
  expect(count).toBeGreaterThan(20);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    await control.scrollIntoViewIfNeeded();
    // A checked segment keeps its raised fill on hover (the checked rule wins over the hover wash), so only the unchecked ones change.
    if (await control.evaluate((node) => node.classList.contains('segment') && !!node.querySelector('input:checked'))) {
      continue;
    }
    await page.mouse.move(0, 0);
    const before = await look(control);
    await control.hover();
    expect(await look(control), await control.evaluate((n) => n.outerHTML.slice(0, 90))).not.toBe(before);
  }
  const disabled = page.locator(
    '#specimen button:disabled, #specimen select:disabled, #specimen input:disabled:not(.segment input)',
  );
  const disabledCount = await disabled.count();
  expect(disabledCount).toBeGreaterThan(10);
  for (let i = 0; i < disabledCount; i++) {
    const control = disabled.nth(i);
    await control.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await look(control);
    await control.hover({ force: true });
    expect(await look(control)).toBe(before);
    expect(await control.evaluate((n) => getComputedStyle(n).cursor)).toBe('not-allowed');
  }
});

test('every enabled specimen control shows a 3 px blue light focus ring', async ({ page }) => {
  await showSpecimen(page, 1440, 900);
  await page.locator('#specimen button').first().focus();
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const ring = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.closest('#specimen')) return null;
      const target = active.closest('.segment') ?? active;
      const style = getComputedStyle(target);
      return {
        key: `${[...document.querySelectorAll('#specimen *')].indexOf(active)} ${active.outerHTML.slice(0, 80)}`,
        style: style.outlineStyle,
        width: style.outlineWidth,
        colour: style.outlineColor,
      };
    });
    if (ring) {
      expect(ring, ring.key).toMatchObject({ style: 'solid', width: '3px', colour: BLUE_LIGHT });
      seen.add(ring.key);
    }
    await page.keyboard.press('Tab');
  }
  const enabled = await page
    .locator(
      '#specimen :is(button, select, input):enabled:not([type=radio]), #specimen .segmented input:checked:enabled',
    )
    .count();
  expect(seen.size).toBeGreaterThanOrEqual(enabled - 1);
});

test('disabled never looks like on', async ({ page }) => {
  await showSpecimen(page, 1440, 900);
  const sections = ['Secondary', 'Ghost', 'Small', 'Icon 32', 'Icon 26', 'Toggle'];
  for (const name of sections) {
    const row = page.locator('#specimen section', { has: page.getByRole('heading', { name, exact: true }) });
    const controls = row.locator('button, input[type=checkbox]');
    const on = await controls.nth(1).evaluate((n) => {
      const s = getComputedStyle(n);
      return { opacity: s.opacity, background: s.backgroundColor, disabled: (n as HTMLButtonElement).disabled };
    });
    const off = await controls.nth(2).evaluate((n) => {
      const s = getComputedStyle(n);
      return { opacity: s.opacity, background: s.backgroundColor, disabled: (n as HTMLButtonElement).disabled };
    });
    expect(on.disabled, name).toBe(false);
    expect(off.disabled, name).toBe(true);
    expect(off.opacity, name).not.toBe(on.opacity);
    expect(off.background, name).not.toBe(on.background);
  }
});

test('every icon-only button has an accessible name', async ({ page }) => {
  await showSpecimen(page, 1440, 900);
  const buttons = page.locator('#specimen .icon-button');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(19);
  for (let i = 0; i < count; i++) await expect(buttons.nth(i)).toHaveAccessibleName(/\S/);
});

test('a chip over the 3D view keeps its ring clear of the backdrop with a ground halo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  // A key press first, so the focus that follows is a keyboard focus (:focus-visible).
  await page.locator('#file-menu-button').focus();
  await page.keyboard.press('Tab');
  await page.locator('#camera-presets button').first().focus();
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return {
      inChip: !!document.activeElement?.closest('.chips'),
      offset: style.outlineOffset,
      width: style.outlineWidth,
      colour: style.outlineColor,
      shadow: style.boxShadow,
    };
  });
  expect(ring).toMatchObject({ inChip: true, offset: '0px', width: '3px', colour: BLUE_LIGHT });
  expect(ring.shadow).toContain('rgb(11, 12, 16)');
  expect(ring.shadow).toContain('5px');
});

test('a locked row shows the on state and a hovered active chip differs from a hovered inactive one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await waitForEditor(page);
  const lock = page.locator('.outliner-row .lock').first();
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  expect(await lock.evaluate((n) => getComputedStyle(n).color)).toBe(BLUE_LIGHT);
  await page.evaluate(() => {
    const host = document.querySelector('.chips') as HTMLElement;
    for (const [id, pressed] of [
      ['probe-off', 'false'],
      ['probe-on', 'true'],
    ] as const) {
      const chip = document.createElement('button');
      chip.id = id;
      chip.textContent = id;
      chip.setAttribute('aria-pressed', pressed);
      host.append(chip);
    }
  });
  const hovered = async (id: string): Promise<string> => {
    await page.locator(`#${id}`).hover();
    return page.locator(`#${id}`).evaluate((n) => getComputedStyle(n).backgroundImage);
  };
  expect(await hovered('probe-on')).not.toBe(await hovered('probe-off'));
});

test('forced colours keep every control and active state visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await showSpecimen(page, 1440, 900);
  const row = (name: string) =>
    page.locator('#specimen section', { has: page.getByRole('heading', { name, exact: true }) });
  for (const kind of ['input[type=checkbox]', 'input[type=radio]']) {
    const heading = kind.includes('checkbox') ? 'Toggle' : 'Radio';
    const controls = row(heading).locator(kind);
    expect(await controls.first().evaluate((n) => getComputedStyle(n).appearance), heading).not.toBe('none');
    const unchecked = await controls.nth(0).screenshot();
    const checked = await controls.nth(1).screenshot();
    expect(unchecked.equals(checked), `${heading}: checked looks different from unchecked`).toBe(false);
  }
  const select = row('Select').locator('select').first();
  expect(await select.evaluate((n) => getComputedStyle(n).appearance)).not.toBe('none');
  const cue = (n: Element): string => {
    const s = getComputedStyle(n);
    return s.outlineStyle === 'none' ? 'none' : `${s.outlineStyle} ${s.outlineWidth}`;
  };
  const buttons = row('Secondary').locator('button');
  expect(await buttons.nth(0).evaluate(cue)).toBe('none');
  expect(await buttons.nth(1).evaluate(cue)).toBe('solid 2px');
  const sliders = row('Slider and value').locator('input[type=range]');
  const low = await sliders.nth(0).screenshot();
  const high = await sliders.nth(1).screenshot();
  expect(low.equals(high), 'the slider thumb moves').toBe(false);
  const segments = row('Segmented').locator('.segmented').nth(1);
  expect(await segments.locator('input:checked + span').evaluate(cue)).toBe('solid 2px');
  expect(await segments.locator('input:not(:checked) + span').first().evaluate(cue)).toBe('none');
});

test('forced colours mark the selected tab, an open panel toggle and the current outliner row', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await waitForEditor(page);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await openTab(page, 'Object');
  const tab = await page
    .getByRole('tab', { name: 'Object', exact: true })
    .evaluate((n) => [getComputedStyle(n).borderLeftStyle, getComputedStyle(n).borderLeftWidth]);
  expect(tab).toEqual(['solid', '3px']);
  const outline = (selector: string): Promise<string[]> =>
    page
      .locator(selector)
      .first()
      .evaluate((n) => [getComputedStyle(n).outlineStyle, getComputedStyle(n).outlineWidth]);
  expect(await outline('#outliner-toggle[aria-expanded=true]')).toEqual(['solid', '2px']);
  expect(await outline('.outliner-row .name[aria-current=true]')).toEqual(['solid', '2px']);
});

// A system colour as the browser resolves it on this page, to compare a computed colour with.
const systemColour = (page: Page, name: string): Promise<string> =>
  page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);

test('forced colours keep a visible border on the model dot and the toast', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await expect(page.locator('#model-state')).toHaveAttribute('data-state', /lit|busy/, { timeout: 120_000 });
  const canvasText = await systemColour(page, 'CanvasText');
  for (const selector of ['#model-state', '#status']) {
    const border = await page.locator(selector).evaluate((n) => {
      const style = getComputedStyle(n);
      return { style: style.borderTopStyle, width: parseFloat(style.borderTopWidth), colour: style.borderTopColor };
    });
    expect(['solid', 'dashed'], selector).toContain(border.style);
    expect(border.width, selector).toBeGreaterThanOrEqual(1);
    expect(border.colour, selector).toBe(canvasText);
  }
});

test('forced colours keep the empty card and the drag state visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const border = (): Promise<string[]> =>
    page
      .locator('.empty-card')
      .evaluate((n) => [getComputedStyle(n).borderTopStyle, getComputedStyle(n).borderTopWidth]);
  expect(await border()).toEqual(['dashed', '2px']);
  await dragFiles(page, 'enter', [{ name: 'a.bbmodel', text: '{}' }]);
  await expect(page.locator('#empty')).toHaveAttribute('data-drag', '');
  expect(await border()).toEqual(['solid', '2px']);
});

test('forced colours tell the three model dot states apart without colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openApp(page);
  const canvasText = await systemColour(page, 'CanvasText');
  const looks: string[] = [];
  for (const state of ['lit', 'busy', 'warn']) {
    const look = await page.locator('#model-state').evaluate((node, value) => {
      node.setAttribute('data-state', value);
      const style = getComputedStyle(node);
      // The shape alone (ring style and corner), then the fill: two states never share both.
      return {
        shape: [style.borderTopStyle, style.borderTopLeftRadius, style.backgroundColor].join(' '),
        ring: style.borderTopColor,
      };
    }, state);
    looks.push(look.shape);
    // Not the author's yellow ring on a white Canvas: every state draws its ring in the system text colour.
    expect(look.ring, state).toBe(canvasText);
  }
  expect(new Set(looks).size).toBe(3);
});
