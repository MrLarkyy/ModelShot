import type { SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { hiddenIndices, visibilityFromHidden } from '../src/session/visibility';
import { withVisibility } from '../src/session/withVisibility';

const node = (visible: boolean): SceneDocument['nodes'][number] => ({ name: 'n', visible }) as never;
const mesh = (visible: boolean): SceneDocument['meshes'][number] => ({ name: 'm', visible }) as never;
const doc = { nodes: [node(true), node(true)], meshes: [mesh(true)] } as unknown as SceneDocument;

describe('withVisibility', () => {
  it('returns the same document when nothing changed', () => {
    expect(withVisibility(doc, [true, true], [true])).toBe(doc);
  });

  it('changes only the flags that differ and keeps the other objects', () => {
    const changed = withVisibility(doc, [true, false], [true]);
    expect(changed).not.toBe(doc);
    expect(changed.nodes[0]).toBe(doc.nodes[0]);
    expect(changed.nodes[1]?.visible).toBe(false);
    expect(changed.meshes[0]).toBe(doc.meshes[0]);
    expect(doc.nodes[1]?.visible).toBe(true);
  });

  it('round trips hidden indices and ignores indices past the end', () => {
    expect(visibilityFromHidden(3, [1, 9])).toEqual([true, false, true]);
    expect(hiddenIndices([true, false, true, false])).toEqual([1, 3]);
  });
});
