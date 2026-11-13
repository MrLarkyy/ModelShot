import type { SceneAnimation, SceneDocument, SceneKeyframe } from '@modelshot/scene';
import { displayName } from '../editor/displayName';
import { MAX_KEYFRAME_MARKERS, mergeTimes, validTimes } from './keyframeTimes';

/** Most node lanes one clip draws; the rest are one "+N more nodes" row. */
export const MAX_LANES = 500;

export interface LaneMarker {
  readonly time: number;
  /** "0.50 s · rotation 0, 45, 0": the tooltip of the diamond. */
  readonly title: string;
}

export interface LaneRow {
  /** Index into `SceneDocument.nodes`. */
  readonly node: number;
  /** The node's label; text only. */
  readonly name: string;
  readonly markers: readonly LaneMarker[];
}

export interface LaneRows {
  readonly rows: readonly LaneRow[];
  /** Animated nodes beyond `MAX_LANES`. */
  readonly more: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

function summary(time: number, parts: readonly (readonly [string, SceneKeyframe])[]): string {
  const values = parts.map(([property, keyframe]) => `${property} ${keyframe.value.map(round).join(', ')}`);
  return `${time.toFixed(2)} s · ${values.join('; ')}`;
}

// Keyframes are sorted by time (the scene format guarantees it): a binary search finds the one at `time`.
function keyframeAt(keyframes: readonly SceneKeyframe[], time: number): SceneKeyframe | undefined {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((keyframes[mid]?.time ?? Infinity) < time) low = mid + 1;
    else high = mid;
  }
  return keyframes[low]?.time === time ? keyframes[low] : undefined;
}

/**
 * One row per animated node of `animation` in node order. A node's keyframe times of all its channels share a diamond
 * where closer than `minGap` seconds (one pixel); times that are not numbers or lie outside the clip are left out.
 * At most `MAX_LANES` rows and `MAX_KEYFRAME_MARKERS` diamonds in all.
 */
export function laneRows(
  animation: SceneAnimation,
  doc: SceneDocument | null,
  names: ReadonlyMap<string, string> = new Map(),
  minGap = 0,
): LaneRows {
  const byNode = new Map<number, SceneAnimation['channels'][number][]>();
  const nodeCount = doc?.nodes.length ?? Number.POSITIVE_INFINITY;
  for (const channel of animation.channels) {
    if (!Number.isInteger(channel.node) || channel.node < 0 || channel.node >= nodeCount) continue;
    const list = byNode.get(channel.node);
    if (list) list.push(channel);
    else byNode.set(channel.node, [channel]);
  }
  const nodes = [...byNode.keys()].sort((a, b) => a - b);
  let budget = MAX_KEYFRAME_MARKERS;
  const rows: LaneRow[] = [];
  for (const node of nodes.slice(0, MAX_LANES)) {
    const channels = byNode.get(node) ?? [];
    const sorted = validTimes(
      channels.flatMap((channel) => channel.keyframes.map((keyframe) => keyframe.time)),
      animation.length,
    );
    const times = mergeTimes(sorted, minGap, budget);
    budget -= times.length;
    const markers = times.map((time) => ({
      time,
      title: summary(
        time,
        channels.flatMap((channel) => {
          const keyframe = keyframeAt(channel.keyframes, time);
          return keyframe ? [[channel.property, keyframe] as const] : [];
        }),
      ),
    }));
    rows.push({ node, name: doc ? displayName(doc, names, 'node', node) : `Group ${node + 1}`, markers });
  }
  return { rows, more: Math.max(0, nodes.length - MAX_LANES) };
}
