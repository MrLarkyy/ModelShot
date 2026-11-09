import type { SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { pickMesh } from '../src/viewport/pickMesh';
import { boxMesh, doc, node } from './editorDocs';

const camera: SceneCamera = {
  position: [0, 0, 20],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 40 },
  near: 0.1,
  far: 100,
};
const none = { lockedNodes: [], lockedMeshes: [] };

describe('pickMesh', () => {
  const d = doc([node(-1, { meshes: [0] }), node(-1, { meshes: [1] })], [boxMesh(0, [0, 0, 0]), boxMesh(1, [0, 0, 5])]);

  it('picks the nearest box under the pointer', () => {
    expect(pickMesh(d, none, camera, 1, 0, 0)).toBe(1);
  });

  it('misses empty space', () => {
    expect(pickMesh(d, none, camera, 1, 0.9, 0.9)).toBeNull();
  });

  it('skips hidden meshes and locked meshes or nodes', () => {
    const hidden = doc(d.nodes, [d.meshes[0]!, { ...d.meshes[1]!, visible: false }]);
    expect(pickMesh(hidden, none, camera, 1, 0, 0)).toBe(0);
    expect(pickMesh(d, { lockedNodes: [], lockedMeshes: [false, true] }, camera, 1, 0, 0)).toBe(0);
    expect(pickMesh(d, { lockedNodes: [true, true], lockedMeshes: [] }, camera, 1, 0, 0)).toBeNull();
  });
});
