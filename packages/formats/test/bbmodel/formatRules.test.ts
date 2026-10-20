import { describe, expect, it } from 'vitest';
import { loadBbmodel, type BbmodelLimits } from '../../src/index';
import { cube, mesh, meshFace, model } from './fixtures';

const json = (value: unknown): string => JSON.stringify(value);
const meta = (modelFormat: string, extra: Record<string, unknown> = {}) => ({
  format_version: '4.5',
  model_format: modelFormat,
  ...extra,
});

/** North-face uv rect of the first mesh, in uv units of `width` × `height`. */
function northRect(text: string, width: number, height: number): number[] {
  const rects = loadBbmodel(text).scene.meshes[0]?.uvRects ?? new Float32Array(4);
  return [...rects.slice(0, 4)].map((x, k) => x * (k % 2 ? height : width));
}

describe('per-texture UV size (Blockbench per_texture_uv_size)', () => {
  const textures = [{ name: 't', uv_width: 32, uv_height: 64 }];

  it('applies uv_width/uv_height in the free format', () => {
    const { scene } = loadBbmodel(json(model({ meta: meta('free'), textures })));
    expect(scene.textures[0]).toMatchObject({ uvWidth: 32, uvHeight: 64 });
  });

  it.each(['bedrock', 'java_block', 'modded_entity', 'unknown-format'])(
    'uses the project resolution in %s and ignores the per-texture fields',
    (format) => {
      const ignored = [{ name: 't', uv_width: 0, uv_height: 'x' }];
      const { scene } = loadBbmodel(
        json(model({ meta: meta(format), textures: ignored, resolution: { width: 64, height: 32 } })),
      );
      expect(scene.textures[0]).toMatchObject({ uvWidth: 64, uvHeight: 32 });
    },
  );

  it('uses the project resolution when the format is missing', () => {
    const { scene } = loadBbmodel(json(model({ meta: { format_version: '4.5' }, textures })));
    expect(scene.textures[0]).toMatchObject({ uvWidth: 16, uvHeight: 16 });
  });
});

describe('box-UV size (Blockbench size(), box_uv_float_size)', () => {
  const boxModel = (format: string, from: number[], to: number[]) =>
    json(
      model({
        meta: meta(format, { box_uv: true }),
        resolution: { width: 64, height: 64 },
        elements: [cube({ from, to, faces: { north: {} } })],
      }),
    );

  it('floors with a 1e-7 epsilon', () => {
    // 2.99999999 + 1e-7 floors to 3; 2.999999 does not reach 3.
    expect(northRect(boxModel('free', [0.00000001, 0, 0], [3, 2, 1]), 64, 64)).toEqual([1, 1, 4, 3]);
    expect(northRect(boxModel('free', [0.000001, 0, 0], [3, 2, 1]), 64, 64)).toEqual([1, 1, 3, 3]);
  });

  it('keeps fractional sizes in modded_entity', () => {
    expect(northRect(boxModel('modded_entity', [0, 0, 0], [4.5, 2, 1]), 64, 64)).toEqual([1, 1, 5.5, 3]);
  });

  it('ignores stretch and inflate', () => {
    const element = cube({ from: [0, 0, 0], to: [4, 2, 1], stretch: [2, 2, 2], inflate: 1, faces: { north: {} } });
    const text = json(
      model({ meta: meta('free', { box_uv: true }), resolution: { width: 64, height: 64 }, elements: [element] }),
    );
    expect(northRect(text, 64, 64)).toEqual([1, 1, 5, 3]);
  });
});

describe('face texture by uuid', () => {
  it('resolves against textures[].uuid', () => {
    const textures = [
      { name: 'a', uuid: 't-a' },
      { name: 'b', uuid: 't-b' },
    ];
    const element = cube({ faces: { up: { uv: [0, 0, 1, 1], texture: 't-b' } } });
    const { scene } = loadBbmodel(json(model({ textures, elements: [element] })));
    expect(scene.meshes[0]?.groups).toEqual([{ material: 1, start: 0, count: 6, doubleSided: true }]);
  });
});

describe('byte-order mark', () => {
  it('is accepted on text and on bytes', () => {
    const text = json(model());
    expect(loadBbmodel('\uFEFF' + text).scene.meshes).toHaveLength(1);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect(loadBbmodel(bytes).scene.meshes).toHaveLength(1);
  });
});

describe('limit overrides', () => {
  it.each<[string, number]>([
    ['NaN', NaN],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['-Infinity', -Infinity],
  ])('rejects %s with a RangeError', (_name, value) => {
    expect(() => loadBbmodel(json(model()), { limits: { maxElements: value } })).toThrow(RangeError);
  });

  it('rejects a non-number from untyped callers', () => {
    const limits = { maxTriangles: '12' } as unknown as Partial<BbmodelLimits>;
    expect(() => loadBbmodel(json(model()), { limits })).toThrow(RangeError);
  });

  it('accepts positive integers and Infinity', () => {
    expect(() => loadBbmodel(json(model()), { limits: { maxElements: 1, maxFileBytes: Infinity } })).not.toThrow();
  });
});

describe('texture render_sides (Blockbench Canvas.getRenderSide)', () => {
  const sidedModel = (modelFormat: string, renderSides: unknown) =>
    json(
      model({
        meta: meta(modelFormat),
        textures: [renderSides === undefined ? { name: 't' } : { name: 't', render_sides: renderSides }],
        elements: [
          cube({ faces: { up: { uv: [0, 0, 1, 1], texture: 0 }, down: { uv: [0, 0, 1, 1] } } }),
          mesh({ uuid: 'm0', faces: { f: meshFace(['a', 'b', 'c'], { texture: 0 }) } }),
        ],
        outliner: ['c0', 'm0'],
      }),
    );
  const sidedness = (text: string) =>
    loadBbmodel(text).scene.meshes.map((m) => m.groups.map((g) => [g.material, g.doubleSided]));

  it.each<[string, unknown, boolean]>([
    ['front', 'front', false],
    ['double', 'double', true],
    ['auto in free', 'auto', true],
    ['absent in free', undefined, true],
  ])('%s', (_name, renderSides, doubleSided) => {
    expect(sidedness(sidedModel('free', renderSides))).toEqual([
      [
        [-1, true],
        [0, doubleSided],
      ],
      [[0, doubleSided]],
    ]);
  });

  it('auto is single-sided in java_block, for textured and untextured faces alike', () => {
    expect(sidedness(sidedModel('java_block', 'auto'))).toEqual([
      [
        [-1, false],
        [0, false],
      ],
      [[0, false]],
    ]);
    expect(sidedness(sidedModel('java_block', 'double'))[1]).toEqual([[0, true]]);
  });

  it('an unknown value warns and counts as auto', () => {
    const { scene, warnings } = loadBbmodel(sidedModel('free', 'back'));
    expect(scene.meshes[1]?.groups[0]?.doubleSided).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNSUPPORTED_VALUE', '$.textures[0].render_sides'],
      ['MISSING_TEXTURE', '$.textures[0]'],
    ]);
  });

  it('faces on a zero-thickness axis stay single-sided with a double-sided texture', () => {
    const face = { uv: [0, 0, 4, 4], texture: 0 };
    const text = json(
      model({
        textures: [{ name: 't', render_sides: 'double' }],
        elements: [cube({ from: [0, 0, 0], to: [4, 4, 0], faces: { north: face, south: face, up: face } })],
      }),
    );
    // north and south lie in the plane z = 0; up has zero area there and is dropped.
    expect(loadBbmodel(text).scene.meshes[0]?.groups).toEqual([
      { material: 0, start: 0, count: 12, doubleSided: false },
    ]);
  });

  it('a lone face on a zero-thickness axis keeps its texture sidedness (a pane seen from behind)', () => {
    const face = { uv: [0, 0, 4, 4], texture: 0 };
    const text = json(
      model({
        textures: [{ name: 't', render_sides: 'double' }],
        elements: [cube({ from: [0, 0, 0], to: [4, 4, 0], faces: { north: { ...face, texture: null }, south: face } })],
      }),
    );
    expect(loadBbmodel(text).scene.meshes[0]?.groups).toEqual([{ material: 0, start: 0, count: 6, doubleSided: true }]);
  });
});

describe('element render_order (Blockbench updateRenderOrder)', () => {
  it.each<[string, number]>([
    ['default', 0],
    ['behind', -1],
    ['in_front', 1],
  ])('%s on a cube and a mesh', (renderOrder, expected) => {
    const elements = [cube({ render_order: renderOrder }), mesh({ uuid: 'm0', render_order: renderOrder })];
    const { scene } = loadBbmodel(json(model({ elements, outliner: ['c0', 'm0'] })));
    expect(scene.meshes.map((m) => m.renderOrder)).toEqual([expected, expected]);
  });

  it('absent is 0; an unknown value warns and counts as default', () => {
    const elements = [cube(), mesh({ uuid: 'm0', render_order: 'on_top' })];
    const { scene, warnings } = loadBbmodel(json(model({ elements, outliner: ['c0', 'm0'] })));
    expect(scene.meshes.map((m) => m.renderOrder)).toEqual([0, 0]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_VALUE', '$.elements[1].render_order']]);
  });
});

describe('material alpha (Blockbench texture.frag.glsl)', () => {
  it('every bbmodel material blends with alpha cutoff 0.01', () => {
    const { scene } = loadBbmodel(json(model({ textures: [{ name: 'a' }, { name: 'b' }] })));
    expect(scene.materials).toEqual([
      { name: 'a', texture: 0, alphaMode: 'blend', alphaCutoff: 0.01 },
      { name: 'b', texture: 1, alphaMode: 'blend', alphaCutoff: 0.01 },
    ]);
  });
});

describe('mesh face texture (Blockbench mesh updateFaces)', () => {
  it('texture null draws the face untextured, unlike a cube face', () => {
    const faces = { f: meshFace(['a', 'b', 'c'], { texture: null }) };
    const { scene } = loadBbmodel(json(model({ textures: [{ name: 't' }], elements: [mesh({ faces })] })));
    expect(scene.meshes[0]?.groups).toEqual([{ material: -1, start: 0, count: 3, doubleSided: true }]);
  });

  it('a texture uuid resolves like a cube face’s', () => {
    const faces = { f: meshFace(['a', 'b', 'c'], { texture: 't-b' }) };
    const textures = [
      { name: 'a', uuid: 't-a' },
      { name: 'b', uuid: 't-b' },
    ];
    const { scene } = loadBbmodel(json(model({ textures, elements: [mesh({ faces })] })));
    expect(scene.meshes[0]?.groups[0]?.material).toBe(1);
  });
});

describe('mesh shading (Blockbench Mesh.shading)', () => {
  const vertices = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [0, 0, -1] };
  const faces = { f: meshFace(['a', 'b', 'c']), g: meshFace(['a', 'c', 'd']) };
  const sharedNormal = (shading: unknown) => {
    const element = mesh(shading === undefined ? { vertices, faces } : { vertices, faces, shading });
    const result = loadBbmodel(json(model({ elements: [element] })));
    const normals = result.scene.meshes[0]?.normals ?? new Float32Array(0);
    return { normal: [...normals.slice(0, 3)].map((x) => Math.round(x * 1e6) / 1e6 || 0), warnings: result.warnings };
  };

  it('absent and flat keep face normals; smooth averages them per vertex key', () => {
    expect(sharedNormal(undefined).normal).toEqual([0, 0, 1]);
    expect(sharedNormal('flat').normal).toEqual([0, 0, 1]);
    const r = Math.round(Math.SQRT1_2 * 1e6) / 1e6;
    expect(sharedNormal('smooth').normal).toEqual([-r, 0, r]);
  });

  it('an unknown value warns and counts as flat', () => {
    const { normal, warnings } = sharedNormal('phong');
    expect(normal).toEqual([0, 0, 1]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_VALUE', '$.elements[0].shading']]);
  });
});
