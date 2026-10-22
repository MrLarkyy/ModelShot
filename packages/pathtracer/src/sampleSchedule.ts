/** A rectangle of pixels drawn in one draw call (scissor), origin bottom-left as in WebGL. */
export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Row-major tiles of at most `tileSize` × `tileSize` covering a `width` × `height` frame exactly once. A sample is
 * drawn tile by tile so no single draw call runs long enough to trip a driver watchdog; every pixel's value depends only
 * on its own coordinates, so tiling changes no pixel.
 */
export function sampleTiles(width: number, height: number, tileSize: number): Tile[] {
  if (![width, height, tileSize].every((v) => Number.isInteger(v) && v >= 1)) {
    throw new RangeError(`tiles need positive integer sizes, got ${width}x${height} by ${tileSize}`);
  }
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      tiles.push({ x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) });
    }
  }
  return tiles;
}

/** Sample counts after which the quality path measures noise and resolves: 1, 2, 4, 8, 16, then every 16. */
export const CHECKPOINT_INTERVAL = 16;

export function isCheckpoint(samples: number): boolean {
  return samples === 1 || samples === 2 || samples === 4 || samples === 8 || samples % CHECKPOINT_INTERVAL === 0;
}

/** The first checkpoint at or after `samples` (≥ 1). */
export function nextCheckpoint(samples: number): number {
  if (samples <= 1) return 1;
  if (samples <= 8) return 2 ** Math.ceil(Math.log2(samples));
  return Math.ceil(samples / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
}

/** Samples the next `step` draws: never past `target`, at most `maxSamples` (Infinity: the rest; NaN: none). */
export function samplesToDraw(done: number, target: number, maxSamples: number): number {
  const wanted =
    maxSamples === Infinity ? Infinity : Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 0;
  return Math.max(0, Math.min(wanted, target - done));
}
