import type { SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { MESH_CHUNK_BYTES, MeshAssembler, streamMeshes, type MeshMessage } from '../src/bake/meshStream';
import { triangleMesh } from './testScenes';

function bigMesh(triangles: number): SceneMesh {
  const positions = Array.from({ length: triangles * 9 }, (_, i) => (i * 7) % 101);
  return {
    ...triangleMesh(positions),
    name: 'big',
    renderOrder: 2,
    groups: [{ material: 0, start: 0, count: triangles * 3, doubleSided: true }],
  };
}

describe('mesh stream', () => {
  it('rebuilds every mesh exactly from transferred chunks, yielding between them', async () => {
    const meshes: [number, SceneMesh][] = [
      [7, triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0])],
      [8, bigMesh(40_000)],
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
    expect(seven).toEqual(meshes[0]![1]);
    expect(eight).toEqual(meshes[1]![1]);
    expect(nine).toEqual(meshes[2]![1]);
    // Held for the next bake, which names them without streaming.
    expect(assembler.take([8])?.[0]).toBe(eight);
    expect(assembler.take([7])).toBeNull();
  });

  it('stops when superseded, and an incomplete stream is not taken', async () => {
    const messages: MeshMessage[] = [];
    const done = await streamMeshes(
      (m) => messages.push(m),
      [[1, bigMesh(100_000)]],
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
