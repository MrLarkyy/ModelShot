import { describe, expect, it } from 'vitest';
import { GUIDE_PIXEL_COST, planGuideStep } from '../src/guideSchedule';
import { sampleTiles } from '../src/sampleSchedule';

const SIZE = 256;
const PIXELS = SIZE * SIZE;
const tiles = sampleTiles(SIZE, SIZE, 32);

describe('planGuideStep', () => {
  it('draws one guide tile and no sample for a one-sample budget', () => {
    expect(planGuideStep({ tiles, next: 0, samples: 1, budget: 1, pixels: PIXELS })).toEqual({
      guideTiles: 1,
      samples: 0,
    });
  });

  it('charges a full guide tile as one trace tile of the same side', () => {
    expect(32 * 32 * GUIDE_PIXEL_COST).toBe(256 * 256);
    expect(planGuideStep({ tiles, next: 0, samples: 4, budget: 4, pixels: PIXELS }).guideTiles).toBe(4);
  });

  it('fits more of the smaller edge tiles', () => {
    const edge = sampleTiles(80, 80, 32);
    const pixels = 80 * 80;
    // Tiles 6 and 7 are 32x16 (half a full tile's charge), tile 8 is 16x16: a budget of 11 samples holds two of them
    // but only one full tile.
    expect(planGuideStep({ tiles: edge, next: 0, samples: 11, budget: 11, pixels }).guideTiles).toBe(1);
    expect(planGuideStep({ tiles: edge, next: 6, samples: 11, budget: 11, pixels }).guideTiles).toBe(2);
    expect(planGuideStep({ tiles: edge, next: 6, samples: 13, budget: 13, pixels }).guideTiles).toBe(3);
  });

  it('draws one tile of a target smaller than a tile, whatever the budget', () => {
    const small = sampleTiles(16, 16, 32);
    expect(planGuideStep({ tiles: small, next: 0, samples: 1, budget: 1, pixels: 256 })).toEqual({
      guideTiles: 1,
      samples: 0,
    });
  });

  it('spends what the guide leaves on samples', () => {
    const last = planGuideStep({ tiles, next: tiles.length - 1, samples: 3, budget: 3, pixels: PIXELS });
    expect(last).toEqual({ guideTiles: 1, samples: 2 });
    expect(planGuideStep({ tiles, next: tiles.length, samples: 3, budget: 3, pixels: PIXELS })).toEqual({
      guideTiles: 0,
      samples: 3,
    });
  });

  it('draws the whole guide and every sample for an unbounded budget', () => {
    expect(planGuideStep({ tiles, next: 0, samples: 10, budget: Infinity, pixels: PIXELS })).toEqual({
      guideTiles: tiles.length,
      samples: 10,
    });
  });

  it('draws nothing for no samples', () => {
    expect(planGuideStep({ tiles, next: 0, samples: 0, budget: 0, pixels: PIXELS })).toEqual({
      guideTiles: 0,
      samples: 0,
    });
  });

  it('covers the guide exactly once over repeated one-sample steps', () => {
    let next = 0;
    let steps = 0;
    while (next < tiles.length) {
      next += planGuideStep({ tiles, next, samples: 1, budget: 1, pixels: PIXELS }).guideTiles;
      steps++;
    }
    expect(steps).toBe(tiles.length);
  });
});
