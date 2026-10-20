/**
 * Node names of the standard player model. The six body parts are root nodes; `right_hand` and `left_hand` are
 * mesh-free children of the arms whose pivot is the end of the arm, the anchor an attached model hangs from.
 */
export const PLAYER_BONES = Object.freeze([
  'head',
  'body',
  'right_arm',
  'left_arm',
  'right_leg',
  'left_leg',
  'right_hand',
  'left_hand',
] as const);

export type PlayerBoneName = (typeof PLAYER_BONES)[number];
