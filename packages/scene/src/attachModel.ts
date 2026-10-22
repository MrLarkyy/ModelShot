import { checkName, checkVec3 } from './checkValues';
import { MAX_POSE_ROTATION_DEG, MAX_POSE_TRANSLATION } from './poseScene';
import type { SceneAttachment } from './SceneAttachment';
import type { SceneDocument } from './SceneDocument';
import type { SceneMesh } from './SceneMesh';
import type { SceneNode } from './SceneNode';
import type { Vec3 } from './Vec3';

export const MAX_ATTACH_SCALE = 16;

export interface AttachOptions {
  /** Host node index, or the name of the first host node with that name (`'right_hand'`). */
  readonly bone: number | string;
  /** Name of the attachment node and record; absent: `'attachment'`. */
  readonly name?: string;
  /** Model units, |v| ≤ 4096, applied after `scale`; absent: 0. */
  readonly offset?: Vec3;
  /** Euler degrees, |v| ≤ 360, about the bone's pivot; absent: 0. */
  readonly rotation?: Vec3;
  /** Uniform scale in (0, 16]; absent: 1. */
  readonly scale?: number;
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * `host` with `item` merged under one of its nodes, so the item follows that bone through every pose. A new
 * attachment node (child of the bone, pivot = the bone's pivot, rest rotation `options.rotation`) is appended, then
 * the item's nodes, meshes, materials and textures with every index remapped; the item's vertices, pivots and
 * translations become `scale · x + offset + bone pivot`. The attached item's world position is therefore
 * `world(bone) · T(pivot) · R(rotation) · (scale · x + offset)`. The host's `pose` record, if any, is kept; the item's
 * `pose` record is dropped while its nodes keep their posed rotations and `restRotation`, so the next `poseScene` of
 * the merged document returns them to rest. The host's `animations` and `playback` are kept (host nodes keep their
 * indices), the item's are not merged; item nodes keep their `scale`. Bad options throw a `RangeError` naming the
 * path; inputs are never mutated.
 */
export function attachModel(host: SceneDocument, item: SceneDocument, options: AttachOptions): SceneDocument {
  const bone = resolveBone(host, options.bone);
  const name = options.name === undefined ? 'attachment' : checkName(options.name, 'options.name');
  const offset =
    options.offset === undefined ? ZERO : checkVec3(options.offset, 'options.offset', MAX_POSE_TRANSLATION);
  const rotation =
    options.rotation === undefined ? ZERO : checkVec3(options.rotation, 'options.rotation', MAX_POSE_ROTATION_DEG);
  const scale = options.scale ?? 1;
  if (typeof scale !== 'number' || !(scale > 0 && scale <= MAX_ATTACH_SCALE)) {
    throw new RangeError(`options.scale: expected a number in (0, ${MAX_ATTACH_SCALE}]`);
  }

  const anchor = host.nodes[bone]?.pivot ?? ZERO;
  const shift: Vec3 = [offset[0] + anchor[0], offset[1] + anchor[1], offset[2] + anchor[2]];
  const place = (p: Vec3): Vec3 => [scale * p[0] + shift[0], scale * p[1] + shift[1], scale * p[2] + shift[2]];
  const attachIndex = host.nodes.length;
  const nodeBase = attachIndex + 1;
  const meshBase = host.meshes.length;
  const materialBase = host.materials.length;
  const textureBase = host.textures.length;
  const nodeOf = (index: number): number => (index < 0 ? attachIndex : index + nodeBase);

  const attachNode: SceneNode = {
    name,
    sourceId: '',
    parent: bone,
    children: item.rootNodes.map((root) => root + nodeBase),
    pivot: anchor,
    rotation,
    restRotation: rotation,
    translation: ZERO,
    visible: true,
    meshes: item.meshes.flatMap((mesh, m) => (mesh.node < 0 ? [m + meshBase] : [])),
  };
  const itemNodes = item.nodes.map((node): SceneNode => ({
    ...node,
    parent: nodeOf(node.parent),
    children: node.children.map((child) => child + nodeBase),
    pivot: place(node.pivot),
    translation: [scale * node.translation[0], scale * node.translation[1], scale * node.translation[2]],
    meshes: node.meshes.map((mesh) => mesh + meshBase),
  }));
  const itemMeshes = item.meshes.map((mesh): SceneMesh => ({
    ...mesh,
    node: nodeOf(mesh.node),
    positions: mesh.positions.map((value, i) => scale * value + (shift[i % 3] ?? 0)),
    groups: mesh.groups.map((group) => ({
      ...group,
      material: group.material < 0 ? group.material : group.material + materialBase,
    })),
  }));
  const record: SceneAttachment = { name, bone, node: attachIndex, offset, rotation, scale, source: item.source };
  const itemRecords = (item.attachments ?? []).map((attachment): SceneAttachment => ({
    ...attachment,
    bone: attachment.bone + nodeBase,
    node: attachment.node + nodeBase,
  }));

  return {
    ...host,
    nodes: [
      ...host.nodes.map((node, index) =>
        index === bone ? { ...node, children: [...node.children, attachIndex] } : node,
      ),
      attachNode,
      ...itemNodes,
    ],
    meshes: [...host.meshes, ...itemMeshes],
    materials: [
      ...host.materials,
      ...item.materials.map((material) => {
        const shift = (texture: number) => (texture < 0 ? texture : texture + textureBase);
        return {
          ...material,
          texture: shift(material.texture),
          ...(material.layers ? { layers: material.layers.map(shift) } : {}),
        };
      }),
    ],
    textures: [...host.textures, ...item.textures],
    attachments: [...(host.attachments ?? []), record, ...itemRecords],
  };
}

function resolveBone(host: SceneDocument, bone: unknown): number {
  if (typeof bone === 'number') {
    if (Number.isInteger(bone) && bone >= 0 && bone < host.nodes.length) return bone;
    throw new RangeError(`options.bone: expected a node index in 0..${host.nodes.length - 1}`);
  }
  if (typeof bone === 'string') {
    const index = host.nodes.findIndex((node) => node.name === bone);
    if (index >= 0) return index;
    throw new RangeError('options.bone: no node has that name');
  }
  throw new RangeError('options.bone: expected a node index or name');
}
