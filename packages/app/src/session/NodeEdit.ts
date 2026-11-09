import type { Vec3 } from '@modelshot/scene';

/** The rest-space transform the user gave a node: absolute translation and rotation (degrees), as `SceneNode` has them. */
export interface NodeEdit {
  readonly node: number;
  readonly translation: Vec3;
  readonly rotation: Vec3;
}
