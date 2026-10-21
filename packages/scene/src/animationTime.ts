import type { SceneAnimation, SceneAnimationLoop } from './SceneAnimation';

/** Highest frame rate `animationFrameTimes` samples at. */
export const MAX_PLAYBACK_FPS = 240;
/** Most frames `animationFrameTimes` returns (one minute at 240 fps). */
export const MAX_ANIMATION_FRAMES = 14_400;

/**
 * Clip time of `animation` after `seconds` of playback: `loop` wraps (`seconds mod length`), `hold` stops at
 * `length`, `once` gives `null` after `length` (the animation has ended; the node is back at rest). Negative seconds
 * count as 0; a zero-length animation stays at 0. `seconds` must be finite, else a `RangeError`.
 */
export function animationTime(
  animation: Pick<SceneAnimation, 'length' | 'loop'>,
  seconds: number,
  loop: SceneAnimationLoop = animation.loop,
): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new RangeError('seconds: expected a finite number');
  }
  const t = Math.max(0, seconds);
  const length = animation.length;
  if (loop === 'loop') return length > 0 ? t % length : 0;
  if (loop === 'hold') return Math.min(t, length);
  return t > length ? null : t;
}

/**
 * Playback times of every frame of `animation` at `fps`, `i / fps` (computed per index, never accumulated, so frame
 * `i` of an export is the same time as a seek to it). `loop` stops before the frame that equals frame 0
 * (`max(1, round(length · fps))` frames); `hold` and `once` include the frame at `length` (`floor(length · fps) + 1`).
 * `fps` must be finite in (0, `MAX_PLAYBACK_FPS`] and the count at most `MAX_ANIMATION_FRAMES`, else a `RangeError`.
 */
export function animationFrameTimes(
  animation: Pick<SceneAnimation, 'length' | 'loop'>,
  fps: number,
  loop: SceneAnimationLoop = animation.loop,
): number[] {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > MAX_PLAYBACK_FPS) {
    throw new RangeError(`fps: expected a number in (0, ${MAX_PLAYBACK_FPS}]`);
  }
  const frames = animation.length * fps;
  // The epsilon keeps a length that is a whole number of frames (2.4 s at 30 fps = 71.99999…) from losing its last one.
  const count = loop === 'loop' ? Math.max(1, Math.round(frames)) : Math.floor(frames + 1e-9) + 1;
  if (!(count <= MAX_ANIMATION_FRAMES)) {
    throw new RangeError(`fps: ${String(count)} frames, the limit is ${MAX_ANIMATION_FRAMES}`);
  }
  return Array.from({ length: count }, (_, i) => i / fps);
}
