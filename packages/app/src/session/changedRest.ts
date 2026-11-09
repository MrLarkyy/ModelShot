import type { SceneDocument } from '@modelshot/scene';
import { withVisibility } from './withVisibility';

/** What the rest pose of a setup is built from: the document with its texture filters, and the visibility. */
export interface RestInputs {
  readonly filtered: SceneDocument;
  readonly nodeVisible: readonly boolean[];
  readonly meshVisible: readonly boolean[];
}

/**
 * The rest pose after a setup change, `rest` being the one built from `before`. When neither the filtered document
 * nor the visibility changed, `rest` itself: `withVisibility` builds a new document whenever anything is hidden, and a
 * change of node edits alone must keep the meshes array the renderer has, or it decodes and uploads the scene again
 * instead of taking its pose-only path.
 */
export function changedRest(rest: SceneDocument, before: RestInputs, next: RestInputs): SceneDocument {
  const same =
    next.filtered === before.filtered &&
    next.nodeVisible === before.nodeVisible &&
    next.meshVisible === before.meshVisible;
  return same ? rest : withVisibility(next.filtered, next.nodeVisible, next.meshVisible);
}
