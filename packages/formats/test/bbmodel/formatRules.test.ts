import { describe, expect, it } from 'vitest';
import { loadBbmodel, type BbmodelLimits } from '../../src/index';
import { cube, mesh, meshFace, model, pngDataUri } from './fixtures';

const json = (value: unknown): string => JSON.stringify(value);
/** Plugin formats with Blockbench `single_texture` (MS-51, plugin sources of 2026-10-22). */
const PLUGIN_SINGLE = [
  'geckolib_model',
  'animated_entity_model',
  'azure_model',
  'cosmic_reach_entity_model',
  'optifine_player_model',
];
/** Plugin formats that set no texture flag: per-face textures and the project resolution. */
const PLUGIN_PER_FACE = ['bamo_model', 'free_rotation', 'java_block_sequence', 'cosmic_reach_model', 'eme_entity'];
const HYTALE = ['hytale_character', 'hytale_prop'];
const COLLECTION = [{ name: 'c', uuid: 'k0', children: [] }];
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

  it.each(['bedrock', 'java_block', 'modded_entity', 'unknown-format', ...PLUGIN_SINGLE, ...PLUGIN_PER_FACE])(
    'uses the project resolution in %s and ignores the per-texture fields',
    (format) => {
      const ignored = [{ name: 't', uv_width: 0, uv_height: 'x' }];
      const { scene } = loadBbmodel(
        json(model({ meta: meta(format), textures: ignored, resolution: { width: 64, height: 32 } })),
      );
      expect(scene.textures[0]).toMatchObject({ uvWidth: 64, uvHeight: 32 });
    },
  );

  it.each(['image', 'optifine_entity', 'optifine_part', 'figura', ...HYTALE])(
    'applies uv_width/uv_height in %s too',
    (format) => {
      const { scene } = loadBbmodel(json(model({ meta: meta(format), textures })));
      expect(scene.textures[0]).toMatchObject({ uvWidth: 32, uvHeight: 64 });
    },
  );

  it.each(['image', 'optifine_entity', 'figura', 'hytale_prop'])(
    '%s: a bad uv size warns and uses the resolution (read since MS-29)',
    (format) => {
      const bad = [{ name: 't', uv_width: 0, uv_height: 'x' }];
      const { scene, warnings } = loadBbmodel(
        json(model({ meta: meta(format), textures: bad, resolution: { width: 64, height: 32 } })),
      );
      expect(scene.textures[0]).toMatchObject({ uvWidth: 64, uvHeight: 32 });
      expect(warnings.filter((w) => w.code === 'UNSUPPORTED_VALUE').map((w) => w.path)).toEqual([
        '$.textures[0].uv_width',
        '$.textures[0].uv_height',
      ]);
    },
  );

  it('optifine: face UVs use the UV size of the texture shown (group texture), not the stored one', () => {
    const list = [
      { name: 'a', uuid: 't-a', uv_width: 16, uv_height: 16 },
      { name: 'b', uuid: 't-b', uv_width: 64, uv_height: 32 },
    ];
    const north = { uv: [0, 0, 16, 16], texture: 0 };
    const outliner = [{ name: 'g', uuid: 'g0', texture: 't-b', children: ['c0'] }];
    const text = json(
      model({ meta: meta('optifine_entity'), textures: list, elements: [cube({ faces: { north } })], outliner }),
    );
    expect(northRect(text, 64, 32)).toEqual([0, 0, 16, 16]);
    expect(loadBbmodel(text).scene.meshes[0]?.groups[0]?.material).toBe(1);
  });

  it.each(HYTALE)('%s: cube face UVs use the UV size of the texture shown, with and without collections', (format) => {
    const list = [
      { name: 'a', uuid: 't-a', uv_width: 16, uv_height: 16 },
      { name: 'b', uuid: 't-b', uv_width: 64, uv_height: 32 },
    ];
    const north = { uv: [0, 0, 8, 8], texture: 1 };
    const text = (extra: Record<string, unknown> = {}) =>
      json(
        model({
          meta: meta(format),
          resolution: { width: 32, height: 32 },
          textures: list,
          elements: [cube({ faces: { north } })],
          ...extra,
        }),
      );
    const material = (value: string) => loadBbmodel(value).scene.meshes[0]?.groups[0]?.material;
    // Without collections the face shows the default texture (16x16), neither the stored one nor the resolution.
    expect(northRect(text(), 16, 16)).toEqual([0, 0, 8, 8]);
    expect(material(text())).toBe(0);
    // A cube in no collection shows the default texture as well.
    const outside = text({ collections: COLLECTION });
    expect(northRect(outside, 16, 16)).toEqual([0, 0, 8, 8]);
    expect(material(outside)).toBe(0);
    // A cube in a collection shows the collection's texture in its UV space, whatever the face stores.
    const inA = text({ collections: [{ uuid: 'k0', children: ['c0'], texture: 't-a' }] });
    expect(northRect(inA, 16, 16)).toEqual([0, 0, 8, 8]);
    expect(material(inA)).toBe(0);
    const inB = text({ collections: [{ uuid: 'k0', children: ['c0'], texture: 't-b' }] });
    expect(northRect(inB, 64, 32)).toEqual([0, 0, 8, 8]);
    expect(material(inB)).toBe(1);
    // A collection without a texture leaves the face untextured, its UVs over the project resolution.
    const untextured = text({ collections: [{ uuid: 'k0', children: ['c0'], texture: '' }] });
    expect(northRect(untextured, 32, 32)).toEqual([0, 0, 8, 8]);
    expect(material(untextured)).toBe(-1);
  });

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

  it.each(['modded_entity', ...HYTALE])('keeps fractional sizes in %s', (format) => {
    expect(northRect(boxModel(format, [0, 0, 0], [4.5, 2, 1]), 64, 64)).toEqual([1, 1, 5.5, 3]);
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

describe('format version gates of Blockbench project import (js/formats/bbmodel.js)', () => {
  const grouped = (version: string) =>
    json(
      model({
        meta: { format_version: version, model_format: 'free' },
        outliner: [{ name: 'g', uuid: 'g', origin: [0, 0, 0], rotation: [10, 20, 30], children: ['c0'] }],
      }),
    );

  it.each([
    ['3.1', [10, 20, -30]],
    ['3.0', [10, 20, -30]],
    ['3.2', [10, 20, 30]],
    ['4.5', [10, 20, 30]],
  ])('format %s: group rotation %j (z negated before 3.2)', (version, rotation) => {
    expect(loadBbmodel(grouped(version)).scene.nodes[0]?.rotation).toEqual(rotation);
  });

  const boxCube = (version: string, extra: Record<string, unknown>, boxUv = true) =>
    json(
      model({
        meta: meta('modded_entity', { format_version: version, box_uv: boxUv }),
        resolution: { width: 64, height: 64 },
        elements: [cube({ from: [0, 0, 0], to: [3, 2, 1], faces: { north: {} }, ...extra })],
      }),
    );

  const uvs = (text: string): number[] => [...(loadBbmodel(text).scene.meshes[0]?.uvs ?? [])];

  it('reads `shade: false` of a box-UV cube before 4.5 as mirrored UV', () => {
    const mirrored = uvs(boxCube('4.5', { mirror_uv: true }));
    const plain = uvs(boxCube('4.5', {}));
    expect(mirrored).not.toEqual(plain);
    expect(uvs(boxCube('4.4', { shade: false }))).toEqual(mirrored);
    expect(uvs(boxCube('3.6', { shade: false }))).toEqual(mirrored);
    expect(uvs(boxCube('4.4', { shade: true }))).toEqual(plain);
    expect(uvs(boxCube('4.5', { shade: false }))).toEqual(plain);
  });

  it('leaves `shade: false` alone in a project without box UV (a cube may still opt into box UV)', () => {
    const own = { box_uv: true, shade: false };
    expect(uvs(boxCube('4.4', own, false))).toEqual(uvs(boxCube('4.5', { box_uv: true })));
  });
});

describe('texture render_mode (Blockbench texture shader)', () => {
  const modeModel = (modelFormat: string, renderMode: unknown) =>
    json(
      model({
        meta: meta(modelFormat),
        textures: [renderMode === undefined ? { name: 't' } : { name: 't', render_mode: renderMode }],
      }),
    );
  const load = (modelFormat: string, renderMode: unknown) => {
    const { scene, warnings } = loadBbmodel(modeModel(modelFormat, renderMode));
    return { materials: scene.materials, warnings: warnings.filter((w) => w.code === 'UNSUPPORTED_VALUE') };
  };
  const DEFAULT = { name: 't', texture: 0, alphaMode: 'blend', alphaCutoff: 0.01 };

  it.each<[string, unknown, Record<string, unknown>]>([
    ['default', 'default', DEFAULT],
    [
      'emissive: kept texels opaque, alpha splits reflected and emitted light',
      'emissive',
      { ...DEFAULT, alphaMode: 'mask', alphaEmission: true },
    ],
    ['additive', 'additive', { ...DEFAULT, blending: 'additive' }],
  ])('%s', (_name, renderMode, material) => {
    expect(load('free', renderMode)).toEqual({ materials: [material], warnings: [] });
  });

  it('absent adds no key (a file without render modes loads as before)', () => {
    expect(load('free', undefined).materials.map((m) => Object.keys(m))).toEqual([
      ['name', 'texture', 'alphaMode', 'alphaCutoff'],
    ]);
  });

  it.each(['free', 'java_block', 'unknown-format'])('layered draws as default in %s', (format) => {
    const textures = [{ name: 't' }, { name: 'u', render_mode: 'layered' }];
    const element = cube({ faces: { up: { uv: [0, 0, 1, 1], texture: 0 }, down: { uv: [0, 0, 1, 1], texture: 1 } } });
    const { scene } = loadBbmodel(json(model({ meta: meta(format), textures, elements: [element] })));
    expect(scene.materials).toEqual([DEFAULT, { ...DEFAULT, name: 'u', texture: 1 }]);
    expect(scene.meshes[0]?.groups.map((g) => g.material)).toEqual([0, 1]);
  });

  it.each<[string, unknown]>([
    ['an unknown string', 'glow'],
    ['a number', 3],
    ['null', null],
    ['an object', { mode: 'emissive' }],
    ['a 10 000-character string', 'e'.repeat(10_000)],
  ])('%s warns once and counts as default', (_name, renderMode) => {
    const { materials, warnings } = load('free', renderMode);
    expect(materials).toEqual([DEFAULT]);
    expect(warnings.map((w) => w.path)).toEqual(['$.textures[0].render_mode']);
    expect(warnings[0]?.message.length).toBeLessThan(200);
    expect(warnings[0]?.message).not.toMatch(/e{33}/);
  });
});

describe('layered textures (Blockbench Canvas.getLayeredMaterial)', () => {
  const LAYERED_FORMATS = [
    'bedrock',
    'bedrock_old',
    'modded_entity',
    'skin',
    'image',
    'bedrock_block',
    'optifine_entity',
    'optifine_part',
    ...PLUGIN_SINGLE,
    'hytale_prop',
  ];
  const texture = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });
  const elements = [
    cube({
      faces: {
        north: { uv: [0, 0, 1, 1], texture: 0 },
        south: { uv: [0, 0, 1, 1], texture: 1 },
        up: { uv: [0, 0, 1, 1] },
        down: { uv: [0, 0, 1, 1], texture: null },
      },
    }),
    mesh({
      uuid: 'm0',
      faces: { f: meshFace(['a', 'b', 'c'], { texture: 0 }), g: meshFace(['a', 'c', 'd'], { texture: null }) },
    }),
  ];
  const load = (modelFormat: string, textures: unknown[], root: Record<string, unknown> = {}) =>
    loadBbmodel(json(model({ meta: meta(modelFormat), textures, elements, outliner: ['c0', 'm0'], ...root })));
  const two = [texture('base', { render_sides: 'front' }), texture('top', { render_mode: 'layered' })];
  const layeredCases: [string, Record<string, unknown>][] = [
    ...LAYERED_FORMATS.map((format): [string, Record<string, unknown>] => [format, {}]),
    ['hytale_prop', { collections: COLLECTION }],
  ];

  it.each(layeredCases)('%s %j: every drawn face uses one appended composite, sided as the format', (format, root) => {
    const { scene } = load(format, two, root);
    expect(scene.materials).toHaveLength(3);
    expect(scene.materials[2]).toEqual({
      name: 'layered',
      texture: 0,
      alphaMode: 'blend',
      alphaCutoff: 0.05,
      layers: [0, 1],
    });
    // The cube's null face stays dropped (3 faces); the mesh's null face is drawn, with the composite too.
    expect(scene.meshes.map((m) => m.groups)).toEqual([
      [{ material: 2, start: 0, count: 18, doubleSided: true }],
      [{ material: 2, start: 0, count: 6, doubleSided: true }],
    ]);
  });

  it.each(['free', 'java_block', 'figura', 'eme_entity'])('%s: no composite, faces keep their textures', (format) => {
    const { scene } = load(format, two);
    expect(scene.materials).toHaveLength(2);
    expect(scene.meshes[0]?.groups.map((g) => g.material)).toEqual([-1, 0, 1]);
  });

  it('needs two or more textures', () => {
    const textures = [texture('only', { render_mode: 'layered' })];
    const { scene } = loadBbmodel(json(model({ meta: meta('bedrock'), textures })));
    expect(scene.materials).toEqual([{ name: 'only', texture: 0, alphaMode: 'blend', alphaCutoff: 0.01 }]);
    expect(scene.meshes[0]?.groups.map((g) => g.material)).toEqual([0]);
  });

  it('needs a layered texture', () => {
    expect(load('bedrock', [texture('a'), texture('b', { render_mode: 'emissive' })]).scene.materials).toHaveLength(2);
  });

  it('stacks the last three visible textures, bottom first; a hidden one is skipped', () => {
    const textures = ['a', 'b', 'c', 'd', 'e'].map((name) => texture(name, { render_mode: 'layered' }));
    expect(load('bedrock', textures).scene.materials[5]?.layers).toEqual([2, 3, 4]);
    textures[3] = texture('d', { render_mode: 'layered', visible: false });
    expect(load('bedrock', textures).scene.materials[5]?.layers).toEqual([1, 2, 4]);
  });

  it('no visible texture: no composite, and no default texture', () => {
    const hidden = { visible: false };
    const textures = [texture('a', hidden), texture('b', { render_mode: 'layered', ...hidden })];
    const { scene } = load('bedrock', textures);
    expect(scene.materials).toHaveLength(2);
    expect(scene.meshes[0]?.groups.map((g) => g.material)).toEqual([-1]);
  });

  it('a non-boolean visible warns and counts as visible', () => {
    const textures = [texture('a'), texture('b', { render_mode: 'layered', visible: 'no' })];
    const { scene, warnings } = load('bedrock', textures);
    expect(scene.materials[2]?.layers).toEqual([0, 1]);
    expect(warnings.filter((w) => w.code === 'UNSUPPORTED_VALUE').map((w) => w.path)).toEqual([
      '$.textures[1].visible',
    ]);
  });

  it('material i still shows texture i', () => {
    const textures = ['a', 'b', 'c', 'd'].map((name) => texture(name, { render_mode: 'layered' }));
    const { scene } = load('bedrock', textures);
    expect(scene.materials).toHaveLength(5);
    scene.textures.forEach((_, i) => expect(scene.materials[i]?.texture).toBe(i));
  });

  it('a face keeps the frame division of the texture it shows', () => {
    // The default texture is the last visible one (the 4-frame strip); with the strip hidden, the plain first texture.
    const strip = { name: 'strip', render_mode: 'layered', source: pngDataUri(16, 64) };
    const plain = { name: 'plain', source: pngDataUri(16, 16) };
    const face = { uv: [0, 0, 16, 16], texture: 0 };
    const rect = (textures: unknown[]) => {
      const text = json(model({ meta: meta('bedrock'), textures, elements: [cube({ faces: { north: face } })] }));
      return [...(loadBbmodel(text).scene.meshes[0]?.uvRects.slice(0, 4) ?? [])];
    };
    expect(rect([plain, strip])).toEqual([0, 0, 1, 0.25]);
    expect(rect([plain, { ...strip, visible: false }])).toEqual([0, 0, 1, 1]);
  });
});

describe('default texture (Blockbench Face.getTexture, Texture.getDefault)', () => {
  const faces = {
    north: { uv: [0, 0, 16, 16], texture: 1 },
    south: { uv: [0, 0, 16, 16] },
    up: { uv: [0, 0, 16, 16], texture: false },
    down: { uv: [0, 0, 16, 16], texture: null },
  };
  const textures = (fields: Record<string, unknown>[] = [{}, {}]) =>
    fields.map((extra, i) => ({ name: `t${i}`, uuid: `t-${i}`, ...extra }));
  const load = (
    modelFormat: string,
    list = textures(),
    outliner: unknown[] = ['c0'],
    root: Record<string, unknown> = {},
  ) => {
    const text = json(
      model({ meta: meta(modelFormat), textures: list, elements: [cube({ faces })], outliner, ...root }),
    );
    const { scene, warnings } = loadBbmodel(text);
    return { groups: scene.meshes.map((m) => m.groups.map((g) => [g.material, g.count / 6])), warnings };
  };
  const grouped = (texture: unknown) => [{ name: 'g', uuid: 'g0', texture, children: ['c0'] }];

  it.each(['bedrock', 'bedrock_old', 'modded_entity', 'skin', 'image', ...PLUGIN_SINGLE])(
    '%s: every non-null face shows the first texture',
    (format) => {
      expect(load(format).groups).toEqual([[[0, 3]]]);
    },
  );

  it('bedrock_block: blank faces show the default texture, indexed faces their own', () => {
    expect(load('bedrock_block').groups).toEqual([
      [
        [0, 2],
        [1, 1],
      ],
    ]);
    expect(load('bedrock_block', textures([{}, { use_as_default: true }])).groups).toEqual([[[1, 3]]]);
  });

  it.each(['optifine_entity', 'optifine_part'])(
    '%s: every face shows the default texture, unless its group sets one',
    (format) => {
      expect(load(format).groups).toEqual([[[0, 3]]]);
      expect(load(format, textures([{}, { use_as_default: true }])).groups).toEqual([[[1, 3]]]);
      expect(load(format, textures(), grouped('t-1')).groups).toEqual([[[1, 3]]]);
    },
  );

  it('optifine: a group texture naming no texture warns and leaves its faces untextured', () => {
    const { groups, warnings } = load('optifine_entity', textures(), grouped('nope'));
    expect(groups).toEqual([[[-1, 3]]]);
    expect(warnings.map((w) => [w.code, w.path])).toContainEqual(['UNKNOWN_REFERENCE', '$.outliner[0].texture']);
  });

  it('optifine: a non-string group texture warns and is ignored', () => {
    const { groups, warnings } = load('optifine_entity', textures(), grouped(7));
    expect(groups).toEqual([[[0, 3]]]);
    expect(warnings.map((w) => [w.code, w.path])).toContainEqual(['UNSUPPORTED_VALUE', '$.outliner[0].texture']);
  });

  it('a group texture is ignored outside per-group formats', () => {
    expect(load('bedrock', textures(), grouped('t-1')).groups).toEqual([[[0, 3]]]);
    expect(load('free', textures(), grouped(7)).warnings).toEqual(load('free').warnings);
  });

  it.each(['free', 'java_block', ...PLUGIN_PER_FACE, 'figura'])('%s: faces keep what they store', (format) => {
    expect(load(format).groups).toEqual([
      [
        [-1, 2],
        [1, 1],
      ],
    ]);
  });

  it('without textures, faces stay untextured', () => {
    const blank = { uv: [0, 0, 16, 16] };
    const text = json(model({ meta: meta('bedrock'), elements: [cube({ faces: { north: blank, up: blank } })] }));
    expect(loadBbmodel(text).scene.meshes[0]?.groups.map((g) => g.material)).toEqual([-1]);
  });

  it('a mesh face with texture null draws with the default texture in single formats, untextured elsewhere', () => {
    const element = mesh({
      faces: { f: meshFace(['a', 'b', 'c'], { texture: null }), g: meshFace(['a', 'c', 'd'], { texture: 1 }) },
    });
    const materials = (format: string) => {
      const text = json(model({ meta: meta(format), textures: textures(), elements: [element] }));
      return loadBbmodel(text).scene.meshes[0]?.groups.map((g) => [g.material, g.count / 3]);
    };
    expect(materials('bedrock')).toEqual([[0, 2]]);
    expect(materials('bedrock_block')).toEqual([
      [-1, 1],
      [1, 1],
    ]);
    expect(materials('free')).toEqual([
      [-1, 1],
      [1, 1],
    ]);
  });

  it('a mesh face with texture null keeps project-resolution UVs and no frame division in single formats', () => {
    const list = [{ name: 'strip', source: pngDataUri(16, 64) }];
    const face = meshFace(['a', 'b', 'c'], { texture: null, uv: { a: [0, 0], b: [16, 0], c: [16, 16] } });
    const text = json(model({ meta: meta('bedrock'), textures: list, elements: [mesh({ faces: { f: face } })] }));
    const sceneMesh = loadBbmodel(text).scene.meshes[0];
    expect(sceneMesh?.groups[0]?.material).toBe(0);
    expect([...(sceneMesh?.uvRects.slice(0, 4) ?? [])]).toEqual([0, 0, 1, 1]);
  });

  it('optifine: a mesh face with texture null shows its group texture', () => {
    const element = mesh({ faces: { f: meshFace(['a', 'b', 'c'], { texture: null }) } });
    const outliner = [{ name: 'g', uuid: 'g0', texture: 't-1', children: ['c0'] }];
    const text = json(model({ meta: meta('optifine_entity'), textures: textures(), elements: [element], outliner }));
    expect(loadBbmodel(text).scene.meshes[0]?.groups.map((g) => g.material)).toEqual([1]);
  });

  it('a non-boolean use_as_default warns and counts as false', () => {
    const { groups, warnings } = load('bedrock_block', textures([{}, { use_as_default: 'yes' }]));
    expect(groups).toEqual([
      [
        [0, 2],
        [1, 1],
      ],
    ]);
    expect(warnings.filter((w) => w.code === 'UNSUPPORTED_VALUE').map((w) => w.path)).toEqual([
      '$.textures[1].use_as_default',
    ]);
  });

  it.each(['bedrock', ...PLUGIN_SINGLE])('use_as_default is ignored in %s (single_texture only)', (format) => {
    expect(load(format, textures([{}, { use_as_default: true }])).groups).toEqual([[[0, 3]]]);
  });

  it.each(HYTALE)('%s without collections: every non-null face shows the default texture', (format) => {
    expect(load(format).groups).toEqual([[[0, 3]]]);
    // single_texture_default holds as well, so use_as_default picks the default texture.
    expect(load(format, textures([{}, { use_as_default: true }])).groups).toEqual([[[1, 3]]]);
  });

  it.each(HYTALE)(
    '%s with collections: a cube outside every collection shows the default texture on every non-null face',
    (format) => {
      const root = { collections: COLLECTION };
      expect(load(format, textures(), ['c0'], root).groups).toEqual([[[0, 3]]]);
      expect(load(format, textures([{}, { use_as_default: true }]), ['c0'], root).groups).toEqual([[[1, 3]]]);
    },
  );

  describe.each(HYTALE)('%s: a cube in a collection (hytale_plugin.js:1283-1302)', (format) => {
    const collection = (extra: Record<string, unknown>) => ({ name: 'c', uuid: 'k0', ...extra });
    const nested = [{ name: 'g', uuid: 'g0', children: [{ name: 'h', uuid: 'h0', children: ['c0'] }] }];
    const scoped = (scope: number) => ({ elements: [cube({ faces, scope })] });
    const own = (warnings: readonly { code: string; path: string }[]) =>
      warnings.filter((w) => w.path.startsWith('$.collections')).map((w) => [w.code, w.path]);

    it('by its uuid shows the collection texture on every non-null face', () => {
      const root = { collections: [collection({ children: ['c0'], texture: 't-1' })] };
      const { groups, warnings } = load(format, textures(), ['c0'], root);
      expect(groups).toEqual([[[1, 3]]]);
      expect(own(warnings)).toEqual([]);
    });

    it('by an ancestor group uuid', () => {
      const root = { collections: [collection({ children: ['g0'], texture: 't-1' })] };
      expect(load(format, textures(), nested, root).groups).toEqual([[[1, 3]]]);
    });

    it('by an equal non-zero scope, never by scope 0', () => {
      const withScope = (scope: number) => ({
        ...scoped(scope),
        collections: [collection({ children: [], scope, texture: 't-1' })],
      });
      expect(load(format, textures(), ['c0'], withScope(2)).groups).toEqual([[[1, 3]]]);
      expect(load(format, textures(), ['c0'], withScope(0)).groups).toEqual([[[0, 3]]]);
      const other = { ...scoped(3), collections: [collection({ scope: 2, texture: 't-1' })] };
      expect(load(format, textures(), ['c0'], other).groups).toEqual([[[0, 3]]]);
    });

    it('the first collection in file order that contains it wins', () => {
      const first = (a: string, b: string) => ({
        collections: [
          collection({ children: ['g0'], texture: a }),
          collection({ uuid: 'k1', children: ['c0'], texture: b }),
        ],
      });
      expect(load(format, textures(), nested, first('t-1', 't-0')).groups).toEqual([[[1, 3]]]);
      expect(load(format, textures(), nested, first('t-0', 't-1')).groups).toEqual([[[0, 3]]]);
    });

    it.each([{}, { texture: '' }])('a collection with %j leaves its cubes untextured', (extra) => {
      const root = { collections: [collection({ children: ['c0'], ...extra })] };
      const { groups, warnings } = load(format, textures(), ['c0'], root);
      expect(groups).toEqual([[[-1, 3]]]);
      expect(own(warnings)).toEqual([]);
    });

    it('an unknown texture uuid warns UNKNOWN_REFERENCE and leaves its cubes untextured', () => {
      const root = { collections: [collection({ children: ['c0'], texture: 'nope' })] };
      const { groups, warnings } = load(format, textures(), ['c0'], root);
      expect(groups).toEqual([[[-1, 3]]]);
      expect(own(warnings)).toEqual([['UNKNOWN_REFERENCE', '$.collections[0].texture']]);
    });

    it('a texture, children or scope of the wrong type warns UNSUPPORTED_VALUE and is ignored', () => {
      const root = {
        collections: [
          collection({ children: ['c0'], texture: 1 }),
          collection({ uuid: 'k1', children: 'c0', scope: 'x' }),
        ],
      };
      const { groups, warnings } = load(format, textures(), ['c0'], root);
      expect(groups).toEqual([[[-1, 3]]]);
      expect(own(warnings)).toEqual([
        ['UNSUPPORTED_VALUE', '$.collections[0].texture'],
        ['UNSUPPORTED_VALUE', '$.collections[1].children'],
        ['UNSUPPORTED_VALUE', '$.collections[1].scope'],
      ]);
    });

    describe('scope reads like Blockbench Merge.number (util.js:401-413)', () => {
      const scopes = (collectionScope: unknown, cubeScope: unknown) => {
        const root = {
          elements: [cube({ faces, scope: cubeScope })],
          collections: [collection({ scope: collectionScope, texture: 't-1' })],
        };
        const { groups, warnings } = load(format, textures(), ['c0'], root);
        const scopeWarnings = warnings.filter((w) => w.path.endsWith('.scope')).map((w) => [w.code, w.path]);
        return { groups, scopeWarnings };
      };

      it.each([
        ['2', 2],
        [2, '2'],
        ['2', '2'],
        [' 2abc', '2.0'],
        ['1e999', 'Infinity'],
      ])('a collection scope %j matches a cube scope %j, without a warning', (collectionScope, cubeScope) => {
        expect(scopes(collectionScope, cubeScope)).toEqual({ groups: [[[1, 3]]], scopeWarnings: [] });
      });

      it.each([
        ['x', 2, ['$.collections[0].scope']],
        [2, 'x', ['$.elements[0].scope']],
        ['x', 'x', ['$.collections[0].scope', '$.elements[0].scope']],
        ['', '', ['$.collections[0].scope', '$.elements[0].scope']],
        [[2], true, ['$.collections[0].scope', '$.elements[0].scope']],
      ])(
        'collection scope %j, cube scope %j: no number, warns and matches nothing',
        (collectionScope, cubeScope, paths) => {
          expect(scopes(collectionScope, cubeScope)).toEqual({
            groups: [[[0, 3]]],
            scopeWarnings: paths.map((path) => ['UNSUPPORTED_VALUE', path]),
          });
        },
      );

      it.each([
        [null, null],
        ['0', '0'],
      ])('collection scope %j, cube scope %j: no scope, no warning', (collectionScope, cubeScope) => {
        expect(scopes(collectionScope, cubeScope)).toEqual({ groups: [[[0, 3]]], scopeWarnings: [] });
      });

      it('a mesh scope is not read', () => {
        const element = mesh({ scope: 'x' });
        const text = json(
          model({ meta: meta(format), elements: [element], collections: [collection({ scope: 'x' })] }),
        );
        expect(loadBbmodel(text).warnings.map((w) => w.path)).toEqual(['$.collections[0].scope']);
      });
    });

    it('children that are no uuid string are skipped without a warning', () => {
      const children = [5, null, {}, '', 'A'.repeat(5000), 'c0'];
      const root = { collections: [collection({ children, texture: 't-1' })] };
      const { groups, warnings } = load(format, textures(), ['c0'], root);
      expect(groups).toEqual([[[1, 3]]]);
      expect(own(warnings)).toEqual([]);
    });

    it.each([[null], [5], ['x'], [[]]])('an entry %j warns, counts as an empty collection and still loads', (entry) => {
      const { groups, warnings } = load(format, textures(), ['c0'], { collections: [entry] });
      expect(groups).toEqual([[[0, 3]]]);
      expect(own(warnings)).toEqual([['UNSUPPORTED_VALUE', '$.collections[0]']]);
      // It still counts as a collection: a mesh face with texture null is no longer drawn with the default texture.
      const element = mesh({ faces: { f: meshFace(['a', 'b', 'c'], { texture: null }) } });
      const text = json(model({ meta: meta(format), textures: textures(), elements: [element], collections: [entry] }));
      expect(loadBbmodel(text).scene.meshes[0]?.groups.map((g) => g.material)).toEqual([-1]);
    });
  });

  it('collections are not read outside the Hytale formats', () => {
    const collections = [null, { children: ['c0'], texture: 'nope', scope: 'x' }];
    for (const format of ['bedrock', 'bedrock_block', 'free', 'optifine_entity']) {
      const { groups, warnings } = load(format, textures(), ['c0'], { collections });
      expect({ groups, warnings }).toEqual(load(format));
    }
  });

  it.each(HYTALE.flatMap((format) => [[], {}, 'x', null].map((value): [string, unknown] => [format, value])))(
    '%s: collections %j count as none, without a warning',
    (format, collections) => {
      const { groups, warnings } = load(format, textures(), ['c0'], { collections });
      expect(groups).toEqual([[[0, 3]]]);
      expect(warnings).toEqual(load(format).warnings);
    },
  );

  it.each(HYTALE)(
    '%s: a mesh face with texture null draws with the default texture only without collections',
    (format) => {
      const element = mesh({
        faces: { f: meshFace(['a', 'b', 'c'], { texture: null }), g: meshFace(['a', 'c', 'd'], { texture: 1 }) },
      });
      const materials = (root: Record<string, unknown>) => {
        const text = json(model({ meta: meta(format), textures: textures(), elements: [element], ...root }));
        return loadBbmodel(text).scene.meshes[0]?.groups.map((g) => [g.material, g.count / 3]);
      };
      expect(materials({})).toEqual([[0, 2]]);
      expect(materials({ collections: COLLECTION })).toEqual([
        [-1, 1],
        [1, 1],
      ]);
      // The plugin replaces only the cube face lookup: a mesh in a collection keeps Face.getTexture.
      expect(materials({ collections: [{ uuid: 'k0', children: ['c0'], texture: 't-0' }] })).toEqual([
        [-1, 1],
        [1, 1],
      ]);
    },
  );

  it('frames follow the default texture', () => {
    const list = [
      { name: 'strip', source: pngDataUri(16, 64) },
      { name: 'still', source: pngDataUri(16, 16) },
    ];
    const north = { uv: [0, 0, 16, 16], texture: 1 };
    const text = json(model({ meta: meta('bedrock'), textures: list, elements: [cube({ faces: { north } })] }));
    expect([...(loadBbmodel(text).scene.meshes[0]?.uvRects.slice(0, 4) ?? [])]).toEqual([0, 0, 1, 0.25]);
  });
});
