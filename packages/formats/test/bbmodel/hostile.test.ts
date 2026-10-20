import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubeToMesh } from '../../src/bbmodel/cubeToMesh';
import { meshElementToMesh } from '../../src/bbmodel/meshToMesh';
import { decodeDataUri } from '../../src/dataUri/decodeDataUri';
import { BbmodelError, loadBbmodel, type BbmodelErrorCode, type BbmodelLoadOptions } from '../../src/index';
import { cube, mesh, meshFace, model, pngDataUri } from './fixtures';

// Spies on the two places that allocate buffers proportional to the input: geometry and texture bytes.
vi.mock('../../src/bbmodel/cubeToMesh', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/bbmodel/cubeToMesh')>();
  return { cubeToMesh: vi.fn(original.cubeToMesh) };
});
vi.mock('../../src/bbmodel/meshToMesh', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/bbmodel/meshToMesh')>();
  return { meshElementToMesh: vi.fn(original.meshElementToMesh) };
});
vi.mock('../../src/dataUri/decodeDataUri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/dataUri/decodeDataUri')>();
  return { decodeDataUri: vi.fn(original.decodeDataUri) };
});

const LONG = 'A'.repeat(40);

function failure(input: string | Uint8Array, options?: BbmodelLoadOptions): BbmodelError {
  try {
    loadBbmodel(input, options);
  } catch (error) {
    if (error instanceof BbmodelError) return error;
    throw new Error(`expected a BbmodelError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected loading to fail');
}

/** Code and path as expected, a short message, and no run of file content longer than 32 characters in it. */
function expectFailure(
  input: string | Uint8Array,
  code: BbmodelErrorCode,
  path: string,
  options?: BbmodelLoadOptions,
): BbmodelError {
  const error = failure(input, options);
  expect({ code: error.code, path: error.path }).toEqual({ code, path });
  expect(error.message.length).toBeLessThan(200);
  expect(error.message).not.toMatch(/A{33}/);
  expect(error.message).toContain(code === 'NOT_JSON' ? 'Not JSON' : ' at ');
  return error;
}

const json = (value: unknown): string => JSON.stringify(value);

function nestedGroups(depth: number): unknown {
  let node: unknown = 'c0';
  for (let i = 0; i < depth; i++) node = { name: 'g', children: [node] };
  return [node];
}

function nestedGroupsJson(depth: number): string {
  // Built as text: a 100 000-deep object would overflow JSON.stringify's recursion.
  return `{"meta":{"format_version":"4.5"},"elements":[${json(cube())}],"outliner":[${'{"children":['.repeat(depth)}"c0"${']}'.repeat(depth)}]}`;
}

beforeEach(() => {
  vi.mocked(cubeToMesh).mockClear();
  vi.mocked(meshElementToMesh).mockClear();
  vi.mocked(decodeDataUri).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hostile files fail fast with a coded error', () => {
  it.each<[string, string | Uint8Array, BbmodelErrorCode, string]>([
    ['empty text', '', 'NOT_JSON', '$'],
    ['empty bytes', new Uint8Array(0), 'NOT_JSON', '$'],
    ['not JSON', 'model { cubes }', 'NOT_JSON', '$'],
    ['invalid UTF-8', new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), 'NOT_JSON', '$'],
    ['JSON null', 'null', 'NOT_BBMODEL', '$'],
    ['JSON array', '[]', 'NOT_BBMODEL', '$'],
    ['JSON string', json(LONG), 'NOT_BBMODEL', '$'],
    ['missing meta', json({ elements: [] }), 'NOT_BBMODEL', '$.meta'],
    ['missing format version', json({ meta: {} }), 'NOT_BBMODEL', '$.meta.format_version'],
    ['version 9.0', json(model({ meta: { format_version: '9.0' } })), 'UNSUPPORTED_VERSION', '$.meta.format_version'],
    ['version 2.0', json(model({ meta: { format_version: '2.0' } })), 'UNSUPPORTED_VERSION', '$.meta.format_version'],
    ['long version', json(model({ meta: { format_version: LONG } })), 'INVALID_FIELD', '$.meta.format_version'],
    [
      'from as string',
      json(model({ elements: [cube({ from: ['x', 0, 0] })] })),
      'INVALID_FIELD',
      '$.elements[0].from[0]',
    ],
    [
      'from 1e999',
      '{"meta":{"format_version":"4.5"},"elements":[{"from":[1e999,0,0],"to":[1,1,1],"faces":{}}]}',
      'INVALID_FIELD',
      '$.elements[0].from[0]',
    ],
    [
      'from with 2 components',
      json(model({ elements: [cube({ from: [0, 0] })] })),
      'INVALID_FIELD',
      '$.elements[0].from',
    ],
    [
      'from huge but finite',
      json(model({ elements: [cube({ to: [1e300, 1, 1] })] })),
      'INVALID_FIELD',
      '$.elements[0].to[0]',
    ],
    ['element not an object', json(model({ elements: [7] })), 'INVALID_FIELD', '$.elements[0]'],
    ['faces missing', json(model({ elements: [cube({ faces: undefined })] })), 'INVALID_FIELD', '$.elements[0].faces'],
    [
      'face uv missing',
      json(model({ elements: [cube({ faces: { up: {} } })] })),
      'INVALID_FIELD',
      '$.elements[0].faces.up.uv',
    ],
    [
      'texture index 99',
      json(model({ elements: [cube({ faces: { up: { uv: [0, 0, 1, 1], texture: 99 } } })] })),
      'INVALID_FIELD',
      '$.elements[0].faces.up.texture',
    ],
    [
      'texture index as string',
      json(model({ elements: [cube({ faces: { up: { uv: [0, 0, 1, 1], texture: LONG } } })] })),
      'INVALID_FIELD',
      '$.elements[0].faces.up.texture',
    ],
    [
      'same element uuid twice in outliner',
      json(model({ outliner: ['c0', 'c0'] })),
      'DUPLICATE_REFERENCE',
      '$.outliner[1]',
    ],
    [
      'same element uuid on two elements',
      json(model({ elements: [cube(), cube()] })),
      'DUPLICATE_REFERENCE',
      '$.elements[1].uuid',
    ],
    [
      'group inside itself (5.x)',
      json(
        model({
          meta: { format_version: '5.0' },
          groups: [{ uuid: 'g' }],
          outliner: [{ uuid: 'g', children: [{ uuid: 'g', children: ['c0'] }] }],
        }),
      ),
      'DUPLICATE_REFERENCE',
      '$.outliner[0].children[0]',
    ],
    [
      'same group twice in groups (5.x)',
      json(model({ groups: [{ uuid: 'g' }, { uuid: 'g' }] })),
      'DUPLICATE_REFERENCE',
      '$.groups[1]',
    ],
    ['outliner entry a number', json(model({ outliner: [3] })), 'INVALID_FIELD', '$.outliner[0]'],
    [
      'bad base64',
      json(model({ textures: [{ source: 'data:image/png;base64,@@@@' }] })),
      'BAD_TEXTURE',
      '$.textures[0].source',
    ],
    [
      'SVG data URI',
      json(model({ textures: [{ source: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }] })),
      'BAD_TEXTURE',
      '$.textures[0].source',
    ],
    [
      'non-base64 data URI',
      json(model({ textures: [{ source: 'data:image/png,rawbytes' }] })),
      'BAD_TEXTURE',
      '$.textures[0].source',
    ],
    [
      'data URI that is not a PNG',
      json(model({ textures: [{ source: `data:image/png;base64,${btoa('GIF89a' + 'x'.repeat(40))}` }] })),
      'BAD_TEXTURE',
      '$.textures[0].source',
    ],
    [
      'PNG of 100000×100000',
      json(model({ textures: [{ source: pngDataUri(100_000, 100_000) }] })),
      'TEXTURE_TOO_LARGE',
      '$.textures[0].source',
    ],
    [
      'PNG of zero width',
      json(model({ textures: [{ source: pngDataUri(0, 16) }] })),
      'BAD_TEXTURE',
      '$.textures[0].source',
    ],
    ['uv_width 0', json(model({ textures: [{ uv_width: 0 }] })), 'INVALID_FIELD', '$.textures[0].uv_width'],
    [
      'resolution negative',
      json(model({ resolution: { width: -16, height: 16 } })),
      'INVALID_FIELD',
      '$.resolution.width',
    ],
  ])('%s', (_name, input, code, path) => {
    expectFailure(input, code, path);
  });

  it('a 1 MB name fails with a capped message', () => {
    const name = 'A'.repeat(1_000_000);
    const error = expectFailure(json(model({ elements: [cube({ name })] })), 'INVALID_FIELD', '$.elements[0].name');
    expect(error.message).toContain(`"${'A'.repeat(32)}"…`);
  });

  it('a file over maxFileBytes fails before decoding, as text or bytes', () => {
    const text = json(model({ name: 'x'.repeat(2000) }));
    expectFailure(text, 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: 1000 } });
    expectFailure(new TextEncoder().encode(text), 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: 1000 } });
  });

  it('counts UTF-8 bytes, not string length, for text input', () => {
    const text = json(model({ name: 'é'.repeat(400) })); // 400 chars, 800 bytes in the name
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(() => loadBbmodel(text, { limits: { maxFileBytes: bytes } })).not.toThrow();
    expectFailure(text, 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: bytes - 1 } });
  });

  it('too many elements fails before any element is converted', () => {
    const elements = Array.from({ length: 11 }, (_, i) => cube({ uuid: `c${i}` }));
    expectFailure(json(model({ elements, outliner: [] })), 'TOO_MANY_ELEMENTS', '$.elements', {
      limits: { maxElements: 10 },
    });
    expect(cubeToMesh).not.toHaveBeenCalled();
  });

  it('too many triangles fails before any geometry or texture is built', () => {
    const elements = Array.from({ length: 3 }, (_, i) => cube({ uuid: `c${i}` }));
    const textures = [{ source: pngDataUri(16, 16) }];
    const error = expectFailure(
      json(model({ elements, outliner: [], textures })),
      'TOO_MANY_TRIANGLES',
      '$.elements[2]',
      {
        limits: { maxTriangles: 30 },
      },
    );
    expect(error.message).toContain('30');
    expect(cubeToMesh).not.toHaveBeenCalled();
    expect(decodeDataUri).not.toHaveBeenCalled();
  });

  it('too many textures fails before any texture is decoded', () => {
    const textures = Array.from({ length: 3 }, () => ({ source: pngDataUri(16, 16) }));
    expectFailure(json(model({ textures })), 'TOO_MANY_TEXTURES', '$.textures', { limits: { maxTextures: 2 } });
    expect(decodeDataUri).not.toHaveBeenCalled();
  });

  it('an oversized data URI fails on its length, before decoding', () => {
    const source = pngDataUri(16, 16);
    expectFailure(json(model({ textures: [{ source }] })), 'TEXTURE_TOO_LARGE', '$.textures[0].source', {
      limits: { maxDataUriChars: source.length - 1 },
    });
    expect(decodeDataUri).not.toHaveBeenCalled();
  });

  it('texture side and pixel limits are separate', () => {
    const textures = [{ source: pngDataUri(64, 64) }];
    expectFailure(json(model({ textures })), 'TEXTURE_TOO_LARGE', '$.textures[0].source', {
      limits: { maxTextureSide: 63 },
    });
    expectFailure(json(model({ textures })), 'TEXTURE_TOO_LARGE', '$.textures[0].source', {
      limits: { maxTexturePixels: 64 * 64 - 1 },
    });
    expect(() => loadBbmodel(json(model({ textures })))).not.toThrow();
  });

  it('nesting at the limit loads, one deeper fails before geometry', () => {
    expect(() => loadBbmodel(json(model({ outliner: nestedGroups(64) })))).not.toThrow();
    vi.mocked(cubeToMesh).mockClear();
    const error = expectFailure(json(model({ outliner: nestedGroups(65) })), 'NESTING_TOO_DEEP', error65Path());
    expect(error.message).toContain('64');
    expect(cubeToMesh).not.toHaveBeenCalled();
  });

  it('a 100 000-deep outliner fails within a second', () => {
    const text = nestedGroupsJson(100_000);
    const start = performance.now();
    expectFailure(text, 'NESTING_TOO_DEEP', error65Path());
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('too many groups fails', () => {
    const outliner = Array.from({ length: 5 }, () => ({ name: 'g', children: [] }));
    expectFailure(json(model({ outliner })), 'TOO_MANY_ELEMENTS', '$.outliner[4]', { limits: { maxGroups: 4 } });
  });

  it('too many outliner entries fails', () => {
    const outliner = Array.from({ length: 30 }, () => 'unknown');
    expectFailure(json(model({ outliner })), 'TOO_MANY_ELEMENTS', '$.outliner', {
      limits: { maxElements: 10, maxGroups: 10 },
    });
  });
});

describe('hostile content is inert', () => {
  it('__proto__ keys in elements, groups and faces pollute nothing', () => {
    const text =
      '{"meta":{"format_version":"4.5"},"__proto__":{"polluted":1},' +
      '"elements":[{"__proto__":{"polluted":2},"uuid":"c0","from":[0,0,0],"to":[1,1,1],' +
      '"faces":{"__proto__":{"polluted":3},"up":{"uv":[0,0,1,1]}}}],' +
      '"outliner":[{"__proto__":{"polluted":4},"name":"g","children":["c0"]}],' +
      '"textures":[{"__proto__":{"polluted":5},"name":"t"}]}';
    const { scene } = loadBbmodel(text);
    expect(scene.meshes).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('element types and uuids that name Object members are just unknown', () => {
    const elements = [
      cube({ type: '__proto__', uuid: 'constructor' }),
      cube({ type: 'constructor', uuid: 'toString' }),
    ];
    const { scene, warnings } = loadBbmodel(json(model({ elements, outliner: ['constructor', 'hasOwnProperty'] })));
    expect(scene.meshes).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toEqual(['UNKNOWN_REFERENCE', 'UNSUPPORTED_ELEMENT', 'UNSUPPORTED_ELEMENT']);
  });

  it('a texture URL is never fetched; the texture is marked missing with warnings', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const textures = [{ name: 'skin.png', source: `https://example.invalid/${LONG}.png` }];
    const { scene, warnings } = loadBbmodel(json(model({ textures })));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scene.textures[0]).toMatchObject({ missing: true, bytes: null });
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['SOURCE_NOT_FETCHED', '$.textures[0].source'],
      ['MISSING_TEXTURE', '$.textures[0]'],
    ]);
    for (const warning of warnings) expect(warning.message).not.toMatch(/A{33}/);
  });

  it('a texture is matched only against files the caller picked', () => {
    const textures = [{ name: 'Skin.PNG', path: '/home/u/skin.png', source: '' }];
    const picked = new Map([['other/SKIN.png', new Uint8Array([...atobBytes(pngDataUri(4, 4))])]]);
    const { scene, warnings } = loadBbmodel(json(model({ textures })), { textureFiles: picked });
    expect(scene.textures[0]).toMatchObject({ missing: false, width: 4, height: 4 });
    expect(warnings).toEqual([]);
  });

  it('a picked file that is not a PNG is BAD_TEXTURE', () => {
    const picked = new Map([['skin.png', new TextEncoder().encode('not a png at all, really not')]]);
    const error = failure(json(model({ textures: [{ name: 'skin.png' }] })), { textureFiles: picked });
    expect(error).toMatchObject({ code: 'BAD_TEXTURE', path: '$.textures[0]' });
  });

  it('keeps at most 100 warnings', () => {
    const outliner = Array.from({ length: 150 }, (_, i) => `missing-${i}`);
    const { warnings } = loadBbmodel(json(model({ outliner })));
    expect(warnings).toHaveLength(100);
  });
});

function error65Path(): string {
  return `$.outliner[0]${'.children[0]'.repeat(64)}`;
}

function atobBytes(dataUri: string): Uint8Array {
  return Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
}

/** A model with one mesh element; `extra` replaces the mesh's keys. */
function meshModel(extra: Record<string, unknown>, textures: unknown[] = []): string {
  return json(model({ elements: [mesh(extra)], textures }));
}

/** `count` vertices on a circle (a convex polygon) as keys v0…, and one face listing all of them. */
function polygonMesh(count: number): Record<string, unknown> {
  const keys = Array.from({ length: count }, (_, i) => `v${i}`);
  const vertices = Object.fromEntries(
    keys.map((key, i) => [key, [Math.cos((2 * Math.PI * i) / count), Math.sin((2 * Math.PI * i) / count), 0]]),
  );
  return { vertices, faces: { f: meshFace(keys) } };
}

describe('hostile meshes fail fast with a coded error', () => {
  const tri = ['a', 'b', 'c'];
  it.each<[string, string, BbmodelErrorCode, string]>([
    ['vertices not an object', meshModel({ vertices: [[0, 0, 0]] }), 'INVALID_FIELD', '$.elements[0].vertices'],
    ['vertices missing', meshModel({ vertices: undefined }), 'INVALID_FIELD', '$.elements[0].vertices'],
    ['faces not an object', meshModel({ faces: 'none' }), 'INVALID_FIELD', '$.elements[0].faces'],
    ['vertex with 2 components', meshModel({ vertices: { a: [0, 0] } }), 'INVALID_FIELD', '$.elements[0].vertices.a'],
    [
      'vertex NaN as a string',
      meshModel({ vertices: { a: ['NaN', 0, 0] } }),
      'INVALID_FIELD',
      '$.elements[0].vertices.a[0]',
    ],
    [
      'vertex 1e400',
      '{"meta":{"format_version":"4.5"},"elements":[{"type":"mesh","vertices":{"a":[1e400,0,0]},"faces":{}}]}',
      'INVALID_FIELD',
      '$.elements[0].vertices.a[0]',
    ],
    [
      'vertex out of range',
      meshModel({ vertices: { a: [0, 1e8, 0] } }),
      'INVALID_FIELD',
      '$.elements[0].vertices.a[1]',
    ],
    [
      'face vertices not an array',
      meshModel({ faces: { f: { vertices: 'abc', uv: {} } } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.vertices',
    ],
    [
      'unknown vertex key',
      meshModel({ faces: { f: meshFace(['a', 'b', 'zz']) } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.vertices[2]',
    ],
    [
      'vertex ref not a string',
      meshModel({ faces: { f: { vertices: ['a', 'b', 3], uv: {} } } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.vertices[2]',
    ],
    [
      'repeated vertex key',
      meshModel({ faces: { f: meshFace(['a', 'b', 'a', 'c']) } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.vertices[2]',
    ],
    ['uv missing', meshModel({ faces: { f: { vertices: tri } } }), 'INVALID_FIELD', '$.elements[0].faces.f.uv'],
    [
      'uv entry missing',
      meshModel({ faces: { f: { vertices: tri, uv: { a: [0, 0], b: [0, 0] } } } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.uv.c',
    ],
    [
      'uv entry not 2 numbers',
      meshModel({ faces: { f: { vertices: tri, uv: { a: [0, 0, 0], b: [0, 0], c: [0, 0] } } } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.uv.a',
    ],
    [
      'texture index 99',
      meshModel({ faces: { f: meshFace(tri, { texture: 99 }) } }),
      'INVALID_FIELD',
      '$.elements[0].faces.f.texture',
    ],
    [
      'unknown texture uuid',
      meshModel({ faces: { f: meshFace(tri, { texture: 'nope' }) } }, [{ name: 't', uuid: 't-0' }]),
      'INVALID_FIELD',
      '$.elements[0].faces.f.texture',
    ],
    ['render_order a number', meshModel({ render_order: 1 }), 'INVALID_FIELD', '$.elements[0].render_order'],
    ['shading a boolean', meshModel({ shading: true }), 'INVALID_FIELD', '$.elements[0].shading'],
    [
      'render_order of a cube an object',
      json(model({ elements: [cube({ render_order: {} })] })),
      'INVALID_FIELD',
      '$.elements[0].render_order',
    ],
    [
      'render_sides a boolean',
      json(model({ textures: [{ name: 't', render_sides: true }] })),
      'INVALID_FIELD',
      '$.textures[0].render_sides',
    ],
    [
      'a vertex key over maxStringChars',
      meshModel({ vertices: { [LONG.repeat(30)]: [0, 0, 0] } }),
      'INVALID_FIELD',
      '$.elements[0].vertices',
    ],
  ])('%s', (_name, input, code, path) => {
    expectFailure(input, code, path);
    expect(meshElementToMesh).not.toHaveBeenCalled();
  });

  it('a face of 16 vertices loads, 17 is TOO_MANY_VERTICES before any geometry', () => {
    expect(loadBbmodel(meshModel(polygonMesh(16))).scene.meshes[0]?.indices).toHaveLength(14 * 3);
    vi.mocked(meshElementToMesh).mockClear();
    const error = expectFailure(meshModel(polygonMesh(17)), 'TOO_MANY_VERTICES', '$.elements[0].faces.f.vertices');
    expect(error.message).toContain('16');
    expect(meshElementToMesh).not.toHaveBeenCalled();
  });

  it('more vertex keys than maxVertices fails before the vertex table is built, at the exact limit', () => {
    const element = polygonMesh(6);
    expect(() => loadBbmodel(meshModel(element), { limits: { maxVertices: 6 } })).not.toThrow();
    vi.mocked(meshElementToMesh).mockClear();
    expectFailure(meshModel(element), 'TOO_MANY_VERTICES', '$.elements[0].vertices', { limits: { maxVertices: 5 } });
    expect(meshElementToMesh).not.toHaveBeenCalled();
  });

  it('face vertices (each face has its own) over maxVertices fail at the face that crosses the limit', () => {
    const vertices = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] };
    const faces = { f1: meshFace(['a', 'b', 'c']), f2: meshFace(['c', 'b', 'a']) };
    expect(() => loadBbmodel(meshModel({ vertices, faces }), { limits: { maxVertices: 6 } })).not.toThrow();
    expectFailure(meshModel({ vertices, faces }), 'TOO_MANY_VERTICES', '$.elements[0].faces.f2', {
      limits: { maxVertices: 5 },
    });
  });

  it('the vertex total over all elements is checked before any geometry or texture is built', () => {
    const elements = [cube(), cube({ uuid: 'c1' }), mesh({ uuid: 'm0' })];
    const text = json(model({ elements, outliner: [], textures: [{ source: pngDataUri(16, 16) }] }));
    expect(() => loadBbmodel(text, { limits: { maxVertices: 52 } })).not.toThrow();
    vi.mocked(cubeToMesh).mockClear();
    vi.mocked(meshElementToMesh).mockClear();
    vi.mocked(decodeDataUri).mockClear();
    expectFailure(text, 'TOO_MANY_VERTICES', '$.elements[2]', { limits: { maxVertices: 51 } });
    expect(cubeToMesh).not.toHaveBeenCalled();
    expect(meshElementToMesh).not.toHaveBeenCalled();
    expect(decodeDataUri).not.toHaveBeenCalled();
  });

  it('triangles are counted from the k − 2 bound before any geometry is built', () => {
    // A collinear 16-gon makes no triangles, but its bound of 14 still counts.
    const keys = Array.from({ length: 16 }, (_, i) => `v${i}`);
    const vertices = Object.fromEntries(keys.map((key, i) => [key, [i, 0, 0]]));
    const text = meshModel({ vertices, faces: { f: meshFace(keys) } });
    expect(loadBbmodel(text, { limits: { maxTriangles: 14 } }).scene.meshes[0]?.indices).toHaveLength(0);
    vi.mocked(meshElementToMesh).mockClear();
    expectFailure(text, 'TOO_MANY_TRIANGLES', '$.elements[0]', { limits: { maxTriangles: 13 } });
    expect(meshElementToMesh).not.toHaveBeenCalled();
  });
});

describe('hostile mesh content is inert', () => {
  it('__proto__ and constructor as vertex and face keys are plain keys', () => {
    const uv = '"uv":{"__proto__":[0,0],"constructor":[1,0],"toString":[0,1]}';
    const text =
      '{"meta":{"format_version":"4.5"},"elements":[{"type":"mesh","uuid":"m",' +
      '"vertices":{"__proto__":[0,0,0],"constructor":[1,0,0],"toString":[0,1,0]},' +
      `"faces":{"__proto__":{"vertices":["__proto__","constructor","toString"],${uv}},` +
      `"constructor":{"vertices":["toString","constructor","__proto__"],${uv}}}}]}`;
    const { scene } = loadBbmodel(text);
    expect(scene.meshes[0]?.indices).toHaveLength(6);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });

  it('a vertex ref naming an Object member that the file does not define is unknown', () => {
    const faces = { f: meshFace(['a', 'b', 'hasOwnProperty']) };
    expectFailure(meshModel({ faces }), 'INVALID_FIELD', '$.elements[0].faces.f.vertices[2]');
  });
});
