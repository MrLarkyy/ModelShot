import { describe, expect, it } from 'vitest';
import {
  mat4TransformPoint,
  PLAYER_BONES,
  PLAYER_POSE_PRESETS,
  playerPosePreset,
  poseScene,
  worldMatrices,
  type PlayerPosePresetName,
  type SceneDocument,
} from '../src/index';
import { playerRig } from './sceneDocs';

const SHOULDER_Y = 24;

/** World position of a hand anchor (the hand node's pivot) under the preset. */
function hand(preset: PlayerPosePresetName, side: 'right' | 'left'): [number, number, number] {
  const pose = PLAYER_POSE_PRESETS[preset];
  const doc: SceneDocument = poseScene(playerRig(), pose).document;
  const index = doc.nodes.findIndex((n) => n.name === `${side}_hand`);
  const node = doc.nodes[index];
  const world = worldMatrices(doc.nodes)[index];
  if (!node || !world) throw new Error('no hand');
  return mat4TransformPoint(world, node.pivot);
}

describe('player pose presets', () => {
  it('idle is the rest pose', () => {
    expect(hand('idle', 'right')).toEqual([6, 12, 0]);
    expect(hand('idle', 'left')).toEqual([-6, 12, 0]);
  });

  it('hold brings the right hand in front of the body and below the shoulder', () => {
    const [x, y, z] = hand('hold', 'right');
    expect(z).toBeLessThan(-2);
    expect(y).toBeLessThan(SHOULDER_Y);
    expect(x).toBeCloseTo(6, 6);
    expect(hand('hold', 'left')).toEqual([-6, 12, 0]);
  });

  it('wave lifts the left hand above the shoulder, out to the side', () => {
    const [x, y] = hand('wave', 'left');
    expect(y).toBeGreaterThan(SHOULDER_Y);
    expect(x).toBeLessThan(-6);
  });

  it('walk swings the arms opposite to each other and to the legs', () => {
    expect(hand('walk', 'right')[2]).toBeLessThan(-2);
    expect(hand('walk', 'left')[2]).toBeGreaterThan(2);
    const bones = Object.fromEntries(PLAYER_POSE_PRESETS.walk.bones.map((b) => [b.bone, b.rotation[0]]));
    expect(bones).toEqual({ right_arm: 30, left_arm: -30, right_leg: -30, left_leg: 30 });
  });

  it('are frozen data naming only player bones', () => {
    expect(Object.keys(PLAYER_POSE_PRESETS)).toEqual(['idle', 'walk', 'hold', 'wave']);
    for (const [name, pose] of Object.entries(PLAYER_POSE_PRESETS)) {
      expect(pose.name).toBe(name);
      expect(Object.isFrozen(pose) && Object.isFrozen(pose.bones)).toBe(true);
      for (const bone of pose.bones) {
        expect(PLAYER_BONES).toContain(bone.bone);
        expect(Object.isFrozen(bone) && Object.isFrozen(bone.rotation)).toBe(true);
      }
      expect(poseScene(playerRig(), pose).unmatchedBones).toEqual([]);
    }
  });

  it('looks presets up by own name only', () => {
    expect(playerPosePreset('wave')).toBe(PLAYER_POSE_PRESETS.wave);
    for (const name of ['constructor', '__proto__', 'toString', 'nope', ''])
      expect(playerPosePreset(name)).toBeUndefined();
  });
});
