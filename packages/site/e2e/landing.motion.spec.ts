import type { Page } from '@playwright/test';
import { layoutShiftTotal, observeLayoutShift, settleFonts } from './layoutShift';
import { expect, openLanding, test } from './siteTest';

const MOVING = new Set(['transform', 'opacity']);
const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

async function hoverEverything(page: Page): Promise<void> {
  await page.locator('.tile').first().hover();
  await page.locator('.look').first().hover();
}

test('ambient motion runs and animates only transform and opacity', async ({ page }) => {
  await openLanding(page, 1440);
  const animations = await page.evaluate(() =>
    document.getAnimations().map((animation) => ({
      name: animation instanceof CSSAnimation ? animation.animationName : 'other',
      state: animation.playState,
      properties: (animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame)),
    })),
  );
  const running = animations.filter((a) => a.state === 'running');
  expect(running.length).toBeGreaterThanOrEqual(6);
  expect(new Set(running.map((a) => a.name))).toEqual(new Set(['ms-float', 'ms-pulse', 'ms-sweep', 'ms-spot']));
  const properties = new Set(animations.flatMap((a) => a.properties).filter((p) => !KEYFRAME_META.has(p)));
  expect(
    [...properties].every((p) => MOVING.has(p)),
    [...properties].join(' '),
  ).toBe(true);
});

test('hover lift and look hover transition only transform and opacity', async ({ page }) => {
  await openLanding(page, 1440);
  await hoverEverything(page);
  const transitions = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition)
      .map((animation) => animation.transitionProperty),
  );
  expect(transitions.length).toBeGreaterThan(0);
  expect(
    transitions.every((p) => MOVING.has(p)),
    transitions.join(' '),
  ).toBe(true);
});

// The brand face replaces the fallback face after first layout (font-display: block, preload not
// blocking), re-wrapping tile and drop-zone titles. Measured max 0.00056 under heavy load: 10x below
// the 0.01 visible bar, 100x below the Core Web Vitals "good" 0.1. The ambient window below stays strict.
const LOAD_SHIFT_BUDGET = 0.001;

for (const width of [360, 1440]) {
  test(`no layout shift over load and 4 s of animation at ${width} px`, async ({ page }) => {
    await observeLayoutShift(page);
    await openLanding(page, width);
    await settleFonts(page);
    expect(await layoutShiftTotal(page)).toBeLessThanOrEqual(LOAD_SHIFT_BUDGET);
    const before = await layoutShiftTotal(page);
    // A fixed observation window over the ambient loops (up to 8 s); not a wait for a result.
    await page.waitForTimeout(4000);
    expect(await layoutShiftTotal(page) - before).toBe(0);
  });
}

test('layout shift observer detects a real shift', async ({ page }) => {
  await observeLayoutShift(page);
  await openLanding(page, 1440);
  await settleFonts(page);
  const before = await layoutShiftTotal(page);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '300px';
    document.body.prepend(spacer);
  });
  await settleFonts(page);
  await expect.poll(async () => (await layoutShiftTotal(page)) - before).toBeGreaterThan(0.01);
});

test('reduced motion stops every animation and transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLanding(page, 1440);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await hoverEverything(page);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // At rest the sweep band is parked left of the hero tile, so it never sits under text.
  const { band, tile } = await page.evaluate(() => ({
    band: document.querySelector('.sweep')!.getBoundingClientRect().right,
    tile: document.querySelector('.tile-hero')!.getBoundingClientRect().left,
  }));
  expect(band).toBeLessThanOrEqual(tile);
});
