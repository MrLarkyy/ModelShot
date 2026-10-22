import {
  animateScene,
  animationFrameTimes,
  frameToFit,
  sceneBounds,
  type SceneBounds,
  type SceneCamera,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';
import type { CheckedExportOptions } from './checkExportOptions';
import { ExportError } from './ExportError';

/** One frame to render: what to show and from where. */
export interface PlannedFrame {
  readonly index: number;
  /** The pose: `doc` itself for a still and a turntable, `animateScene`'s copy for an animation frame. */
  readonly document: SceneDocument;
  readonly camera: SceneCamera;
  /** Playback seconds of an animation frame (`index / fps`), else 0. */
  readonly time: number;
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

function union(bounds: readonly (SceneBounds | null)[]): SceneBounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of bounds) {
    if (!b) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, b.min[k] as number);
      max[k] = Math.max(max[k] as number, b.max[k] as number);
    }
  }
  if (!(min[0] <= max[0])) return null;
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
 * them for `seconds` (a loop leaves out the frame equal to frame 0, `hold` and `once` end on the last), each pose
 * from the rest pose (`animateScene`); with `fit` one camera for every frame, framing the union of the bounds of all planned poses, so
 * the view never jumps and no pose leaves the frame. Every frame renders with the same seed.
 */
export function planFrames(doc: SceneDocument, options: CheckedExportOptions): PlannedFrame[] {
  const aspect = options.width / options.height;
  const camera = options.camera;
  if (options.kind === 'still') return [{ index: 0, document: doc, camera, time: 0 }];
  if (options.kind === 'turntable') {
    const bounds = options.framing === 'fit' ? sceneBounds(doc) : null;
    return Array.from({ length: options.frames }, (_, index) => {
      const turn = (360 * index) / options.frames;
      const frameCamera = bounds
        ? fitted(camera, bounds, aspect, turn)
        : {
            ...camera,
            position: turnAroundY(camera.position, camera.target, turn),
            up: turnAroundY(camera.up, [0, 0, 0], turn),
          };
      return { index, document: doc, camera: frameCamera, time: 0 };
    });
  }
  const poses: { document: SceneDocument; time: number }[] = [];
  const times = animationFrameTimes({ length: options.seconds, loop: options.loop }, options.fps);
  for (const time of times) {
    try {
      const pose = animateScene(doc, { animation: options.animation, time, loop: options.loop });
      poses.push({ document: pose.document, time });
    } catch (error) {
      throw new ExportError(
        'INVALID_OPTION',
        `animation ${options.animation}: ${error instanceof Error ? error.message : String(error)}`,
        'animation',
        { cause: error },
      );
    }
  }
  const bounds = options.framing === 'fit' ? union(poses.map((p) => sceneBounds(p.document))) : null;
  const clipCamera = bounds ? fitted(camera, bounds, aspect, 0) : camera;
  return poses.map((pose, index) => ({ index, document: pose.document, camera: clipCamera, time: pose.time }));
}
