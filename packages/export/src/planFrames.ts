import {
  animationFrameTimes,
  frameToFit,
  sceneBounds,
  type SceneBounds,
  type SceneCamera,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';
import type { CheckedExportOptions } from './checkExportOptions';
import { framePose } from './framePose';
import { throwIfCancelled } from './throwIfCancelled';
import { yieldToEventLoop } from './yieldToEventLoop';

/** One frame to render: from where, and for an animation when (its pose is `framePose` of that time). */
export interface PlannedFrame {
  readonly index: number;
  readonly camera: SceneCamera;
  /** Playback seconds of an animation frame (`index / fps`), else 0. */
  readonly time: number;
}

/** The frames of an export and, for an animation, where its shadow catcher stays for every frame. */
export interface FramePlan {
  readonly frames: readonly PlannedFrame[];
  /**
   * An animation's union of the bounds of all its poses (`SetSceneOptions.catcherBounds` for every frame, so the floor
   * does not ride with a jump); `null` for a still or a turntable (one document) or a clip with nothing visible.
   */
  readonly catcherBounds: SceneBounds | null;
}

/** The camera's orbit angles around its target, as `orbitDirection` takes them. */
function orbitAngles(camera: SceneCamera): { yawDeg: number; pitchDeg: number } {
  const d = [0, 1, 2].map((k) => (camera.position[k] ?? 0) - (camera.target[k] ?? 0)) as [number, number, number];
  const toDegrees = 180 / Math.PI;
  return {
    yawDeg: Math.atan2(d[0], d[2]) * toDegrees,
    pitchDeg: Math.atan2(d[1], Math.hypot(d[0], d[2])) * toDegrees,
  };
}

/** `v` turned by `deg` around the vertical axis through `pivot`, the way a growing yaw moves the orbit camera. */
function turnAroundY(v: Vec3, pivot: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const x = v[0] - pivot[0];
  const z = v[2] - pivot[2];
  return [pivot[0] + x * Math.cos(a) + z * Math.sin(a), v[1], pivot[2] + z * Math.cos(a) - x * Math.sin(a)];
}

/** `a` grown to hold `b`. */
function grow(a: SceneBounds | null, b: SceneBounds | null): SceneBounds | null {
  if (!b) return a;
  if (!a) return b;
  const min: [number, number, number] = [
    Math.min(a.min[0], b.min[0]),
    Math.min(a.min[1], b.min[1]),
    Math.min(a.min[2], b.min[2]),
  ];
  const max: [number, number, number] = [
    Math.max(a.max[0], b.max[0]),
    Math.max(a.max[1], b.max[1]),
    Math.max(a.max[2], b.max[2]),
  ];
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
}

function fitted(camera: SceneCamera, bounds: SceneBounds, aspect: number, yawOffsetDeg: number): SceneCamera {
  const { yawDeg, pitchDeg } = orbitAngles(camera);
  return frameToFit(bounds, { projection: camera.projection, aspect, yawDeg: yawDeg + yawOffsetDeg, pitchDeg });
}

/**
 * The frames of a checked export. A still: the camera as given. A turntable of N frames: yaw steps of 360° / N from
 * the camera's, the last one a step short of the first so the loop is seamless; `fit` frames the document's bounds at
 * one distance (the bounding sphere's, which no turn changes) with the camera's pitch and projection, `camera` orbits
 * the camera's own position around its target. An animation: playback times i / fps as `animationFrameTimes` counts
 * them for `seconds` (a loop leaves out the frame equal to frame 0, `hold` and `once` end on the last); one pass over
 * the poses (each built, measured and dropped, yielding to the event loop between them and checking `signal`) gives
 * the union of their bounds, which places the shadow catcher of every frame and, with `fit`, frames one camera for
 * every frame, so the view never jumps and no pose leaves the frame. Every frame renders with the same seed.
 */
export async function planFrames(
  doc: SceneDocument,
  options: CheckedExportOptions,
  signal?: AbortSignal,
): Promise<FramePlan> {
  const aspect = options.width / options.height;
  const camera = options.camera;
  if (options.kind === 'still') return { frames: [{ index: 0, camera, time: 0 }], catcherBounds: null };
  if (options.kind === 'turntable') {
    const bounds = options.framing === 'fit' ? sceneBounds(doc) : null;
    const frames = Array.from({ length: options.frames }, (_, index) => {
      const turn = (360 * index) / options.frames;
      const frameCamera = bounds
        ? fitted(camera, bounds, aspect, turn)
        : {
            ...camera,
            position: turnAroundY(camera.position, camera.target, turn),
            up: turnAroundY(camera.up, [0, 0, 0], turn),
          };
      return { index, camera: frameCamera, time: 0 };
    });
    return { frames, catcherBounds: null };
  }
  const times = animationFrameTimes({ length: options.seconds, loop: options.loop }, options.fps);
  let bounds: SceneBounds | null = null;
  for (const time of times) {
    throwIfCancelled(signal);
    bounds = grow(bounds, sceneBounds(framePose(doc, options, time)));
    await yieldToEventLoop();
  }
  throwIfCancelled(signal);
  const clipCamera = bounds && options.framing === 'fit' ? fitted(camera, bounds, aspect, 0) : camera;
  return { frames: times.map((time, index) => ({ index, camera: clipCamera, time })), catcherBounds: bounds };
}
