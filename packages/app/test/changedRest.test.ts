import { describe, expect, it } from 'vitest';
import { changedRest, type RestInputs } from '../src/session/changedRest';
import { withNodeEdits } from '../src/session/withNodeEdits';
import { withVisibility } from '../src/session/withVisibility';
import { boxMesh, doc, node } from './editorDocs';

const base = doc([node(-1, { meshes: [0] }), node(0, { meshes: [1] })], [boxMesh(0), boxMesh(1, [0, 2, 0])]);
// A hidden mesh: withVisibility builds a new document on every call.
const before: RestInputs = { filtered: base, nodeVisible: [true, true], meshVisible: [true, false] };
const rest = withVisibility(base, before.nodeVisible, before.meshVisible);

describe('changedRest', () => {
  it('keeps the rest pose of a change of node edits alone, so the edit takes the pose-only path', () => {
    expect(withVisibility(base, before.nodeVisible, before.meshVisible)).not.toBe(rest);
    const kept = changedRest(rest, before, { ...before });
    expect(kept).toBe(rest);
    const shown = withNodeEdits(kept, kept, [{ node: 1, translation: [3, 0, 0], rotation: [0, 0, 0] }]);
    expect(shown.meshes).toBe(rest.meshes);
    expect(shown.textures).toBe(rest.textures);
  });

  it('builds the rest pose again when the visibility or the filtered document changed', () => {
    const shownAgain = changedRest(rest, before, { ...before, meshVisible: [true, true] });
    expect(shownAgain.meshes[1]?.visible).toBe(true);
    const hiddenNode = changedRest(rest, before, { ...before, nodeVisible: [true, false] });
    expect(hiddenNode.nodes[1]?.visible).toBe(false);
    expect(hiddenNode.meshes[1]?.visible).toBe(false);
    const refiltered = { ...base };
    expect(changedRest(rest, before, { ...before, filtered: refiltered }).meshes).not.toBe(rest.meshes);
  });
});
