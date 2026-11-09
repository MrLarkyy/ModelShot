import type { SceneAnimation } from '@modelshot/scene';

/** Most markers the timeline draws for one clip. */
export const MAX_KEYFRAME_MARKERS = 2000;

export interface KeyframeMarkers {
  /** Marker times in seconds, ascending, at most one per `minGap` and at most `MAX_KEYFRAME_MARKERS`. */
  readonly times: readonly number[];
  /** Distinct keyframe times inside the clip before merging, for the "N keyframes" text. */
  readonly count: number;
}

/** The distinct keyframe times of every channel of `animation` inside its length, merged where closer than `minGap` seconds. */
export function keyframeTimes(animation: SceneAnimation, minGap = 0): KeyframeMarkers {
  const seen = new Set<number>();
  for (const channel of animation.channels) {
    for (const keyframe of channel.keyframes) {
      if (Number.isFinite(keyframe.time) && keyframe.time >= 0 && keyframe.time <= animation.length) {
        seen.add(keyframe.time);
      }
    }
  }
  const sorted = [...seen].sort((a, b) => a - b);
  const times: number[] = [];
  for (const time of sorted) {
    const last = times.at(-1);
    if (last === undefined || time - last >= minGap) times.push(time);
    if (times.length >= MAX_KEYFRAME_MARKERS) break;
  }
  return { times, count: sorted.length };
}
