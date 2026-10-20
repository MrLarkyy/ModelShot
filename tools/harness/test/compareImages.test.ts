import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { compareImages } from '../src/compareImages';
import { gradientPaint, makePng } from './support';

const base = makePng(64, 64, gradientPaint);

describe('compareImages', () => {
  it('passes identical images', () => {
    const result = compareImages(base, base);
    expect(result.pass).toBe(true);
    expect(result.diffPixels).toBe(0);
  });

  it('passes a single differing pixel below the ratio', () => {
    const one = makePng(64, 64, (x, y) => (x === 5 && y === 5 ? [255, 0, 255, 255] : gradientPaint(x, y)));
    const result = compareImages(one, base, { maxDiffRatio: 0.001 });
    expect(result.diffPixels).toBe(1);
    expect(result.pass).toBe(true);
  });

  it('fails a 32x32 block and returns a decodable diff image', () => {
    const block = makePng(64, 64, (x, y) => (x < 32 && y < 32 ? [255, 0, 255, 255] : gradientPaint(x, y)));
    const result = compareImages(block, base);
    expect(result.pass).toBe(false);
    expect(result.diffPixels).toBeGreaterThanOrEqual(900);
    const diff = PNG.sync.read(result.diffPng);
    expect([diff.width, diff.height]).toEqual([64, 64]);
  });

  it('passes a change of 10 pixels by 1 level', () => {
    const nudge = makePng(64, 64, (x, y) => {
      const [r, g, b, a] = gradientPaint(x, y);
      return y === 20 && x >= 10 && x < 20 ? [r + 1, g + 1, b + 1, a] : [r, g, b, a];
    });
    const result = compareImages(nudge, base);
    expect(result.pass).toBe(true);
    expect(result.meanDelta).toBeLessThan(0.01);
  });

  it('fails a uniform shift of 2 levels that pixelmatch alone ignores', () => {
    const shifted = makePng(64, 64, (x, y) => {
      const [r, g, b, a] = gradientPaint(x, y);
      return [r + 2, g + 2, b + 2, a];
    });
    const result = compareImages(shifted, base);
    expect(result.diffPixels).toBe(0);
    expect(result.meanDelta).toBeCloseTo(1.5);
    expect(result.pass).toBe(false);
    expect(compareImages(shifted, base, { maxMeanDelta: 2 }).pass).toBe(true);
  });

  it('fails on a size mismatch and names both sizes', () => {
    const small = makePng(32, 32, gradientPaint);
    expect(() => compareImages(small, base)).toThrow(/actual 32x32, expected 64x64/);
  });

  it('reports a corrupt PNG clearly', () => {
    expect(() => compareImages(Buffer.from('not a png'), base)).toThrow(/actual image is not a valid PNG/);
    expect(() => compareImages(base, Buffer.from('not a png'))).toThrow(/expected image is not a valid PNG/);
  });
});
