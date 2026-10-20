import { describe, expect, it } from 'vitest';
import { loadBudgets } from '../src/budgets';
import { measureBundle } from '../src/bundleSize';

describe('bundle size', () => {
  it.each(['app', 'embed'] as const)('%s gzip size is within budgets.json and free of harness code', async (target) => {
    const bundle = await measureBundle(target);
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(bundle.gzipBytes).toBeLessThanOrEqual(loadBudgets().bundleGzipBytes[target]!.max);
    expect(bundle.sources).not.toMatch(/pixelmatch|pngjs|playwright/i);
  });
});
