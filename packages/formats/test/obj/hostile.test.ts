import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadObj, ObjError } from '../../src/index';
import { expectObjError, lines, QUAD, QUAD_FACE } from './fixtures';
import { expectCpuBelow } from '../support/expectCpuBelow';

describe('hostile OBJ input', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());

  it('an over-long line fails at once, before it is split', () => {
    const text = `v ${'9'.repeat(20_000_000)} 0 0`;
    expectCpuBelow(2000, () => expectObjError(text, 'LINE_TOO_LONG', 'model.obj:1'));
    expectObjError(lines('v 0 0 0', `# ${'A'.repeat(5000)}`), 'LINE_TOO_LONG', 'model.obj:2');
  });

  it('a bad index on the first face fails with its line', () => {
    expectObjError(lines('v 0 0 0', 'f 1 2 3'), 'INDEX_OUT_OF_RANGE', 'model.obj:2');
    expectObjError(lines(...QUAD, 'f 1 2 99999999999'), 'INVALID_STATEMENT', 'model.obj:10');
    expectObjError(lines(...QUAD, 'f 1 2 -9999999999'), 'INDEX_OUT_OF_RANGE', 'model.obj:10');
  });

  it('CRLF line ends and a byte-order mark load like LF', () => {
    const text = lines(...QUAD, QUAD_FACE);
    const crlf = `\uFEFF${text.replace(/\n/g, '\r\n')}`;
    expect(loadObj(crlf).scene.meshes[0]!.indices).toEqual(loadObj(text).scene.meshes[0]!.indices);
  });

  it('a 65-vertex face is TOO_MANY_FACE_VERTICES', () => {
    const vertices = Array.from({ length: 65 }, (_, i) => `v ${Math.cos(i / 10)} ${Math.sin(i / 10)} 0`);
    expectObjError(
      lines(...vertices, `f ${vertices.map((_, i) => i + 1).join(' ')}`),
      'TOO_MANY_FACE_VERTICES',
      'model.obj:66',
    );
  });

  it('a self-intersecting polygon still triangulates (fan fallback) without hanging', () => {
    const bowtie = lines('v 0 0 0', 'v 1 1 0', 'v 1 0 0', 'v 0 1 0', 'v 0.5 2 0', 'f 1 2 3 4 5');
    expect(loadObj(bowtie).scene.meshes[0]!.indices.length % 3).toBe(0);
  });

  it('names that look like prototype keys are plain names', () => {
    const text = lines('o __proto__', ...QUAD, 'usemtl constructor', QUAD_FACE);
    const { scene, warnings } = loadObj(text);
    expect(scene.nodes[0]!.name).toBe('__proto__');
    expect(warnings.map((w) => w.code)).toEqual(['UNKNOWN_MATERIAL']);
  });

  it('only ObjError or RangeError ever leave the loader, for any input type', () => {
    expect(() => loadObj(42 as unknown as string)).toThrow(ObjError);
    for (const text of ['f', 'v', 'vt', 'usemtl', 'mtllib', 'o', '\\', '\\\n\\\n', 'f 1/ 2/ 3/']) {
      try {
        loadObj(text);
      } catch (error) {
        expect(error, text).toBeInstanceOf(ObjError);
      }
    }
  });
});
