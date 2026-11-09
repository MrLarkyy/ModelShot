import { animateScene, type SceneAnimation } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { nodeTransform, setNodeEdit, withNodeEdits } from '../src/session/withNodeEdits';
import { boxMesh, doc, node } from './editorDocs';

const d = doc([node(-1, { rotation: [0, 10, 0], meshes: [0] }), node(0)], [boxMesh(0)]);
const edit = {
  node: 0,
  translation: [1, 2, 3] as [number, number, number],
  rotation: [0, 40, 0] as [number, number, number],
};

describe('withNodeEdits', () => {
  it('returns the same document without edits and keeps the shared arrays with them', () => {
    expect(withNodeEdits(d, d, [])).toBe(d);
    const edited = withNodeEdits(d, d, [edit]);
    expect(edited.meshes).toBe(d.meshes);
    expect(edited.materials).toBe(d.materials);
    expect(edited.textures).toBe(d.textures);
    expect(edited.nodes[0]?.rotation).toEqual([0, 40, 0]);
    expect(edited.nodes[0]?.translation).toEqual([1, 2, 3]);
    expect(edited.nodes[1]).toBe(d.nodes[1]);
  });

  it('keeps the rest rotation so the renderer sees a pose change', () => {
    expect(withNodeEdits(d, d, [edit]).nodes[0]?.restRotation).toEqual([0, 10, 0]);
  });

  it('adds the edit on top of an animated pose', () => {
    const clip: SceneAnimation = {
      name: 'spin',
      loop: 'loop',
      length: 1,
      channels: [
        {
          node: 0,
          property: 'rotation',
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: 'linear' },
            { time: 1, value: [0, 90, 0], interpolation: 'linear' },
          ],
        },
      ],
    };
    const animated = doc(d.nodes, d.meshes, [clip]);
    const posed = animateScene(animated, { animation: 0, time: 0.5 }).document;
    // rest 10 + animation 45 + edit (40 - 10)
    expect(withNodeEdits(posed, animated, [edit]).nodes[0]?.rotation[1]).toBeCloseTo(85);
  });

  it.each([0, 0.5])(
    'puts the translation edit on a clip frame at %s s, with and without a translation channel',
    (time) => {
      const clip: SceneAnimation = {
        name: 'walk',
        loop: 'loop',
        length: 1,
        channels: [
          {
            node: 0,
            property: 'translation',
            keyframes: [
              { time: 0, value: [0, 0, 0], interpolation: 'linear' },
              { time: 1, value: [2, 0, 0], interpolation: 'linear' },
            ],
          },
        ],
      };
      const animated = doc(d.nodes, d.meshes, [clip]);
      const move = {
        node: 1,
        translation: [0, 5, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      };
      const frame = withNodeEdits(animateScene(animated, { animation: 0, time, loop: 'loop' }).document, animated, [
        edit,
        move,
      ]);
      expect(frame.nodes[0]?.translation).toEqual([time * 2 + 1, 2, 3]);
      expect(frame.nodes[1]?.translation).toEqual([0, 5, 0]);
    },
  );

  it('replaces an edit for the same node and drops one equal to the rest', () => {
    const first = setNodeEdit(d, [], edit);
    expect(first).toHaveLength(1);
    const second = setNodeEdit(d, first, { ...edit, translation: [9, 9, 9] });
    expect(second).toHaveLength(1);
    expect(second[0]?.translation).toEqual([9, 9, 9]);
    expect(setNodeEdit(d, second, { node: 0, translation: [0, 0, 0], rotation: [0, 10, 0] })).toEqual([]);
    expect(setNodeEdit(d, [], { ...edit, node: 99 })).toEqual([]);
  });

  it('reads the transform of a node with or without an edit', () => {
    expect(nodeTransform(d, [], 0)?.rotation).toEqual([0, 10, 0]);
    expect(nodeTransform(d, [edit], 0)?.translation).toEqual([1, 2, 3]);
    expect(nodeTransform(d, [], 7)).toBeNull();
  });
});
