import type { SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { MESH_CHUNK_BYTES, MeshAssembler, streamMeshes, type MeshMessage } from '../src/bake/meshStream';
import { triangleMesh } from './testScenes';

const FIELDS = ['positions', 'normals', 'uvs', 'uvRects', 'indices'] as const;

/**
 * A mesh of `triangles` independent triangles built straight into typed arrays, every value distinct enough that a
 * misplaced byte shows. 15 000 triangles are 45 000 vertices of 52 bytes: just over twice MESH_CHUNK_BYTES and over
 * MESH_TASK_BYTES, so the stream splits it and yields.
 */
function bigMesh(triangles: number): SceneMesh {
  const vertices = triangles * 3;
  const fill = (length: number, step: number) => Float32Array.from({ length }, (_, i) => ((i * step) % 1013) / 7);
  return {
    name: 'big',
    sourceId: '',
    node: -1,
    visible: true,
    renderOrder: 2,
    positions: fill(vertices * 3, 7),
    normals: fill(vertices * 3, 11),
    uvs: fill(vertices * 2, 13),
    uvRects: fill(vertices * 4, 17),
    indices: Uint32Array.from({ length: vertices }, (_, i) => i),
    groups: [{ material: 0, start: 0, count: vertices, doubleSided: true }],
  };
}

const bytes = (array: Float32Array | Uint32Array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

/** Same scalar fields and groups, and the same bytes in every array (cheap where toEqual walks every element). */
function expectSameMesh(actual: SceneMesh | undefined, expected: SceneMesh): void {
  expect(actual).toBeDefined();
  const scalars = (m: SceneMesh) => ({ ...m, positions: 0, normals: 0, uvs: 0, uvRects: 0, indices: 0 });
  expect(scalars(actual!)).toEqual(scalars(expected));
  for (const field of FIELDS) {
    expect(actual![field].constructor, field).toBe(expected[field].constructor);
    expect(bytes(actual![field]).equals(bytes(expected[field])), field).toBe(true);
  }
}

describe('mesh stream', () => {
  it('rebuilds every mesh exactly from transferred chunks, yielding between them', async () => {
    const meshes: [number, SceneMesh][] = [
      [7, triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0])],
      [8, bigMesh(15_000)],
      [9, triangleMesh([5, 5, 5, 6, 5, 5, 5, 6, 5])],
    ];
    const messages: MeshMessage[] = [];
    let yields = 0;
    const done = await streamMeshes(
      (message) => messages.push(message),
      meshes,
      () => true,
      () => {
        yields++;
        return Promise.resolve();
      },
    );
    expect(done).toBe(true);
    expect(yields).toBeGreaterThan(0);
    for (const m of messages) if (m.type === 'meshData') expect(m.bytes.length).toBeLessThanOrEqual(MESH_CHUNK_BYTES);
    const assembler = new MeshAssembler();
    for (const m of messages) assembler.receive(m);
    const rebuilt = assembler.take([9, 7, 8]);
    expect(rebuilt).not.toBeNull();
    const [nine, seven, eight] = rebuilt!;
    expectSameMesh(seven, meshes[0]![1]);
    expectSameMesh(eight, meshes[1]![1]);
    expectSameMesh(nine, meshes[2]![1]);
    // Held for the next bake, which names them without streaming.
    expect(assembler.take([8])?.[0]).toBe(eight);
    expect(assembler.take([7])).toBeNull();
  });

  it('an abandoned stream costs a bake of held meshes nothing', async () => {
    const assembler = new MeshAssembler();
    const held = triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const messages: MeshMessage[] = [];
    await streamMeshes(
      (m) => messages.push(m),
      [[1, held]],
      () => true,
      () => Promise.resolve(),
    );
    for (const m of messages) assembler.receive(m);
    expect(assembler.take([1])?.[0]).toEqual(held);
    // Model N starts streaming and is abandoned half way; the next bake is model M again.
    const partial: MeshMessage[] = [];
    await streamMeshes(
      (m) => partial.push(m),
      [[2, bigMesh(15_000)]],
      () => false,
      () => Promise.resolve(),
    );
    for (const m of partial) assembler.receive(m);
    expect(assembler.take([1])?.[0]).toEqual(held);
    expect(assembler.take([1, 2])).toBeNull();
  });

  it('stops when superseded, and an incomplete stream is not taken', async () => {
    const messages: MeshMessage[] = [];
    const done = await streamMeshes(
      (m) => messages.push(m),
      [[1, bigMesh(15_000)]],
      () => false,
      () => Promise.resolve(),
    );
    expect(done).toBe(false);
    const assembler = new MeshAssembler();
    for (const m of messages) assembler.receive(m);
    expect(assembler.take([1])).toBeNull();
    // A new stream drops the half-done one.
    assembler.receive({ type: 'meshBegin' });
    expect(assembler.take([])).toEqual([]);
  });
});
