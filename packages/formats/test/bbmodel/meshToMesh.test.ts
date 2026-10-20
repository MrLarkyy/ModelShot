import type { SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { fixture, mesh, meshFace, model, type FixtureName } from './fixtures';
import { worldVertices } from './serializeScene';

const json = (value: unknown): string => JSON.stringify(value);
const MESH_FIXTURES: FixtureName[] = ['mesh-shapes', 'mesh-plane', 'alpha-plane', 'format5-groups'];

function vec(array: Float32Array, index: number, size = 3): number[] {
  return [...array.slice(index * size, index * size + size)];
}

function hasVertex(vertices: number[][], position: readonly number[]): boolean {
  return vertices.some((v) => position.every((x, k) => Math.abs((v[k] ?? NaN) - x) < 1e-4));
}

describe('meshElementToMesh', () => {
  it.each(MESH_FIXTURES)('%s: unit normals that agree with every triangle’s winding', (name) => {
    for (const sceneMesh of loadBbmodel(fixture(name)).scene.meshes) {
      for (let v = 0; v < sceneMesh.normals.length / 3; v++) {
        expect(Math.hypot(...vec(sceneMesh.normals, v))).toBeCloseTo(1, 6);
      }
      for (let t = 0; t < sceneMesh.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => vec(sceneMesh.positions, sceneMesh.indices[t + k] ?? -1));
        const u = a!.map((x, k) => (b![k] ?? NaN) - x);
        const w = a!.map((x, k) => (c![k] ?? NaN) - x);
        const winding = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        const length = Math.hypot(...winding);
        const normal = vec(sceneMesh.normals, sceneMesh.indices[t] ?? -1);
        const agreement = winding.reduce((s, x, k) => s + x * (normal[k] ?? NaN), 0) / length;
        expect(agreement, `${sceneMesh.name} triangle ${t / 3}`).toBeGreaterThan(0.99);
      }
    }
  });

  it('mesh-shapes: drops the 2-vertex and the collinear face, keeps the null-texture face untextured', () => {
    const { scene, warnings } = loadBbmodel(fixture('mesh-shapes'));
    expect(warnings).toEqual([]);
    const shapes = scene.meshes[0];
    // triangle 1 + zigzag quad 2 + pentagon 3 + L hexagon 4 + floor 2 + null-texture quad 2.
    expect((shapes?.indices.length ?? 0) / 3).toBe(14);
    expect(shapes?.groups).toEqual([
      { material: -1, start: 0, count: 12, doubleSided: true },
      { material: 0, start: 12, count: 24, doubleSided: true },
      { material: 1, start: 36, count: 6, doubleSided: true },
    ]);
  });

  it('UVs are the face uv over the texture UV size, and each vertex carries its face’s uv bounding box', () => {
    const text = json(
      model({
        textures: [{ name: 't', uv_width: 32, uv_height: 64 }],
        elements: [
          mesh({
            faces: {
              f: {
                vertices: ['a', 'b', 'c'],
                uv: { a: [4, 60], b: [20, 60], c: [8, 12] },
                texture: 0,
              },
            },
          }),
        ],
      }),
    );
    const sceneMesh = loadBbmodel(text).scene.meshes[0] as SceneMesh;
    expect([0, 1, 2].map((v) => vec(sceneMesh.uvs, v, 2))).toEqual([
      [4 / 32, 60 / 64],
      [20 / 32, 60 / 64],
      [8 / 32, 12 / 64],
    ]);
    for (let v = 0; v < 3; v++) expect(vec(sceneMesh.uvRects, v, 4)).toEqual([4 / 32, 12 / 64, 20 / 32, 60 / 64]);
  });

  it('untextured faces use the project resolution as UV size', () => {
    const face = { vertices: ['a', 'b', 'c'], uv: { a: [0, 0], b: [8, 0], c: [0, 16] } };
    const text = json(model({ resolution: { width: 16, height: 32 }, elements: [mesh({ faces: { f: face } })] }));
    const sceneMesh = loadBbmodel(text).scene.meshes[0] as SceneMesh;
    expect(vec(sceneMesh.uvs, 1, 2)).toEqual([0.5, 0]);
    expect(vec(sceneMesh.uvs, 2, 2)).toEqual([0, 0.5]);
  });

  it('vertices are relative to the origin and turn about it, inside a rotated group', () => {
    const { scene } = loadBbmodel(fixture('mesh-shapes'));
    expect(scene.meshes[1]?.name).toBe('turned');
    // a = (−4, 0, 0) from origin (0, 10, −6): Y 30 → (−4 cos 30, 0, 4 sin 30) + origin = (−3.4641, 10, −4);
    // group X −20 about (0, 0, −6): (y, z − (−6)) = (10, 2) → (10 cos 20 + 2 sin 20, −10 sin 20 + 2 cos 20) − (0, 6).
    const c = Math.cos(Math.PI / 9);
    const s = Math.sin(Math.PI / 9);
    const expected = [-4 * Math.cos(Math.PI / 6), 10 * c + 2 * s, -10 * s + 2 * c - 6];
    expect(hasVertex(worldVertices(scene, 1), expected)).toBe(true);
    // e = (0, 9, 0) lies on the Y axis of the mesh: Y 30 leaves it at (0, 19, −6); X −20 about (0, 0, −6).
    expect(hasVertex(worldVertices(scene, 1), [0, 19 * c, -19 * s - 6])).toBe(true);
  });

  it('groups faces by material, then single- before double-sided', () => {
    const textures = [
      { name: 'front', render_sides: 'front' },
      { name: 'double', render_sides: 'double' },
    ];
    const vertices = { a: [0, 0, 0], b: [1, 0, 0], c: [1, 1, 0], d: [0, 1, 0], e: [0, 0, 1], f: [1, 0, 1] };
    const faces = {
      d1: meshFace(['a', 'b', 'c'], { texture: 1 }),
      f0: meshFace(['a', 'c', 'd'], { texture: 0 }),
      blank: meshFace(['a', 'e', 'f']),
      d2: meshFace(['b', 'f', 'c'], { texture: 1 }),
    };
    const text = json(model({ textures, elements: [mesh({ vertices, faces })] }));
    expect(loadBbmodel(text).scene.meshes[0]?.groups).toEqual([
      { material: -1, start: 0, count: 3, doubleSided: true },
      { material: 0, start: 3, count: 3, doubleSided: false },
      { material: 1, start: 6, count: 6, doubleSided: true },
    ]);
  });

  it('an empty mesh loads with no triangles', () => {
    const { scene } = loadBbmodel(json(model({ elements: [mesh({ vertices: {}, faces: {} })] })));
    expect(scene.meshes[0]).toMatchObject({ name: 'mesh', indices: new Uint32Array(0), groups: [] });
  });

  it('carries visibility and render order', () => {
    const text = json(model({ elements: [mesh({ visibility: false, render_order: 'in_front' })] }));
    expect(loadBbmodel(text).scene.meshes[0]).toMatchObject({ visible: false, renderOrder: 1 });
  });
});
