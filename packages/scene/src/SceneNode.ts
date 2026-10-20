import type { Vec3 } from './Vec3';

/**
 * A group or bone. Rest-space convention (Blockbench): `pivot` is absolute in model space, and the local matrix is
 * `T(translation) · T(pivot) · Rz · Ry · Rx · T(−pivot)`; the world matrix is `parent world · local`.
 */
export interface SceneNode {
  readonly name: string;
  /** Identifier in the source file (Blockbench uuid), `''` when the file has none. */
  readonly sourceId: string;
  /** Index into `SceneDocument.nodes`, always lower than this node's own index; −1 for a root node. */
  readonly parent: number;
  readonly children: readonly number[];
  readonly pivot: Vec3;
  /** Euler angles in degrees, applied X first, then Y, then Z (matrix `Rz · Ry · Rx`). */
  readonly rotation: Vec3;
  /** Pose offset; 0 at rest. */
  readonly translation: Vec3;
  /** `false` hides this node and its whole subtree. */
  readonly visible: boolean;
  /** Indices into `SceneDocument.meshes`. */
  readonly meshes: readonly number[];
}
