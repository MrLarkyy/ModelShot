import type { SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { fixture, mesh, meshFace, model, type FixtureName } from './fixtures';
import { worldVertices } from '../support/serializeScene';

const json = (value: unknown): string => JSON.stringify(value);
const MESH_FIXTURES: FixtureName[] = ['mesh-shapes', 'mesh-plane', 'alpha-plane', 'format5-groups', 'render-order'];

function vec(array: Float32Array, index: number, size = 3): number[] {
  return [...array.slice(index * size, index * size + size)];
}

function hasVertex(vertices: number[][], position: readonly number[]): boolean {
  return vertices.some((v) => position.every((x, k) => Math.abs((v[k] ?? NaN) - x) < 1e-4));
}

describe('meshElementToMesh', () => {
  it.each(MESH_FIXTURES)('%s: unit normals; flat ones agree with every triangle’s winding', (name) => {
    const smooth = new Set(['arch']);
    for (const sceneMesh of loadBbmodel(fixture(name)).scene.meshes) {
      for (let v = 0; v < sceneMesh.normals.length / 3; v++) {
        expect(Math.hypot(...vec(sceneMesh.normals, v))).toBeCloseTo(1, 6);
      }
      if (smooth.has(sceneMesh.name)) continue;
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

  it('smooth: each vertex gets the normalised average of the normals of the faces sharing its key', () => {
    const { scene } = loadBbmodel(fixture('mesh-shapes'));
    const arch = scene.meshes.find((m) => m.name === 'arch') as SceneMesh;
    expect(arch.positions.length / 3).toBe(16);
    for (let v = 0; v < 16; v++) {
      const [x = NaN, , z = NaN] = vec(arch.positions, v);
      const column = Math.round(Math.atan2(z, x + 11) / (Math.PI / 4));
      // Faces sit at 22.5° + 45° j; an inner column averages two of them, an end column has one.
      const degrees = column === 0 ? 22.5 : column === 4 ? 157.5 : column * 45;
      const angle = (degrees * Math.PI) / 180;
      const n = vec(arch.normals, v);
      [Math.cos(angle), 0, Math.sin(angle)].forEach((value, k) => expect(n[k]).toBeCloseTo(value, 4));
    }
  });

  it('smooth: the average is unweighted by face area, as Blockbench’s', () => {
    // A large face in z = 0 and a small one in x = 0 share the edge a–b.
    const vertices = { a: [0, 0, 0], b: [0, 1, 0], c: [10, 0, 0], d: [0, 0, -0.1] };
    const faces = { big: meshFace(['a', 'c', 'b']), small: meshFace(['a', 'b', 'd']) };
    const text = json(model({ elements: [mesh({ shading: 'smooth', vertices, faces })] }));
    const sceneMesh = loadBbmodel(text).scene.meshes[0] as SceneMesh;
    const shared = [0, 1, 2, 3, 4, 5].filter(
      (v) => vec(sceneMesh.positions, v)[0] === 0 && vec(sceneMesh.positions, v)[2] === 0,
    );
    expect(shared.length).toBe(4);
    for (const v of shared) {
      vec(sceneMesh.normals, v).forEach((value, k) =>
        expect(value).toBeCloseTo([-Math.SQRT1_2, 0, Math.SQRT1_2][k] ?? NaN, 6),
      );
    }
    // c and d belong to one face each and keep that face's normal.
    expect(vec(sceneMesh.normals, 1).map((x) => x || 0)).toEqual([0, 0, 1]);
  });

  it('flat (the default) keeps face normals', () => {
    const vertices = { a: [0, 0, 0], b: [0, 1, 0], c: [10, 0, 0], d: [0, 0, -0.1] };
    const faces = { big: meshFace(['a', 'c', 'b']), small: meshFace(['a', 'b', 'd']) };
    const sceneMesh = loadBbmodel(json(model({ elements: [mesh({ vertices, faces })] }))).scene.meshes[0] as SceneMesh;
    expect(vec(sceneMesh.normals, 0).map((x) => x || 0)).toEqual([0, 0, 1]);
    expect(vec(sceneMesh.normals, 3).map((x) => x || 0)).toEqual([-1, 0, 0]);
  });
});
