import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJ_LIMITS, loadObj, type ObjLimits } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { expectObjError, lines, QUAD } from './fixtures';

const triangles = (count: number) => lines('v 0 0 0', 'v 1 0 0', 'v 0 1 0', ...Array<string>(count).fill('f 1 2 3'));
const limited = (limits: Partial<ObjLimits>) => ({ limits });

describe('OBJ limits: N loads, N + 1 fails', () => {
  it('file size, checked before anything is decoded', () => {
    const text = triangles(1);
    expect(() => loadObj(text, limited({ maxFileBytes: text.length }))).not.toThrow();
    expectObjError(text, 'FILE_TOO_LARGE', 'model.obj', limited({ maxFileBytes: text.length - 1 }));
    expectObjError(
      new TextEncoder().encode(text),
      'FILE_TOO_LARGE',
      'model.obj',
      limited({ maxFileBytes: text.length - 1 }),
    );
    // Each .mtl has the same limit as the .obj.
    const mtl = new TextEncoder().encode(`newmtl m
# ${'x'.repeat(200)}
`);
    const files = new Map([['m.mtl', mtl]]);
    expectObjError(lines('mtllib m.mtl', text), 'FILE_TOO_LARGE', 'm.mtl', { files, limits: { maxFileBytes: 100 } });
  });

  it('line length, continuation lines joined', () => {
    const line = `v ${'1'.repeat(10)} 0 0`;
    expect(() => loadObj(line, limited({ maxLineChars: line.length }))).not.toThrow();
    expectObjError(line, 'LINE_TOO_LONG', 'model.obj:1', limited({ maxLineChars: line.length - 1 }));
    expectObjError(`v 1 \\\n${'2'.repeat(20)} 0`, 'LINE_TOO_LONG', 'model.obj:1', limited({ maxLineChars: 20 }));
  });

  it('triangles, counted per face as n − 2', () => {
    expect(() => loadObj(triangles(5), limited({ maxTriangles: 5 }))).not.toThrow();
    expectObjError(triangles(6), 'TOO_MANY_TRIANGLES', 'model.obj:9', limited({ maxTriangles: 5 }));
    expectObjError(
      lines(...QUAD, 'f 1 2 3 4', 'f 1 2 3 4'),
      'TOO_MANY_TRIANGLES',
      'model.obj:11',
      limited({ maxTriangles: 3 }),
    );
  });

  it('v, vt and vn statements, and built vertices', () => {
    expect(() => loadObj(triangles(1), limited({ maxVertices: 3 }))).not.toThrow();
    expectObjError(lines('v 0 0 0', 'v 0 0 0'), 'TOO_MANY_VERTICES', 'model.obj:2', limited({ maxVertices: 1 }));
    expectObjError(lines('vt 0 0', 'vt 0 0'), 'TOO_MANY_VERTICES', 'model.obj:2', limited({ maxVertices: 1 }));
    expectObjError(lines('vn 0 0 1', 'vn 0 0 1'), 'TOO_MANY_VERTICES', 'model.obj:2', limited({ maxVertices: 1 }));
    // Three statements each, but two flat faces build 6 corners.
    expectObjError(triangles(2), 'TOO_MANY_VERTICES', 'model.obj:5', limited({ maxVertices: 5 }));
  });

  it('objects and groups', () => {
    const objects = (count: number) => lines(...Array.from({ length: count }, (_, i) => `o o${i}`), ...QUAD, 'f 1 2 3');
    expect(() => loadObj(objects(3), limited({ maxObjects: 3 }))).not.toThrow();
    expectObjError(objects(4), 'TOO_MANY_OBJECTS', 'model.obj:4', limited({ maxObjects: 3 }));
  });

  it('materials, in usemtl and in a library', () => {
    const uses = (count: number) => lines(...Array.from({ length: count }, (_, i) => `usemtl m${i}`));
    expect(() => loadObj(uses(2), limited({ maxMaterials: 2 }))).not.toThrow();
    expectObjError(uses(3), 'TOO_MANY_MATERIALS', 'model.obj:3', limited({ maxMaterials: 2 }));
    const library = new TextEncoder().encode(lines('newmtl a', 'newmtl b', 'newmtl c'));
    expectObjError('mtllib m.mtl', 'TOO_MANY_MATERIALS', 'm.mtl:3', {
      files: new Map([['m.mtl', library]]),
      limits: { maxMaterials: 2 },
    });
  });

  it('textures', () => {
    const mtl = lines('newmtl a', 'map_Kd a.png', 'newmtl b', 'map_Kd b.png');
    const obj = lines('mtllib m.mtl', ...QUAD, 'usemtl a', 'f 1 2 3', 'usemtl b', 'f 1 2 3');
    const png = encodeSolidPng([0, 0, 0, 255]);
    const files = new Map([
      ['m.mtl', new TextEncoder().encode(mtl)],
      ['a.png', png],
      ['b.png', png],
    ]);
    expect(() => loadObj(obj, { files, limits: { maxTextures: 2 } })).not.toThrow();
    expectObjError(obj, 'TOO_MANY_TEXTURES', 'm.mtl:3', { files, limits: { maxTextures: 1 } });
  });

  it('rejects invalid limit overrides and unit scales with a RangeError', () => {
    for (const value of [0, -2, 2.5, NaN]) {
      expect(() => loadObj('', limited({ maxTriangles: value })), String(value)).toThrow(RangeError);
    }
    for (const value of [0, -2, NaN, Infinity]) {
      expect(() => loadObj('', { unitScale: value }), String(value)).toThrow(RangeError);
    }
  });

  it('a model at the default triangle limit loads in under 5 s', () => {
    const out: string[] = [];
    const side = 317; // 317 x 316 quads ~ 200 000 triangles
    for (let z = 0; z <= side; z++) for (let x = 0; x <= side; x++) out.push(`v ${x} 0 ${z}`);
    out.push('vn 0 1 0');
    const quads = Math.floor(DEFAULT_OBJ_LIMITS.maxTriangles / 2);
    for (let q = 0; q < quads; q++) {
      const x = q % side;
      const z = Math.floor(q / side);
      const a = z * (side + 1) + x + 1;
      out.push(`f ${a}//1 ${a + side + 1}//1 ${a + side + 2}//1 ${a + 1}//1`);
    }
    const start = performance.now();
    const { scene } = loadObj(out.join('\n'));
    expect(performance.now() - start).toBeLessThan(5000);
    expect(scene.meshes[0]!.indices).toHaveLength(DEFAULT_OBJ_LIMITS.maxTriangles * 3);
  });

  it('the worst case of ear clipping (64-vertex concave faces up to the triangle limit) stays bounded', () => {
    const points: string[] = [];
    for (let k = 0; k < 31; k++) points.push(`v ${k * 2} 0 0`, `v ${k * 2 + 1} 3 0`);
    points.push('v 62 0 0', 'v 62 -1 0');
    const face = `f ${Array.from({ length: 64 }, (_, i) => i + 1).join(' ')}`;
    const faces = Math.floor(DEFAULT_OBJ_LIMITS.maxTriangles / 62);
    const start = performance.now();
    const { scene } = loadObj(lines(...points, ...Array<string>(faces).fill(face)));
    expect(performance.now() - start).toBeLessThan(15000);
    expect(scene.meshes[0]!.indices).toHaveLength(faces * 62 * 3);
  });
});
