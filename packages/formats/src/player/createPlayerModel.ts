import {
  SCENE_FORMAT_VERSION,
  type SceneDocument,
  type SceneMaterial,
  type SceneNode,
  type Vec3,
} from '@modelshot/scene';
import { FACE_DIRECTIONS } from '../bbmodel/CubeFace';
import type { CubeFaceSpec } from '../bbmodel/CubeSpec';
import { cubeToMesh } from '../bbmodel/cubeToMesh';
import { boxUvLayout } from '../bbmodel/faceUv';
import { playerBones, playerParts, type PlayerPart } from './playerParts';
import type { PlayerModelOptions } from './PlayerModelOptions';
import type { SkinLoadResult } from './SkinLoadResult';

/** Below this alpha an outer-layer texel is a hole, as in Minecraft's cutout of the second layer. */
export const PLAYER_OUTER_ALPHA_CUTOFF = 0.1;

const BASE_MATERIAL = 0;
const OUTER_MATERIAL = 1;

/**
 * The standard player model for a skin from `loadSkin`: one mesh per box (named `head`, `hat`, `body`, `jacket`,
 * `right_arm`, `right_sleeve`, …), nodes named after `PLAYER_BONES`. The base layer is opaque whatever the texel alpha;
 * the outer layer is double-sided, alpha below 0.1 is a hole and other alpha blends order-independently. A legacy
 * 64 × 32 skin gets mirrored left limbs and a hat as its only outer layer. Invalid options throw a `RangeError`.
 */
export function createPlayerModel(skin: SkinLoadResult, options: PlayerModelOptions): SceneDocument {
  const { arms } = options;
  if (arms !== 'classic' && arms !== 'slim') throw new RangeError('options.arms must be "classic" or "slim"');
  const showOuterLayer = options.showOuterLayer ?? true;
  if (typeof showOuterLayer !== 'boolean') throw new RangeError('options.showOuterLayer must be a boolean');
  if (skin.layout !== 'modern' && skin.layout !== 'legacy')
    throw new RangeError('skin.layout must be modern or legacy');

  const bones = playerBones(arms);
  const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
  const parts = playerParts(arms, skin.layout);
  const meshes = parts.map((part) =>
    cubeToMesh(
      {
        name: part.name,
        sourceId: '',
        visible: !part.outer || showOuterLayer,
        min: inflated(part.min, -part.inflate),
        max: inflated(part.max, part.inflate),
        origin: [0, 0, 0],
        rotation: [0, 0, 0],
        renderOrder: part.renderOrder,
        faces: partFaces(part, skin.texture.uvWidth, skin.texture.uvHeight),
      },
      boneIndex.get(part.bone) ?? -1,
    ),
  );
  const nodes = bones.map((bone): SceneNode => ({
    name: bone.name,
    sourceId: '',
    parent: bone.parent === null ? -1 : (boneIndex.get(bone.parent) ?? -1),
    children: bones.flatMap((child, index) => (child.parent === bone.name ? [index] : [])),
    pivot: bone.pivot,
    rotation: [0, 0, 0],
    translation: [0, 0, 0],
    visible: true,
    meshes: parts.flatMap((part, index) => (part.bone === bone.name ? [index] : [])),
  }));
  const materials: SceneMaterial[] = [
    { name: 'skin', texture: 0, alphaMode: 'opaque' },
    { name: 'skin outer layer', texture: 0, alphaMode: 'blend', alphaCutoff: PLAYER_OUTER_ALPHA_CUTOFF },
  ];
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    source: { format: 'player', formatVersion: skin.layout === 'modern' ? '64x64' : '64x32', modelFormat: arms },
    nodes,
    meshes,
    materials,
    textures: [skin.texture],
    rootNodes: nodes.flatMap((node, index) => (node.parent < 0 ? [index] : [])),
  };
}

function inflated(corner: Vec3, by: number): Vec3 {
  return [corner[0] + by, corner[1] + by, corner[2] + by];
}

function partFaces(part: PlayerPart, uvWidth: number, uvHeight: number): CubeFaceSpec[] {
  const layout = boxUvLayout(part.size, part.uv, part.mirror);
  return FACE_DIRECTIONS.map((direction) => ({
    direction,
    uv: layout[direction],
    rotation: 0,
    material: part.outer ? OUTER_MATERIAL : BASE_MATERIAL,
    uvWidth,
    uvHeight,
    doubleSided: part.outer,
  }));
}
