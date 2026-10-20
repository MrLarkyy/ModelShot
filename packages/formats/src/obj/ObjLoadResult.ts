import type { SceneDocument } from '@modelshot/scene';
import type { ObjWarning } from './ObjWarning';

export interface ObjLoadResult {
  readonly scene: SceneDocument;
  /** At most `MAX_OBJ_WARNINGS`, in the order they occurred. */
  readonly warnings: readonly ObjWarning[];
}
