import type { Vec3 } from './Vec3';

/** One bone of a pose: Euler degrees added to the node's rest rotation, and an optional pose offset. */
export interface ScenePoseBone {
  /** Node name; the first node with that name is posed. */
  readonly bone: string;
  /** Degrees per axis, |v| ≤ 360, added to the rest rotation (same order as `SceneNode.rotation`). */
  readonly rotation: Vec3;
  /** Model units per axis, |v| ≤ 4096; absent: 0. Becomes `SceneNode.translation`. */
  readonly translation?: Vec3;
}

/** A named set of bone rotations, applied to a document's rest pose by `poseScene`. */
export interface ScenePose {
  readonly name: string;
  readonly bones: readonly ScenePoseBone[];
}
