import { expect, openLanding, test, WIDTHS } from './siteTest';

const SECTION_IDS = ['top', 'looks', 'how', 'faq', 'open', 'footer'];
const FOCUS_ON_DARK = 'rgb(255, 210, 63)';
const FOCUS_RING = 'rgb(18, 19, 24)';

interface Stop {
  tag: string;
  label: string;
  outlineWidth: number;
  outlineStyle: string;
  outlineColor: string;
  onDark: boolean;
}

for (const width of WIDTHS) {
  test(`no horizontal scroll at ${width} px`, async ({ page }) => {
    await openLanding(page, width);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
}

test('has the canvas sections in order', async ({ page }) => {
  await openLanding(page, 1440);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[id]')].map((element) => element.id).filter((id) => id !== ''),
  );
  const order = SECTION_IDS.map((id) => ids.indexOf(id));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(page.locator('header nav[aria-label="Main"]')).toBeVisible();
  await expect(page.locator('main h1')).toContainText('the hero.');
});

for (const width of [360, 1440]) {
  test(`Tab reaches every control with a visible 3 px ring at ${width} px`, async ({ page }) => {
    await openLanding(page, width);
    const expected = await page.locator('a[href], button, input, summary').count();
    const stops: Stop[] = [];
    for (let i = 0; i < expected + 3; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate((): Stop | null => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;
        // The file input is visually hidden; its ring is drawn on the drop zone around it.
        const ringed = active instanceof HTMLInputElement ? active.closest('label')! : active;
        const style = getComputedStyle(ringed);
        return {
          tag: active.tagName.toLowerCase(),
          label: (active.textContent ?? '').trim() || active.id,
          outlineWidth: parseFloat(style.outlineWidth),
          outlineStyle: style.outlineStyle,
          outlineColor: style.outlineColor,
          onDark: active.closest('.on-dark') !== null,
        };
      });
      if (!stop || (stops[0]?.label === stop.label && stops[0].tag === stop.tag)) break;
      stops.push(stop);
    }
    expect(stops).toHaveLength(expected);
    expect(stops.map((s) => s.tag)).toEqual(expect.arrayContaining(['a', 'button', 'input', 'summary']));
    for (const stop of stops) {
      expect(stop.outlineStyle, stop.label).toBe('solid');
      expect(stop.outlineWidth, stop.label).toBeGreaterThanOrEqual(3);
      expect(stop.outlineColor, stop.label).toBe(stop.onDark ? FOCUS_ON_DARK : FOCUS_RING);
    }
    expect(stops[0]!.label).toBe('Skip to content');
  });
}

test('the skip link shows when focused and moves focus past the header', async ({ page }) => {
  await openLanding(page, 1440);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('every Open a model control is a button that opens the file picker', async ({ page }) => {
  await openLanding(page, 1440);
  const buttons = page.getByRole('button', { name: 'Open a model' });
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    expect((await chooser).isMultiple()).toBe(true);
  }
  await expect(page.locator('#model-input')).toHaveAttribute('accept', '.bbmodel,.gltf,.glb,.bin,.obj,.mtl,.png');
});
