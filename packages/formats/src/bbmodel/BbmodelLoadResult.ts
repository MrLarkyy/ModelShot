import type { SceneDocument } from '@modelshot/scene';
import type { BbmodelWarning } from './BbmodelWarning';

export interface BbmodelLoadResult {
  readonly scene: SceneDocument;
  /** At most `MAX_BBMODEL_WARNINGS`, in the order they occurred. */
  readonly warnings: readonly BbmodelWarning[];
}
