import { describe, expect, it } from 'vitest';
import { loadBudgets } from '../src/budgets';
import { BUNDLE_TARGETS, measureBundle } from '../src/bundleSize';

describe('bundle size', () => {
  it('measures exactly the bundles budgets.json has rows for', () => {
    expect(Object.keys(loadBudgets().bundleGzipBytes).sort()).toEqual([...BUNDLE_TARGETS].sort());
  });

  it.each(BUNDLE_TARGETS)('%s gzip size is within budgets.json and free of harness code', async (target) => {
    const bundle = await measureBundle(target);
    const max = loadBudgets().bundleGzipBytes[target]!.max;
    console.log(`[budget] bundleGzipBytes.${target}: measured ${bundle.gzipBytes} / max ${max}`);
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(bundle.gzipBytes).toBeLessThanOrEqual(max);
    expect(bundle.sources).not.toMatch(/pixelmatch|pngjs|playwright/i);
  });
});
