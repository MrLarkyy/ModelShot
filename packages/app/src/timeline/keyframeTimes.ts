import type { SceneAnimation } from '@modelshot/scene';

/** Most markers the timeline draws for one clip. */
export const MAX_KEYFRAME_MARKERS = 2000;

export interface KeyframeMarkers {
  /** Marker times in seconds, ascending, at most one per `minGap` and at most `MAX_KEYFRAME_MARKERS`. */
  readonly times: readonly number[];
  /** Distinct keyframe times inside the clip before merging, for the "N keyframes" text. */
  readonly count: number;
}

/** The finite times in `[0, length]`, distinct and ascending. */
export function validTimes(times: Iterable<number>, length: number): number[] {
  const seen = new Set<number>();
  for (const time of times) if (Number.isFinite(time) && time >= 0 && time <= length) seen.add(time);
  return [...seen].sort((a, b) => a - b);
}

/** Ascending `sorted` times with those closer than `minGap` to the one before dropped, at most `limit`. */
export function mergeTimes(sorted: readonly number[], minGap: number, limit = MAX_KEYFRAME_MARKERS): number[] {
  const times: number[] = [];
  for (const time of sorted) {
    if (times.length >= limit) break;
    const last = times.at(-1);
    if (last === undefined || time - last >= minGap) times.push(time);
  }
  return times;
}

/** The distinct keyframe times of every channel of `animation` inside its length, merged where closer than `minGap` seconds. */
export function keyframeTimes(animation: SceneAnimation, minGap = 0): KeyframeMarkers {
  const sorted = validTimes(
    animation.channels.flatMap((channel) => channel.keyframes.map((keyframe) => keyframe.time)),
    animation.length,
  );
  return { times: mergeTimes(sorted, minGap), count: sorted.length };
}
