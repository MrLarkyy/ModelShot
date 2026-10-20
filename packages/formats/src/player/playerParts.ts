import type { PlayerBoneName, Vec3 } from '@modelshot/scene';
import type { SkinLayout } from './SkinLoadResult';
import type { PlayerArms } from './PlayerModelOptions';

/** A node of the player rig; `parent` is a bone listed earlier, or null for a root. */
export interface PlayerBoneSpec {
  readonly name: PlayerBoneName;
  readonly parent: PlayerBoneName | null;
  readonly pivot: Vec3;
}

/** One box of the player: geometry before inflation, its box-UV size and skin offset, and how it is drawn. */
export interface PlayerPart {
  readonly name: string;
  readonly bone: PlayerBoneName;
  readonly outer: boolean;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly inflate: number;
  /** Box-UV size in skin pixels (whole numbers, from the un-inflated box). */
  readonly size: Vec3;
  readonly uv: readonly [number, number];
  /** Box-UV mirroring: the legacy layout draws the left limbs from the right limbs' texels. */
  readonly mirror: boolean;
  readonly renderOrder: number;
}

interface ArmShape {
  readonly width: number;
  /** Bottom of the arm; the slim arm hangs half a pixel lower, as in Minecraft. */
  readonly bottom: number;
  readonly pivotY: number;
}

const ARMS: Readonly<Record<PlayerArms, ArmShape>> = {
  classic: { width: 4, bottom: 12, pivotY: 22 },
  slim: { width: 3, bottom: 11.5, pivotY: 21.5 },
};

/**
 * Minecraft's player in Blockbench orientation (units of one skin pixel, y up, facing −Z, the player's right side at
 * +X). Arms and legs are roots like the body, as in Minecraft; the hands are anchors at the end of each arm.
 */
export function playerBones(arms: PlayerArms): PlayerBoneSpec[] {
  const arm = ARMS[arms];
  const hand = 4 + arm.width / 2;
  return [
    { name: 'head', parent: null, pivot: [0, 24, 0] },
    { name: 'body', parent: null, pivot: [0, 24, 0] },
    { name: 'right_arm', parent: null, pivot: [5, arm.pivotY, 0] },
    { name: 'left_arm', parent: null, pivot: [-5, arm.pivotY, 0] },
    { name: 'right_leg', parent: null, pivot: [1.9, 12, 0] },
    { name: 'left_leg', parent: null, pivot: [-1.9, 12, 0] },
    { name: 'right_hand', parent: 'right_arm', pivot: [hand, arm.bottom, 0] },
    { name: 'left_hand', parent: 'left_arm', pivot: [-hand, arm.bottom, 0] },
  ];
}

/**
 * Boxes in draw-independent order. Overlapping coplanar faces get different render orders so the scene's tie rule,
 * not the draw order, decides which shows: the legs overlap by 0.2 (left wins); of the outer layer the jacket is
 * beaten by the sleeves, the sleeves by the right pants, the right pants by the left pants.
 */
export function playerParts(arms: PlayerArms, layout: SkinLayout): PlayerPart[] {
  const arm = ARMS[arms];
  const legacy = layout === 'legacy';
  const armTop = arm.bottom + 12;
  const box = (
    name: string,
    bone: PlayerBoneName,
    min: Vec3,
    max: Vec3,
    size: Vec3,
    uv: readonly [number, number],
    extra: Partial<Pick<PlayerPart, 'outer' | 'inflate' | 'mirror' | 'renderOrder'>> = {},
  ): PlayerPart => ({
    name,
    bone,
    min,
    max,
    size,
    uv,
    outer: false,
    inflate: 0,
    mirror: false,
    renderOrder: 0,
    ...extra,
  });
  const outer = (part: PlayerPart, name: string, uv: readonly [number, number], renderOrder: number): PlayerPart => ({
    ...part,
    name,
    uv,
    outer: true,
    inflate: part.name === 'head' ? 0.5 : 0.25,
    mirror: false,
    renderOrder,
  });

  const head = box('head', 'head', [-4, 24, -4], [4, 32, 4], [8, 8, 8], [0, 0]);
  const body = box('body', 'body', [-4, 12, -2], [4, 24, 2], [8, 12, 4], [16, 16]);
  const armSize: Vec3 = [arm.width, 12, 4];
  const rightArm = box('right_arm', 'right_arm', [4, arm.bottom, -2], [4 + arm.width, armTop, 2], armSize, [40, 16]);
  const leftArm = box(
    'left_arm',
    'left_arm',
    [-4 - arm.width, arm.bottom, -2],
    [-4, armTop, 2],
    armSize,
    legacy ? [40, 16] : [32, 48],
    { mirror: legacy },
  );
  const legSize: Vec3 = [4, 12, 4];
  const rightLeg = box('right_leg', 'right_leg', [-0.1, 0, -2], [3.9, 12, 2], legSize, [0, 16]);
  const leftLeg = box('left_leg', 'left_leg', [-3.9, 0, -2], [0.1, 12, 2], legSize, legacy ? [0, 16] : [16, 48], {
    mirror: legacy,
    renderOrder: 1,
  });

  const hat = outer(head, 'hat', [32, 0], 0);
  if (legacy) return [head, hat, body, rightArm, leftArm, rightLeg, leftLeg];
  return [
    head,
    hat,
    body,
    outer(body, 'jacket', [16, 32], 0),
    rightArm,
    outer(rightArm, 'right_sleeve', [40, 32], 1),
    leftArm,
    outer(leftArm, 'left_sleeve', [48, 48], 1),
    rightLeg,
    outer(rightLeg, 'right_pants', [0, 32], 2),
    leftLeg,
    outer(leftLeg, 'left_pants', [0, 48], 3),
  ];
}
