import type { SceneDocument, SceneMesh } from '@modelshot/scene';

type Point = readonly [number, number, number];

/** The textured part of the `edges` scene as a Blockbench model: a cube and a zero-thickness card (MS-15). */
export function edgesBbmodel(texture: unknown): string {
  const red = { uv: [0, 0, 4, 4], texture: 0 };
  const blue = { uv: [8, 0, 12, 4], texture: 0 };
  return JSON.stringify({
    meta: { format_version: '4.10', model_format: 'free', box_uv: false },
    resolution: { width: 16, height: 16 },
    elements: [
      {
        name: 'cube',
        type: 'cube',
        uuid: 'edges-cube',
        from: [-12, 0, 2],
        to: [-4, 8, 10],
        origin: [0, 0, 0],
        faces: { north: red, east: red, south: red, west: red, up: red, down: red },
      },
      {
        name: 'card',
        type: 'cube',
        uuid: 'edges-card',
        from: [-2, 0, -10],
        to: [6, 8, -10],
        origin: [0, 0, 0],
        faces: { north: blue, south: blue },
      },
    ],
    outliner: ['edges-cube', 'edges-card'],
    textures: [texture],
  });
}

/** Faces (corners counter-clockwise from outside) as one untextured mesh, every face with its own vertices. */
function flatFaces(name: string, faces: readonly (readonly Point[])[]): SceneMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const base = positions.length / 3;
    const [a, b, c] = face as [Point, Point, Point];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(...n);
    for (const p of face) {
      positions.push(...p);
      normals.push(...n.map((x) => x / length));
    }
    for (let i = 1; i + 1 < face.length; i++) indices.push(base, base + i, base + i + 1);
  }
  return untextured(name, positions, normals, indices);
}

function untextured(name: string, positions: number[], normals: number[], indices: number[]): SceneMesh {
  const vertices = positions.length / 3;
  return {
    name,
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(vertices * 2),
    uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  };
}

/** A smooth sphere with welded vertices (shared by every triangle around them) and normals along the radius. */
function sphere(name: string, center: Point, radius: number, rings: number, segments: number): SceneMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertex = (n: Point): number => {
    positions.push(center[0] + n[0] * radius, center[1] + n[1] * radius, center[2] + n[2] * radius);
    normals.push(...n);
    return positions.length / 3 - 1;
  };
  const top = vertex([0, 1, 0]);
  const ring: number[][] = [];
  for (let r = 1; r < rings; r++) {
    const phi = (r / rings) * Math.PI;
    ring.push(
      Array.from({ length: segments }, (_, s) => {
        const theta = (s / segments) * 2 * Math.PI;
        return vertex([Math.sin(phi) * Math.cos(theta), Math.cos(phi), -Math.sin(phi) * Math.sin(theta)]);
      }),
    );
  }
  const bottom = vertex([0, -1, 0]);
  const at = (r: number, s: number): number => ring[r]?.[s % segments] ?? 0;
  for (let s = 0; s < segments; s++) indices.push(top, at(0, s), at(0, s + 1));
  for (let r = 0; r + 1 < ring.length; r++) {
    for (let s = 0; s < segments; s++) {
      indices.push(at(r, s), at(r + 1, s), at(r + 1, s + 1), at(r, s), at(r + 1, s + 1), at(r, s + 1));
    }
  }
  for (let s = 0; s < segments; s++) indices.push(bottom, at(ring.length - 1, s + 1), at(ring.length - 1, s));
  return untextured(name, positions, normals, indices);
}

/**
 * Edge rounding (MS-15): `cubeAndCard` (`edgesBbmodel` loaded) plus a Blockbench-style wedge (flat faces with their own
 * vertices: a 45° slope, a crease-free prism), a single-sided plane and a smooth welded sphere. The cube and the wedge
 * have sharp edges; the plane, the card (front and back coincide) and the sphere have none and must not change.
 */
export function edgesScene(cubeAndCard: SceneDocument): SceneDocument {
  const wedge = flatFaces('wedge', [
    [
      [2, 0, 10],
      [10, 0, 10],
      [2, 8, 10],
    ],
    [
      [2, 0, 2],
      [2, 8, 2],
      [10, 0, 2],
    ],
    [
      [2, 0, 2],
      [10, 0, 2],
      [10, 0, 10],
      [2, 0, 10],
    ],
    [
      [2, 0, 2],
      [2, 0, 10],
      [2, 8, 10],
      [2, 8, 2],
    ],
    [
      [10, 0, 10],
      [10, 0, 2],
      [2, 8, 2],
      [2, 8, 10],
    ],
  ]);
  const plane = flatFaces('plane', [
    [
      [-16, 0, -8],
      [-8, 0, -8],
      [-8, 8, -8],
      [-16, 8, -8],
    ],
  ]);
  return {
    ...cubeAndCard,
    meshes: [...cubeAndCard.meshes, wedge, plane, sphere('sphere', [15, 4, -6], 4, 16, 24)],
  };
}

/** The sharp edges of the `edges` scene (the cube's 12, the wedge's 9) as world segments, for probes near them. */
export function edgesSceneSharpEdges(): [Point, Point][] {
  const box = (min: Point, max: Point): [Point, Point][] => {
    const corner = (i: number): Point => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    const edges: [Point, Point][] = [];
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([corner(i), corner(i | bit)]);
    }
    return edges;
  };
  const a0: Point = [2, 0, 10];
  const b0: Point = [10, 0, 10];
  const c0: Point = [2, 8, 10];
  const a1: Point = [2, 0, 2];
  const b1: Point = [10, 0, 2];
  const c1: Point = [2, 8, 2];
  return [
    ...box([-12, 0, 2], [-4, 8, 10]),
    [a0, b0],
    [b0, c0],
    [c0, a0],
    [a1, b1],
    [b1, c1],
    [c1, a1],
    [a0, a1],
    [b0, b1],
    [c0, c1],
  ];
}
