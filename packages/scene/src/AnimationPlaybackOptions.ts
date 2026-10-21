import type { SceneAnimationLoop } from './SceneAnimation';

/** Which animation `animateScene` plays and where. */
export interface AnimationPlaybackOptions {
  /** Index into `SceneDocument.animations`, or the name of the first animation with that name. */
  readonly animation: number | string;
  /** Seconds of playback, finite; the loop mode maps them into the clip (`animationTime`). */
  readonly time: number;
  /** Overrides the animation's own loop mode; absent: the animation's. */
  readonly loop?: SceneAnimationLoop;
}
