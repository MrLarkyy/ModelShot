import type { Tile } from './sampleSchedule';

/**
 * Camera rays per pixel of the denoiser's guides. A guide pixel is charged this many sample pixels, so a full guide
 * tile (an eighth of a trace tile across) costs one trace tile.
 */
export const GUIDE_RAYS = 64;

export interface GuideStepPlan {
  /** Guide tiles to draw, from the cursor on. */
  readonly guideTiles: number;
  /** Samples to draw after them. */
  readonly samples: number;
}

/**
 * What one `step` draws: its budget is `samples` × `pixels` sample pixels. Guide tiles come first, from `next`, while
 * they fit (always at least one while any is left); the samples are what the budget has left, so a step never mixes
 * a half-drawn guide with samples.
 */
export function planGuideStep(args: {
  readonly tiles: readonly Tile[];
  readonly next: number;
  readonly samples: number;
  readonly budget: number;
  readonly pixels: number;
}): GuideStepPlan {
  const { tiles, next, samples, budget: budgetSamples, pixels } = args;
  if (!(samples > 0)) return { guideTiles: 0, samples: 0 };
  const budget = budgetSamples * pixels;
  let spent = 0;
  let count = 0;
  for (const tile of tiles.slice(next)) {
    const cost = tile.width * tile.height * GUIDE_RAYS;
    if (count > 0 && spent + cost > budget) break;
    spent += cost;
    count++;
  }
  if (next + count < tiles.length) return { guideTiles: count, samples: 0 };
  return { guideTiles: count, samples: Math.max(0, Math.min(samples, Math.floor((budget - spent) / pixels))) };
}
