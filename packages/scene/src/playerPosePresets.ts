import type { ScenePose } from './ScenePose';

export type PlayerPosePresetName = 'idle' | 'walk' | 'hold' | 'wave';

// The player faces −Z with its right side at +X and its limbs hanging down from their pivots, so a positive X
// rotation swings an arm or leg forward, and a negative Z rotation lifts the left arm sideways.
const PRESETS: Record<PlayerPosePresetName, ScenePose> = {
  idle: { name: 'idle', bones: [] },
  walk: {
    name: 'walk',
    bones: [
      { bone: 'right_arm', rotation: [30, 0, 0] },
      { bone: 'left_arm', rotation: [-30, 0, 0] },
      { bone: 'right_leg', rotation: [-30, 0, 0] },
      { bone: 'left_leg', rotation: [30, 0, 0] },
    ],
  },
  hold: {
    name: 'hold',
    bones: [
      { bone: 'head', rotation: [-10, 0, 0] },
      { bone: 'right_arm', rotation: [40, 0, 0] },
    ],
  },
  wave: {
    name: 'wave',
    bones: [
      { bone: 'right_arm', rotation: [0, 0, 5] },
      { bone: 'left_arm', rotation: [0, 0, -150] },
    ],
  },
};

for (const pose of Object.values(PRESETS)) {
  for (const bone of pose.bones) Object.freeze(Object.freeze(bone).rotation);
  Object.freeze(pose.bones);
  Object.freeze(pose);
}

/** The built-in player poses as data; apply one with `poseScene`. `idle` is the rest pose. */
export const PLAYER_POSE_PRESETS: Readonly<Record<PlayerPosePresetName, ScenePose>> = Object.freeze(PRESETS);

/** The preset of that name (own keys only, so `constructor` or `__proto__` give `undefined`). */
export function playerPosePreset(name: string): ScenePose | undefined {
  return Object.hasOwn(PLAYER_POSE_PRESETS, name) ? PLAYER_POSE_PRESETS[name as PlayerPosePresetName] : undefined;
}
