import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OBJ_LIMITS, loadObj } from '../../src/index';
import * as mtl from '../../src/obj/parseMtl';
import { MAX_TRACKED_KEYWORDS } from '../../src/obj/KeywordTally';
import { expectObjError, lines, QUAD, QUAD_FACE } from './fixtures';

vi.mock('../../src/obj/parseMtl', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/obj/parseMtl')>();
  return { ...original, parseMtl: vi.fn(original.parseMtl) };
});

afterEach(() => vi.mocked(mtl.parseMtl).mockClear());

const encode = (text: string) => new TextEncoder().encode(text);

describe('material libraries are parsed once', () => {
  it('100 000 mtllib lines naming one library parse it once, quickly', () => {
    const library = encode(lines(...Array.from({ length: 200 }, (_, i) => `newmtl m${i}\nKd 1 0 0`)));
    const obj = [...Array<string>(100_000).fill('mtllib a.mtl'), ...QUAD, 'usemtl m7', QUAD_FACE].join(
      String.fromCharCode(10),
    );
    const start = performance.now();
    const { scene } = loadObj(obj, { files: new Map([['a.mtl', library]]) });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(mtl.parseMtl).toHaveBeenCalledTimes(1);
    expect(scene.materials.map((m) => m.name)).toEqual(['m7']);
  });

  it('a library at the material limit named twice, by two names of one file, loads', () => {
    const names = Array.from({ length: DEFAULT_OBJ_LIMITS.maxMaterials }, (_, i) => `newmtl m${i}`);
    const obj = lines('mtllib a.mtl', 'mtllib ./a.mtl', ...QUAD, 'usemtl m0', QUAD_FACE);
    const { scene, warnings } = loadObj(obj, { files: new Map([['a.mtl', encode(lines(...names))]]) });
    expect(scene.materials).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(mtl.parseMtl).toHaveBeenCalledTimes(1);
  });

  it('two libraries defining the same names do not double-count them', () => {
    const names = lines(...Array.from({ length: 3 }, (_, i) => `newmtl m${i}`));
    const files = new Map([
      ['a.mtl', encode(names)],
      ['b.mtl', encode(names)],
    ]);
    expect(() => loadObj(lines('mtllib a.mtl', 'mtllib b.mtl'), { files, limits: { maxMaterials: 3 } })).not.toThrow();
  });

  it('more distinct library names than maxMaterials is TOO_MANY_MATERIALS', () => {
    const obj = lines('mtllib a.mtl', 'mtllib a.mtl', 'mtllib b.mtl', 'mtllib c.mtl');
    expect(() => loadObj(obj, { limits: { maxMaterials: 3 } })).not.toThrow();
    expectObjError(lines(obj, 'mtllib d.mtl'), 'TOO_MANY_MATERIALS', 'model.obj:5', { limits: { maxMaterials: 3 } });
  });
});

describe('unknown keywords are tracked up to a cap', () => {
  const keywords = (count: number) => Array.from({ length: count }, (_, i) => `zz${i} 1`);

  it(`reports the first ${MAX_TRACKED_KEYWORDS} by name, then one count for the rest`, () => {
    const { warnings } = loadObj(lines(...keywords(MAX_TRACKED_KEYWORDS + 1), 'zz0 1', 'yy 1'));
    expect(warnings).toHaveLength(MAX_TRACKED_KEYWORDS + 1);
    expect(warnings[0]!.message).toBe('Statement ignored at model.obj:1: "zz0" (2 lines) is not drawn');
    expect(warnings[MAX_TRACKED_KEYWORDS]).toEqual({
      code: 'UNSUPPORTED_STATEMENT',
      path: `model.obj:${MAX_TRACKED_KEYWORDS + 1}`,
      message: `Statement ignored at model.obj:${MAX_TRACKED_KEYWORDS + 1}: 2 lines with keywords beyond the first ${MAX_TRACKED_KEYWORDS} distinct ones is not drawn`,
    });
  });

  it('the same cap holds in a library, and for the maps of one material', () => {
    const library = lines(
      ...keywords(MAX_TRACKED_KEYWORDS + 5),
      'newmtl m',
      ...Array.from({ length: 100 }, (_, i) => `map_x${i} a.png`),
    );
    const { warnings } = loadObj('mtllib a.mtl', { files: new Map([['a.mtl', encode(library)]]) });
    const feature = warnings.find((w) => w.code === 'UNSUPPORTED_MATERIAL_FEATURE');
    expect(feature?.message.split(', ')).toHaveLength(MAX_TRACKED_KEYWORDS);
    expect(warnings.filter((w) => w.code === 'UNSUPPORTED_STATEMENT')).toHaveLength(MAX_TRACKED_KEYWORDS + 1);
  });

  it('a file of 300 000 distinct keywords stays bounded', () => {
    // Joined directly: spreading 300 000 arguments into `lines` would overflow the call stack.
    const text = keywords(300_000).join(String.fromCharCode(10));
    const start = performance.now();
    expect(loadObj(text).warnings).toHaveLength(MAX_TRACKED_KEYWORDS + 1);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('float32 range', () => {
  it('a position finite in float64 but not as float32 after the unit scale is NON_FINITE_DATA', () => {
    expect(() => loadObj(lines('v 1e37 0 0'))).not.toThrow();
    expectObjError(lines('v 1e38 0 0'), 'NON_FINITE_DATA', 'model.obj:1');
    expect(() => loadObj(lines('v 1e38 0 0'), { unitScale: 1 })).not.toThrow();
    expectObjError(lines('vt 1e39'), 'NON_FINITE_DATA', 'model.obj:1');
    expectObjError(lines('vn 0 0 1e39'), 'NON_FINITE_DATA', 'model.obj:1');
  });
});

describe('textures', () => {
  it('generated colour textures do not count against maxTextures, as in glTF', () => {
    const count = DEFAULT_OBJ_LIMITS.maxTextures + 1;
    const library = lines(...Array.from({ length: count }, (_, i) => `newmtl m${i}\nKd ${i / count} 0 0`));
    const uses = Array.from({ length: count }, (_, i) => `usemtl m${i}\nf 1 2 3`);
    const { scene } = loadObj(lines('mtllib a.mtl', ...QUAD, ...uses), {
      files: new Map([['a.mtl', encode(library)]]),
    });
    expect(scene.textures).toHaveLength(count);
  });
});
