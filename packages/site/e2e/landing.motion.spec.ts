import type { Page } from '@playwright/test';
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

for (const width of [360, 1440]) {
  test(`no layout shift over load and 4 s of animation at ${width} px`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await openLanding(page, width);
    // A fixed observation window over the ambient loops (up to 8 s); not a wait for a result.
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
  });
}

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
