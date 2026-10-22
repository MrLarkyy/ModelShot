import { describe, expect, it } from 'vitest';
import { isCheckpoint, nextCheckpoint, sampleTiles, samplesToDraw } from '../src/sampleSchedule';

describe('sampleTiles', () => {
  for (const [width, height, tile] of [
    [256, 256, 256],
    [256, 256, 64],
    [300, 150, 64],
    [1, 1, 256],
    [513, 17, 256],
  ] as const) {
    it(`covers ${width}x${height} exactly once with tiles of ${tile}`, () => {
      const covered = new Uint8Array(width * height);
      const tiles = sampleTiles(width, height, tile);
      for (const t of tiles) {
        expect(t.width).toBeLessThanOrEqual(tile);
        expect(t.height).toBeLessThanOrEqual(tile);
        for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) covered[y * width + x]!++;
      }
      expect(covered.every((c) => c === 1)).toBe(true);
      expect(tiles).toHaveLength(Math.ceil(width / tile) * Math.ceil(height / tile));
    });
  }

  it('rejects sizes that are not positive integers', () => {
    expect(() => sampleTiles(0, 10, 64)).toThrow(RangeError);
    expect(() => sampleTiles(10, 10, 0.5)).toThrow(RangeError);
  });
});

describe('samplesToDraw', () => {
  it('stops exactly at the target and never goes negative', () => {
    expect(samplesToDraw(0, 64, 7)).toBe(7);
    expect(samplesToDraw(63, 64, 7)).toBe(1);
    expect(samplesToDraw(64, 64, 7)).toBe(0);
    expect(samplesToDraw(0, 64, Infinity)).toBe(64);
    expect(samplesToDraw(10, 64, Number.NaN)).toBe(0);
    expect(samplesToDraw(0, 64, -3)).toBe(0);
    expect(samplesToDraw(0, 64, 2.9)).toBe(2);
  });
});

describe('checkpoints', () => {
  it('are 1, 2, 4, 8, 16, then every 16', () => {
    const upTo64 = Array.from({ length: 64 }, (_, i) => i + 1).filter(isCheckpoint);
    expect(upTo64).toEqual([1, 2, 4, 8, 16, 32, 48, 64]);
    expect(isCheckpoint(4096)).toBe(true);
    expect(isCheckpoint(4097)).toBe(false);
  });

  it('round a count up to the next checkpoint', () => {
    expect([0, 1, 2, 3, 5, 8, 9, 16, 17, 33, 48].map(nextCheckpoint)).toEqual([1, 1, 2, 4, 8, 8, 16, 16, 32, 48, 48]);
  });
});
