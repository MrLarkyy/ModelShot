import type { SceneDocument, SceneMesh, SceneNode } from '@modelshot/scene';

const GRID_X = 16;
const GRID_Z = 16;
const LAYERS = 8;
const CUBE = 8;
const SPACING = 12;
/** Cubes per side of a group: 4 x 4 cubes per group node, 128 groups. */
const GROUP_SIDE = 4;
/** Atlas cells of rt-showcase.bbmodel (8x8 cells, a 6x6 face inside a 1-texel sentinel ring). */
const OPAQUE_CELLS = [0, 2, 3, 4, 8];
const GLASS_CELL = 6;
const ATLAS_SIZE = 32;

type Corner = readonly [number, number, number];

/** Face corners top-left, top-right, bottom-right, bottom-left seen from outside, in unit-cube coordinates. */
const FACES: readonly { normal: Corner; corners: readonly Corner[] }[] = [
  {
    normal: [0, 0, 1],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  {
    normal: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
      [0, 0, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
];

function cellRect(cell: number): [number, number, number, number] {
  const x = (cell % 4) * 8 + 1;
  const y = Math.floor(cell / 4) * 8 + 1;
  return [x / ATLAS_SIZE, y / ATLAS_SIZE, (x + 6) / ATLAS_SIZE, (y + 6) / ATLAS_SIZE];
}

function cubeMesh(id: number, node: number, origin: readonly [number, number, number]): SceneMesh {
  const vertices = 24;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const uvRects = new Float32Array(vertices * 4);
  const indices = new Uint32Array(36);
  FACES.forEach((face, f) => {
    // Every seventh cube shows partial-alpha glass on its south face, so the transparency pass has work.
    const cell = f === 0 && id % 7 === 0 ? GLASS_CELL : (OPAQUE_CELLS[(id + f) % OPAQUE_CELLS.length] ?? 0);
    const rect = cellRect(cell);
    const cornerUvs = [
      [rect[0], rect[1]],
      [rect[2], rect[1]],
      [rect[2], rect[3]],
      [rect[0], rect[3]],
    ];
    const v = f * 4;
    face.corners.forEach((corner, c) => {
      positions.set(
        corner.map((unit, axis) => (origin[axis] ?? 0) + unit * CUBE),
        (v + c) * 3,
      );
      normals.set(face.normal, (v + c) * 3);
      uvs.set(cornerUvs[c] ?? [0, 0], (v + c) * 2);
      uvRects.set(rect, (v + c) * 4);
    });
    indices.set([v, v + 3, v + 2, v, v + 2, v + 1], f * 6);
  });
  return {
    name: `cube-${id}`,
    sourceId: '',
    node,
    visible: true,
    positions,
    normals,
    uvs,
    uvRects,
    indices,
    groups: [{ material: 0, start: 0, count: indices.length }],
  };
}

function groupNode(index: number, meshes: number[]): SceneNode {
  return {
    name: `group-${index}`,
    sourceId: '',
    parent: -1,
    children: [],
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    translation: [0, 0, 0],
    visible: true,
    meshes,
  };
}

/**
 * The frame-time benchmark: a 16 x 16 x 8 grid of textured cubes (2,048 cubes, 24,576 triangles) using the showcase
 * atlas, one mesh per cube in 128 groups of 4 x 4 cubes, as the Blockbench loader produces a grouped model. The
 * renderer batches per node, so this costs one draw per group and pass. Built in code and deterministic.
 */
export function benchScene(showcase: SceneDocument): SceneDocument {
  const atlas = showcase.textures[0];
  if (!atlas) throw new Error('the showcase model has no atlas texture');
  const groupsPerRow = GRID_X / GROUP_SIDE;
  const groupsPerLayer = groupsPerRow * (GRID_Z / GROUP_SIDE);
  const groupMeshes: number[][] = Array.from({ length: LAYERS * groupsPerLayer }, () => []);
  const meshes = Array.from({ length: LAYERS * GRID_Z * GRID_X }, (_, id) => {
    const gx = id % GRID_X;
    const gz = Math.floor(id / GRID_X) % GRID_Z;
    const layer = Math.floor(id / (GRID_X * GRID_Z));
    const group = layer * groupsPerLayer + Math.floor(gz / GROUP_SIDE) * groupsPerRow + Math.floor(gx / GROUP_SIDE);
    groupMeshes[group]?.push(id);
    return cubeMesh(id, group, [(gx - GRID_X / 2) * SPACING, layer * SPACING, (gz - GRID_Z / 2) * SPACING]);
  });
  const nodes = groupMeshes.map((ids, index) => groupNode(index, ids));
  return {
    formatVersion: showcase.formatVersion,
    source: showcase.source,
    nodes,
    meshes,
    materials: [{ name: 'atlas', texture: 0 }],
    textures: [atlas],
    rootNodes: nodes.map((_, index) => index),
  };
}
