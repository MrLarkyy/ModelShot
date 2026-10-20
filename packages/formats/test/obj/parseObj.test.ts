import { describe, expect, it } from 'vitest';
import { loadObj } from '../../src/index';
import { expectObjError, lines, QUAD, QUAD_FACE } from './fixtures';

const load = (text: string) => loadObj(text, { unitScale: 1 });

describe('parseObj', () => {
  it('reads v, vt (v flipped) and vn; a quad becomes two triangles over four merged corners', () => {
    const { scene } = load(lines(...QUAD, QUAD_FACE));
    const mesh = scene.meshes[0]!;
    expect([...mesh.positions]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(mesh.indices).toHaveLength(6);
    expect([...mesh.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    // Untextured (no material): every UV is the centre.
    expect([...mesh.uvs]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(scene.nodes.map((n) => n.name)).toEqual(['model']);
  });

  it('accepts v, v/vt, v//vn and v/vt/vn corners, and negative indices', () => {
    const text = lines(...QUAD, 'f 1 2 3', 'f 1/1 3/3 4/4', 'f -4//-1 -3//-1 -2//-1', 'f -4/-4/-1 -2/-2/-1 -1/-1/-1');
    expect(load(text).scene.meshes[0]!.indices).toHaveLength(12);
  });

  it('rejects index 0 and indices past what is defined so far, naming the line', () => {
    expectObjError(lines(...QUAD, 'f 0 1 2'), 'INDEX_OUT_OF_RANGE', 'model.obj:10');
    expectObjError(lines('f 1 2 3', ...QUAD), 'INDEX_OUT_OF_RANGE', 'model.obj:1');
    expectObjError(lines(...QUAD, 'f -5 1 2'), 'INDEX_OUT_OF_RANGE', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1/5 2/1 3/1'), 'INDEX_OUT_OF_RANGE', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1//2 2//1 3//1'), 'INDEX_OUT_OF_RANGE', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1 2 x'), 'INVALID_STATEMENT', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1/2/3/4 2 3'), 'INVALID_STATEMENT', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1 2'), 'INVALID_STATEMENT', 'model.obj:10');
  });

  it('rejects non-finite numbers', () => {
    expectObjError(lines('v 0 NaN 0'), 'NON_FINITE_DATA', 'model.obj:1');
    expectObjError(lines('v 0 1e999 0'), 'NON_FINITE_DATA', 'model.obj:1');
    expectObjError(lines('vt Infinity'), 'NON_FINITE_DATA', 'model.obj:1');
    expectObjError(lines('vn 0 0'), 'INVALID_STATEMENT', 'model.obj:1');
  });

  it('o and g start objects; faces before any get the file name; empty objects are dropped', () => {
    const text = lines(...QUAD, 'f 1 2 3', 'o first', 'g empty', 'g second part', 'f 1 3 4');
    const { scene } = loadObj(text, { fileName: 'models/crate.v2.obj' });
    expect(scene.nodes.map((n) => n.name)).toEqual(['crate.v2', 'second part']);
    expect(scene.meshes.map((m) => [m.name, m.node])).toEqual([
      ['crate.v2', 0],
      ['second part', 1],
    ]);
  });

  it('triangulates concave polygons up to maxFaceVertices; one more is an error', () => {
    // A comb: 64 vertices, concave.
    const points: string[] = [];
    for (let k = 0; k < 31; k++) points.push(`v ${k * 2} 0 0`, `v ${k * 2 + 1} 3 0`);
    points.push('v 62 0 0', 'v 62 -1 0');
    const face = `f ${Array.from({ length: 64 }, (_, i) => i + 1).join(' ')}`;
    const mesh = load(lines(...points, face)).scene.meshes[0]!;
    expect(mesh.indices).toHaveLength(62 * 3);
    expect(load(lines(...points, 'v 0 -1 0', face)).scene.meshes).toHaveLength(1);
    const big = `f ${Array.from({ length: 65 }, (_, i) => i + 1).join(' ')}`;
    expectObjError(lines(...points, 'v 0 -1 0', big), 'TOO_MANY_FACE_VERTICES', 'model.obj:66');
  });

  it('a face without vn is flat; a zero vn falls back to the face normal; a degenerate face is dropped', () => {
    const { scene } = load(
      lines('v 0 0 0', 'v 0 0 1', 'v 1 0 0', 'vn 0 0 0', 'f 1 2 3', 'f 1//1 2//1 3//1', 'f 1 1 2'),
    );
    const mesh = scene.meshes[0]!;
    expect(mesh.indices).toHaveLength(6);
    for (let v = 0; v < 6; v++) expect([...mesh.normals.slice(v * 3, v * 3 + 3)]).toEqual([0, 1, 0]);
  });

  it('merges equal v/vt/vn corners within a material, never across materials or flat faces', () => {
    const mtl = new TextEncoder().encode(lines('newmtl a', 'newmtl b'));
    const text = lines('mtllib m.mtl', ...QUAD, 'usemtl a', QUAD_FACE, QUAD_FACE, 'usemtl b', QUAD_FACE, 'f 1 2 3');
    const mesh = loadObj(text, { files: new Map([['m.mtl', mtl]]) }).scene.meshes[0]!;
    expect(mesh.positions.length / 3).toBe(4 + 4 + 3);
    expect(mesh.groups.map((g) => [g.material, g.count])).toEqual([
      [0, 12],
      [1, 6 + 3],
    ]);
  });

  it('groups faces by material in order of first use, stable within each', () => {
    const mtl = new TextEncoder().encode(lines('newmtl a', 'Kd 1 0 0', 'newmtl b', 'Kd 0 1 0'));
    const text = lines('mtllib m.mtl', ...QUAD, 'usemtl b', 'f 1 2 3', 'usemtl a', 'f 1 3 4', 'usemtl b', 'f 2 3 4');
    const { scene } = loadObj(text, { files: new Map([['m.mtl', mtl]]) });
    expect(scene.materials.map((m) => m.name)).toEqual(['b', 'a']);
    expect(scene.meshes[0]!.groups.map((g) => [g.material, g.start, g.count])).toEqual([
      [0, 0, 6],
      [1, 6, 3],
    ]);
  });

  it('handles CRLF, a byte-order mark, comments, blank lines and backslash continuations', () => {
    const text = `\uFEFF# comment\r\n\r\nv 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 \\\r\n2 3\r\n`;
    expect(load(text).scene.meshes[0]!.indices).toHaveLength(3);
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(lines('v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3')),
    ]);
    expect(loadObj(bytes).scene.meshes).toHaveLength(1);
  });

  it('decodes invalid UTF-8 leniently: only the ASCII keywords matter', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('o caf'),
      0xe9,
      0x0a,
      ...new TextEncoder().encode(lines('v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3')),
    ]);
    expect(loadObj(bytes).scene.nodes[0]!.name).toBe('caf�');
  });
});
