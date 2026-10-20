import { expect, test } from '@playwright/test';
import { expectGolden, renderFixture } from '../src/expectGolden';
import type { GoldenSpec, PathTracedGoldenSpec, RasterGoldenSpec } from '../src/goldenSpec';

const gradient: RasterGoldenSpec = { kind: 'raster', fixture: 'gradient', name: 'gradient' };
const progressive: PathTracedGoldenSpec = {
  kind: 'pathtraced',
  fixture: 'progressive',
  name: 'progressive',
  seed: 7,
  samples: 64,
};

test('gradient matches its golden', async ({ page }, testInfo) => {
  await expectGolden(page, testInfo, gradient);
});

test('a change of at most 10 pixels by 1 LSB passes', async ({ page }, testInfo) => {
  await expectGolden(
    page,
    testInfo,
    { ...gradient, variant: 'nudge' },
    { compareAgainst: gradient, allowUpdate: false },
  );
});

test('path-traced render at seed 7 and 64 samples matches its golden', async ({ page }, testInfo) => {
  await expectGolden(page, testInfo, progressive);
});

test('the same seed and sample count render byte-identical images', async ({ page }) => {
  const first = await renderFixture(page, progressive);
  const second = await renderFixture(page, progressive);
  expect(second.png.equals(first.png)).toBe(true);
});

test.describe('another seed or sample count fails the comparison', () => {
  const variants: [string, GoldenSpec][] = [
    ['seed 8', { ...progressive, seed: 8 }],
    ['16 samples', { ...progressive, samples: 16 }],
  ];
  for (const [label, spec] of variants) {
    test(label, async ({ page }, testInfo) => {
      await expect(
        expectGolden(page, testInfo, spec, { compareAgainst: progressive, allowUpdate: false }),
      ).rejects.toThrow(/pixels differ/);
    });
  }
});
