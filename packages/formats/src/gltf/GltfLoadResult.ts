import type { SceneDocument } from '@modelshot/scene';
import type { GltfWarning } from './GltfWarning';

export interface GltfLoadResult {
  readonly scene: SceneDocument;
  /** At most `MAX_GLTF_WARNINGS`, in the order they occurred. */
  readonly warnings: readonly GltfWarning[];
}
