import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../src/harnessTest';
import { PNG } from 'pngjs';
import { expectGolden } from '../src/expectGolden';
import { goldenPath } from '../src/goldenStore';
import type { RasterGoldenSpec } from '../src/goldenSpec';

const gradient: RasterGoldenSpec = { kind: 'raster', fixture: 'gradient', name: 'gradient' };

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('a 32x32 block change fails with actual, expected and diff images', async ({ page }, testInfo) => {
  const before = sha256(goldenPath(gradient));
  const broken: RasterGoldenSpec = { ...gradient, variant: 'broken' };

  await expect(expectGolden(page, testInfo, broken, { compareAgainst: gradient, allowUpdate: false })).rejects.toThrow(
    /1024 pixels differ.*gradient-diff\.png/s,
  );

  for (const kind of ['actual', 'expected', 'diff']) {
    const path = join(testInfo.outputDir, `gradient-${kind}.png`);
    expect(existsSync(path), path).toBe(true);
    expect(PNG.sync.read(readFileSync(path)).width).toBe(256);
  }
  expect(sha256(goldenPath(gradient))).toBe(before);
});
