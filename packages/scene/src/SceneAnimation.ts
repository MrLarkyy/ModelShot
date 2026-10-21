import type { Vec3 } from './Vec3';

/**
 * What happens after `length`: `once` returns to rest, `hold` keeps the last frame, `loop` starts over (Blockbench
 * loop modes).
 */
export type SceneAnimationLoop = 'once' | 'hold' | 'loop';

/** How a channel moves from a keyframe to the next one (`sampleChannel` has the pair rules). */
export type SceneInterpolation = 'linear' | 'catmullrom' | 'step';

/**
 * `rotation`: Euler degrees added to the node's rest rotation; `translation`: the node's `translation`; `scale`: the
 * node's `scale` (a factor of its rest size).
 */
export type SceneAnimationProperty = 'rotation' | 'translation' | 'scale';

/** One keyframe of a channel, in scene units and axes (loaders convert from their file format). */
export interface SceneKeyframe {
  /** Seconds from the start of the animation, ≥ 0. */
  readonly time: number;
  /** The value from this keyframe on (Blockbench: the post data point). */
  readonly value: Vec3;
  /** The value arriving at this keyframe when it differs (Blockbench: the pre data point); absent: `value`. */
  readonly before?: Vec3;
  /** How the channel moves from this keyframe to the next one. */
  readonly interpolation: SceneInterpolation;
}

export interface SceneAnimationChannel {
  /** Index into `SceneDocument.nodes`; at most one channel per node and property. */
  readonly node: number;
  readonly property: SceneAnimationProperty;
  /** At least one, sorted by `time` (equal times keep their file order). */
  readonly keyframes: readonly SceneKeyframe[];
}

/** A named clip of keyframed node transforms, applied to a document's rest pose by `animateScene`. */
export interface SceneAnimation {
  readonly name: string;
  readonly loop: SceneAnimationLoop;
  /**
   * Seconds, ≥ 0: the clip's period. Keyframes may lie past it (they shape the curve, the clip never reaches them);
   * a loader without a length takes the time of the last keyframe.
   */
  readonly length: number;
  readonly channels: readonly SceneAnimationChannel[];
}

/** What `animateScene` last applied to a document. */
export interface ScenePlayback {
  /** Index into `SceneDocument.animations`. */
  readonly animation: number;
  /** Seconds as requested (before the loop mode maps them into the clip). */
  readonly time: number;
  /** The loop mode used, the animation's own unless the playback options chose another. */
  readonly loop: SceneAnimationLoop;
}
