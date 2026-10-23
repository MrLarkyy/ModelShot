/**
 * Durations of `frames` frames at `fps` in whole `unitsPerSecond` (100 for GIF centiseconds, 1000 for WebP
 * milliseconds): frame i lasts round((i + 1) · u / fps) − round(i · u / fps), so the rounding never adds up and the
 * clip lasts frames / fps to the nearest unit. 30 fps in centiseconds: 3, 4, 3, 3, 4, 3, …
 */
export function frameDurations(frames: number, fps: number, unitsPerSecond: number): number[] {
  const at = (i: number): number => Math.round((i * unitsPerSecond) / fps);
  return Array.from({ length: frames }, (_, i) => at(i + 1) - at(i));
}
