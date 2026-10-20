import type { SceneSource } from './SceneDocument';
import type { Vec3 } from './Vec3';

/**
 * Record of a model merged under a bone by `attachModel`. The merged nodes and meshes already carry the placement;
 * this tells a tool which nodes came from where.
 */
export interface SceneAttachment {
  readonly name: string;
  /** Index of the host node the model hangs from. */
  readonly bone: number;
  /** Index of the attachment node (child of `bone`) that holds the attached model's root nodes and root meshes. */
  readonly node: number;
  /** Model units in the attachment node's frame, applied after `scale`. */
  readonly offset: Vec3;
  /** Euler degrees about the bone's pivot (the attachment node's rest rotation). */
  readonly rotation: Vec3;
  /** Uniform scale baked into the attached vertices, pivots and translations. */
  readonly scale: number;
  /** Where the attached model came from. */
  readonly source: SceneSource;
}
