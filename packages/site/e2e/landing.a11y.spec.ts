import AxeBuilder from '@axe-core/playwright';
import { CONTRAST_PAIRS, tokens } from '@modelshot/brand';
import type { Page } from '@playwright/test';
import { expect, openLanding, test } from './siteTest';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

// Pauses the render sweep where its bright band lies over the hero tile label, the overlay's worst moment for text.
async function holdSweepOverLabel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sweep = document.querySelector('.sweep')!;
    const label = document.querySelector('.tile-hero .label')!.getBoundingClientRect();
    const animation = sweep.getAnimations()[0]!;
    animation.pause();
    let best = 0;
    let bestDistance = Infinity;
    for (let t = 0; t <= 5000; t += 25) {
      animation.currentTime = t;
      const band = sweep.getBoundingClientRect();
      const distance = Math.abs(band.left + band.width / 2 - (label.left + label.width / 2));
      if (distance < bestDistance) [best, bestDistance] = [t, distance];
    }
    animation.currentTime = best;
  });
}

for (const width of [360, 1440]) {
  test(`axe finds no WCAG A/AA violation at ${width} px`, async ({ page }) => {
    await openLanding(page, width);
    expect(await violations(page)).toEqual([]);
  });

  test(`axe finds no violation with every answer open at ${width} px`, async ({ page }) => {
    await openLanding(page, width);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    expect(await violations(page)).toEqual([]);
  });
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test('every rendered text colour on its ground is a checked contrast pair', async ({ page }) => {
  await openLanding(page, 1440);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  const rendered = await page.evaluate(() => {
    const opaque = (colour: string): boolean => colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent';
    const ground = (element: Element | null): string => {
      for (let e = element; e; e = e.parentElement) {
        const colour = getComputedStyle(e).backgroundColor;
        if (opaque(colour)) return colour;
      }
      return 'none';
    };
    const pairs = new Map<string, string>();
    for (const element of document.querySelectorAll('body *')) {
      const ownText = [...element.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!ownText || element.getClientRects().length === 0) continue;
      pairs.set(`${getComputedStyle(element).color}|${ground(element)}`, element.textContent.trim().slice(0, 40));
    }
    return [...pairs].map(([key, text]) => ({ fg: key.split('|')[0]!, bg: key.split('|')[1]!, text }));
  });
  const roleOf = new Map(Object.entries(tokens.color).map(([role, hex]) => [rgb(hex), role]));
  const unchecked = rendered.filter(({ fg, bg }) => {
    const pair = { fg: roleOf.get(fg), bg: roleOf.get(bg) };
    return !CONTRAST_PAIRS.some((p) => p.fg === pair.fg && p.bg === pair.bg && p.use !== 'ring');
  });
  expect(rendered.length).toBeGreaterThan(8);
  expect(unchecked).toEqual([]);
});

test('the render sweep at its peak stays under the hero tile text', async ({ page }) => {
  await openLanding(page, 1440);
  await holdSweepOverLabel(page);
  expect(await violations(page)).toEqual([]);
  // Hit-test with the overlay made targetable: the text must still be on top wherever the band covers it.
  const covered = await page.evaluate(() => {
    const sweep = document.querySelector<HTMLElement>('.sweep')!;
    sweep.style.pointerEvents = 'auto';
    const band = sweep.getBoundingClientRect();
    const texts = [...document.querySelectorAll('.tile-hero .label, .tile-hero .tile-title')];
    return texts.flatMap((text) => {
      const box = text.getBoundingClientRect();
      const x = Math.min(Math.max(band.left + band.width / 2, box.left + 1), box.right - 1);
      const y = box.top + box.height / 2;
      const top = document.elementFromPoint(x, y);
      return top === sweep ? [text.textContent ?? ''] : [];
    });
  });
  expect(covered).toEqual([]);
});
