import type { SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { MAX_GROUP_ELEMENTS, elementMaterials, materialState } from '../src/inspector/materialState';

const group = (material: number, doubleSided?: boolean) => ({
  material,
  start: 0,
  count: 3,
  ...(doubleSided === undefined ? {} : { doubleSided }),
});

function document(meshCount = 2): SceneDocument {
  const meshes = Array.from({ length: meshCount }, (_, i) => ({
    name: `m${i}`,
    node: i === 0 ? 1 : 0,
    groups: i === 0 ? [group(0), group(1, true), group(1)] : [group(1, true)],
  }));
  return {
    nodes: [
      { name: 'root', children: [1], meshes: meshes.map((_, i) => i).filter((i) => i > 0) },
      { name: 'child', children: [], meshes: [0] },
    ],
    meshes,
    materials: [
      { name: 'skin', texture: 0 },
      { name: '', texture: -1, alphaMode: 'mask', alphaCutoff: 0.3, alphaEmission: true, blending: 'additive' },
    ],
    textures: [],
  } as unknown as SceneDocument;
}

describe('materialState', () => {
  it('says nothing is selected without a selection or for a stale index', () => {
    expect(materialState(document(), null)).toEqual({ kind: 'none' });
    expect(materialState(document(), { kind: 'mesh', index: 9 })).toEqual({ kind: 'none' });
    expect(materialState(document(), { kind: 'node', index: 9 })).toEqual({ kind: 'none' });
  });

  it('describes an element by its distinct materials with the alpha rule and sides', () => {
    const state = materialState(document(), { kind: 'mesh', index: 0 });
    expect(state.kind).toBe('element');
    const materials = state.kind === 'element' ? state.materials : [];
    expect(materials.map((m) => m.name)).toEqual(['skin', 'Material 2']);
    expect(materials[0]).toMatchObject({ alphaMode: 'opaque', cutoff: null, sides: 'Front', blending: 'normal' });
    expect(materials[1]).toMatchObject({
      alphaMode: 'mask',
      cutoff: 0.3,
      alphaEmission: true,
      blending: 'additive',
      sides: 'Front and both',
    });
  });

  it('lists the elements of a group and of its sub-groups, each with its materials', () => {
    const state = materialState(document(), { kind: 'node', index: 0 });
    expect(state.kind).toBe('group');
    if (state.kind !== 'group') return;
    expect(state.total).toBe(2);
    expect(state.elements.map((e) => e.mesh).sort()).toEqual([0, 1]);
    expect(state.elements.find((e) => e.mesh === 1)?.materials).toEqual(['Material 2']);
  });

  it('caps a very large group and keeps the total', () => {
    const big = document(MAX_GROUP_ELEMENTS + 20);
    const state = materialState(big, { kind: 'node', index: 0 });
    if (state.kind !== 'group') throw new Error('expected a group');
    expect(state.elements).toHaveLength(MAX_GROUP_ELEMENTS);
    expect(state.total).toBe(MAX_GROUP_ELEMENTS + 20);
  });

  it('uses the default material for an element without groups', () => {
    expect(elementMaterials({ ...document(), meshes: [{ groups: [] }] } as unknown as SceneDocument, 0)).toEqual([]);
  });
});
