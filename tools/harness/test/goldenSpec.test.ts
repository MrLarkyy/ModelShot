import { describe, expect, it } from 'vitest';
import { fixtureUrl, goldenFileName, type GoldenSpec, type PathTracedGoldenSpec } from '../src/goldenSpec';

const pt: PathTracedGoldenSpec = {
  kind: 'pathtraced',
  fixture: 'progressive',
  name: 'progressive',
  seed: 7,
  samples: 64,
};

describe('goldenSpec', () => {
  it('encodes seed and sample count in the file name', () => {
    expect(goldenFileName(pt)).toBe('progressive.s7.n64.png');
    expect(goldenFileName({ ...pt, seed: 8 })).not.toBe(goldenFileName(pt));
    expect(goldenFileName({ ...pt, samples: 63 })).not.toBe(goldenFileName(pt));
    expect(goldenFileName({ kind: 'raster', fixture: 'gradient', name: 'gradient' })).toBe('gradient.png');
  });

  it('rejects an invalid seed or sample count', () => {
    for (const seed of [-1, 1.5, Number.NaN, 2 ** 32, Infinity]) {
      expect(() => goldenFileName({ ...pt, seed }), `seed ${seed}`).toThrow(/seed/);
    }
    for (const samples of [0, -1, 1.5, Number.NaN, 4097]) {
      expect(() => goldenFileName({ ...pt, samples }), `samples ${samples}`).toThrow(/samples/);
    }
    expect(goldenFileName({ ...pt, seed: 0, samples: 1 })).toBe('progressive.s0.n1.png');
    expect(goldenFileName({ ...pt, seed: 2 ** 32 - 1, samples: 4096 })).toBe('progressive.s4294967295.n4096.png');
  });

  it('rejects a tolerance override without a reason', () => {
    const spec = (reason: string): GoldenSpec => ({
      kind: 'raster',
      fixture: 'gradient',
      name: 'gradient',
      tolerance: { maxDiffRatio: 0.01, reason },
    });
    expect(() => goldenFileName(spec(''))).toThrow(/reason/);
    expect(() => goldenFileName(spec('   '))).toThrow(/reason/);
    expect(goldenFileName(spec('SwiftShader differs by edge pixels on Linux, see CI diff'))).toBe('gradient.png');
  });

  it('rejects names that could escape the golden directory', () => {
    expect(() => goldenFileName({ kind: 'raster', fixture: 'gradient', name: '../x' })).toThrow(/name/);
    expect(() => fixtureUrl({ kind: 'raster', fixture: 'a/b', name: 'x' })).toThrow(/fixture/);
  });

  it('builds the URL from the spec parameters only', () => {
    expect(fixtureUrl(pt)).toBe('/progressive.html?seed=7&samples=64');
    expect(fixtureUrl({ kind: 'raster', fixture: 'gradient', name: 'gradient' })).toBe('/gradient.html');
    expect(fixtureUrl({ kind: 'raster', fixture: 'gradient', name: 'gradient', variant: 'broken' })).toBe(
      '/gradient.html?variant=broken',
    );
  });
});
