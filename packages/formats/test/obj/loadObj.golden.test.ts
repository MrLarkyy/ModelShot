import { resolveMaterialAlpha, texelCoverage } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { loadObj } from '../../src/index';
import { serializeResult } from '../support/serializeScene';
import { shapesFiles, shapesObj } from './fixtures';

const load = () => loadObj(shapesObj, { fileName: 'shapes.obj', files: shapesFiles() });

describe('loadObj fixtures (data goldens)', () => {
  it('shapes matches its golden', async () => {
    await expect(serializeResult(load())).toMatchFileSnapshot('__goldens__/shapes.json');
  });

  it('loads identically twice, and from bytes', () => {
    const first = serializeResult(load());
    expect(serializeResult(load())).toBe(first);
    const bytes = new TextEncoder().encode(shapesObj);
    expect(serializeResult(loadObj(bytes, { fileName: 'shapes.obj', files: shapesFiles() }))).toBe(first);
  });
});

describe('shapes: hand-checked', () => {
  const { scene, warnings } = load();

  it('one root node and mesh per object, scaled 16', () => {
    expect(scene.source).toEqual({ format: 'obj', formatVersion: '', modelFormat: 'obj' });
    expect(scene.nodes.map((n) => [n.name, n.parent, n.meshes])).toEqual([
      ['floor', -1, [0]],
      ['box', -1, [1]],
      ['star', -1, [2]],
      ['wedge', -1, [3]],
    ]);
    expect(scene.rootNodes).toEqual([0, 1, 2, 3]);
    expect(Math.max(...scene.meshes[0]!.positions)).toBeCloseTo(1.2 * 16, 4);
  });

  it('materials: Kd only is opaque with a colour texture, map_Kd and d < 1 blend with only byte 0 hidden', () => {
    expect(scene.materials.map((m) => [m.name, m.alphaMode, m.texture])).toEqual([
      ['grey', 'opaque', 0],
      ['cutout', 'blend', 1],
      ['glass', 'blend', 2],
    ]);
    expect(scene.textures.map((t) => [t.name, t.width, t.height, t.missing])).toEqual([
      ['colour #999999ff', 1, 1, false],
      ['shapes.png', 8, 8, false],
      ['colour #4d80e680', 1, 1, false],
    ]);
    const rule = resolveMaterialAlpha(scene.materials[1]);
    expect(texelCoverage(0, rule)).toBe('invisible');
    expect(texelCoverage(1 / 255, rule)).toBe('partial');
    expect(scene.meshes.every((m) => m.groups.every((g) => g.doubleSided === true))).toBe(true);
  });

  it('the concave star triangulates to 8 triangles with flat +Z normals, from negative indices', () => {
    const star = scene.meshes[2]!;
    expect(star.indices).toHaveLength(8 * 3);
    for (let v = 0; v < star.normals.length / 3; v++)
      expect([...star.normals.slice(v * 3, v * 3 + 3)]).toEqual([0, 0, 1]);
  });

  it('the wedge without vn has flat normals per face; vt flips v', () => {
    const wedge = scene.meshes[3]!;
    // 5 faces, own corners each: 3 + 3 + 4 + 4 + 4.
    expect(wedge.positions.length / 3).toBe(18);
    expect([...wedge.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    // vt 0 0 is the bottom-left in OBJ, so v = 1 at the top-left origin of the scene.
    expect([...wedge.uvs.slice(0, 2)]).toEqual([0, 1]);
  });

  it('reports what it ignores', () => {
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNSUPPORTED_STATEMENT', 'shapes.obj:75'],
      ['MATERIAL_PARAMS_IGNORED', 'shapes.mtl:2'],
      ['MATERIAL_PARAMS_IGNORED', 'shapes.mtl:12'],
    ]);
  });
});
