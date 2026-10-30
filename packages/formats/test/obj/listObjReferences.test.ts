import { describe, expect, it } from 'vitest';
import { listObjReferences } from '../../src/index';
import { expectCpuBelow } from '../support/expectCpuBelow';
import { lines, shapesObj } from './fixtures';

const MAX = { maxReferences: 31 };

describe('listObjReferences', () => {
  it('lists the material library of shapes.obj', () => {
    expect(listObjReferences(shapesObj, MAX)).toEqual(['shapes.mtl']);
  });

  it('reads bytes as well as text', () => {
    expect(listObjReferences(new TextEncoder().encode(shapesObj), MAX)).toEqual(['shapes.mtl']);
  });

  it('lists each distinct library spelling once, names with spaces whole, in order', () => {
    const obj = lines('mtllib b.mtl', 'mtllib my lib.mtl', 'v 0 0 0', 'mtllib ./b.mtl', 'mtllib a.mtl', 'mtllib');
    expect(listObjReferences(obj, MAX)).toEqual(['b.mtl', 'my lib.mtl', './b.mtl', 'a.mtl']);
  });

  it('lists nothing for a file the loader refuses', () => {
    expect(listObjReferences(lines('mtllib a.mtl', `# ${'x'.repeat(5000)}`), MAX)).toEqual([]);
  });

  it('stops after one more than the maximum', () => {
    const obj = Array.from({ length: 100_000 }, (_, i) => `mtllib m${i}.mtl`).join('\n');
    const listed = expectCpuBelow(200, () => listObjReferences(obj, MAX));
    expect(listed).toHaveLength(32);
    expect(listed.at(-1)).toBe('m31.mtl');
  });

  it('scans 100 000 repeated mtllib lines in bounded time', () => {
    const obj = Array.from({ length: 100_000 }, () => 'mtllib same.mtl').join('\n');
    expect(expectCpuBelow(1000, () => listObjReferences(obj, MAX))).toEqual(['same.mtl']);
  });
});
