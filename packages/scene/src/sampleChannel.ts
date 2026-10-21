import type { SceneKeyframe } from './SceneAnimation';
import type { Vec3 } from './Vec3';

/**
 * The value of a channel at `time` seconds (clip time, already mapped by the loop mode), following Blockbench's
 * `BoneAnimator.interpolate`:
 * - at or before the first keyframe: what arrives there (`before ?? value`); after the last: its `value`; exactly at
 *   a keyframe: what arrives there.
 * - between keyframes A and B: A `step` holds A's `value`; A `linear` and B `linear` or `step` interpolate linearly
 *   from A's `value` to what arrives at B; otherwise (either is `catmullrom`) a uniform Catmull-Rom spline (three.js
 *   `SplineCurve`) through A's predecessor, A, B and B's successor. A missing neighbour repeats the segment's end; the
 *   predecessor is only used when A has no `before`, the successor only when B has none. With `wrap` (loop mode) and
 *   at least three keyframes a missing predecessor is the next-to-last keyframe and a missing successor the second.
 * - keyframes with equal times: time reaches the first of them, and leaves from the last.
 * `keyframes` must be non-empty and sorted by time; the result is a pure function of the arguments.
 */
export function sampleChannel(keyframes: readonly SceneKeyframe[], time: number, wrap = false): Vec3 {
  const n = keyframes.length;
  const next = firstAtOrAfter(keyframes, time);
  const after = keyframes[next];
  const before = keyframes[next - 1];
  if (!before) return arriving(after ?? keyframes[0]);
  if (!after) return before.value;
  if (after.time === time) return arriving(after);
  if (before.interpolation === 'step') return before.value;
  const alpha = (time - before.time) / (after.time - before.time);
  const target = arriving(after);
  if (before.interpolation === 'linear' && after.interpolation !== 'catmullrom') {
    return map3((k) => before.value[k] + (target[k] - before.value[k]) * alpha);
  }
  const wraps = wrap && n >= 3;
  const previous = keyframes[next - 2] ?? (wraps ? keyframes[n - 2] : undefined);
  const following = keyframes[next + 1] ?? (wraps ? keyframes[1] : undefined);
  const p0 = previous && !before.before ? previous.value : before.value;
  const p3 = following && !after.before ? arriving(following) : target;
  return map3((k) => catmullRom(alpha, p0[k], before.value[k], target[k], p3[k]));
}

/** Index of the first keyframe with `time ≥ t`, `keyframes.length` when none. */
function firstAtOrAfter(keyframes: readonly SceneKeyframe[], t: number): number {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((keyframes[mid]?.time ?? Infinity) < t) low = mid + 1;
    else high = mid;
  }
  return low;
}

function arriving(keyframe: SceneKeyframe | undefined): Vec3 {
  return keyframe?.before ?? keyframe?.value ?? [0, 0, 0];
}

function map3(f: (k: 0 | 1 | 2) => number): Vec3 {
  return [f(0), f(1), f(2)];
}

/** three.js `CatmullRom` (uniform, tension 0.5) between p1 and p2. */
function catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  return (2 * p1 - 2 * p2 + v0 + v1) * t * t2 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}
