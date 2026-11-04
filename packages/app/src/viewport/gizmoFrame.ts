import {
  mat4Rotation,
  mat4TransformDirection,
  mat4TransformPoint,
  worldMatrices,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';

export type GizmoMode = 'move' | 'rotate';

export interface GizmoFrame {
  /** World position of the node's pivot. */
  readonly origin: Vec3;
  /** World direction of each handle: the node's parent-space axes for a move, the axes its Euler angles turn about for a rotation. */
  readonly axes: readonly [Vec3, Vec3, Vec3];
}

const E: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Where a node's gizmo stands and which way its handles point, or null for a node the document does not have. */
export function gizmoFrame(doc: SceneDocument, node: number, mode: GizmoMode): GizmoFrame | null {
  const target = doc.nodes[node];
  if (!target) return null;
  const world = worldMatrices(doc.nodes);
  const own = world[node];
  if (!own) return null;
  const parent = target.parent >= 0 ? world[target.parent] : undefined;
  const toWorld = (v: Vec3): Vec3 => unit(parent ? mat4TransformDirection(parent, v) : v);
  const [rx, ry, rz] = target.rotation;
  const local: readonly [Vec3, Vec3, Vec3] =
    mode === 'move'
      ? E
      : [
          mat4TransformDirection(mat4Rotation([0, ry, rz]), E[0]),
          mat4TransformDirection(mat4Rotation([0, 0, rz]), E[1]),
          E[2],
        ];
  void rx;
  return {
    origin: mat4TransformPoint(own, target.pivot),
    axes: [toWorld(local[0]), toWorld(local[1]), toWorld(local[2])],
  };
}
