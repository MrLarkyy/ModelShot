import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBudgets } from '../src/budgets';
import { BUNDLE_TARGETS, measureBundle } from '../src/bundleSize';

const PACKAGES = fileURLToPath(new URL('../../../packages/', import.meta.url));
const SHIPS_GLSL: readonly string[] = ['app', 'app-entry', 'embed-frame'];

// Comment bodies long enough to be no code fragment, without quotes or backslashes that a bundler may rewrite.
function glslCommentBodies(): string[] {
  const bodies = new Set<string>();
  for (const file of globSync('*/src/**/*.glsl', { cwd: PACKAGES })) {
    for (const line of readFileSync(PACKAGES + file, 'utf8').split(/\r?\n/)) {
      const body = line.includes('//') ? line.slice(line.indexOf('//') + 2).trim() : '';
      if (body.length >= 24 && !/["\\]/.test(body)) bodies.add(body);
    }
  }
  return [...bodies];
}

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
    for (const body of glslCommentBodies()) expect(bundle.sources, `GLSL comment "${body}"`).not.toContain(body);
    // The e2e-only control specimen (MS-101) never reaches a production bundle.
    expect(bundle.sources).not.toContain('Control specimen');
    expect(bundle.sources).not.toContain('showSpecimen');
    if (SHIPS_GLSL.includes(target)) expect(bundle.sources).toContain('#version 300 es');
  });
});
