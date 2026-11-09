import type { SceneDocument } from '@modelshot/scene';
import type { NodeEdit } from './NodeEdit';
import { withNodeEdits } from './withNodeEdits';

/**
 * The node edits as a step on each sampled frame of a clip export (`exportClip`'s `pose`): the edits sit on top of the
 * animation as in the preview's playback. Undefined without a model or without edits: the frames are the clip's.
 */
export function editPose(
  rest: SceneDocument | null,
  edits: readonly NodeEdit[],
): ((pose: SceneDocument) => SceneDocument) | undefined {
  return rest && edits.length > 0 ? (pose) => withNodeEdits(pose, rest, edits) : undefined;
}
