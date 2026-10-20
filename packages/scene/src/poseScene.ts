import { checkName, checkVec3 } from './checkValues';
import type { SceneDocument } from './SceneDocument';
import type { SceneNode } from './SceneNode';
import type { ScenePose, ScenePoseBone } from './ScenePose';
import type { Vec3 } from './Vec3';

export const MAX_POSE_BONES = 1024;
export const MAX_POSE_ROTATION_DEG = 360;
export const MAX_POSE_TRANSLATION = 4096;

export interface PoseResult {
  readonly document: SceneDocument;
  /** Bone names of the pose that no node carries, in pose order. */
  readonly unmatchedBones: readonly string[];
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * A copy of `doc` in `pose`, always computed from the rest pose: every node gets `rotation = rest + pose rotation`
 * (rest: `restRotation`, else `rotation`), `translation = pose translation` (0 when the node is not posed) and
 * `restRotation = rest`. So posing again replaces the previous pose instead of adding to it, and `null` restores
 * rest. A bone is matched to the first node with its name. The input is never mutated; a malformed pose throws a
 * `RangeError` naming the path of the bad value (`pose.bones[2].rotation[1]`).
 */
export function poseScene(doc: SceneDocument, pose: ScenePose | null): PoseResult {
  const checked = pose === null ? null : checkPose(pose);
  const firstByName = new Map<string, number>();
  doc.nodes.forEach((node, index) => {
    if (!firstByName.has(node.name)) firstByName.set(node.name, index);
  });
  const posed = new Map<number, ScenePoseBone>();
  const unmatchedBones: string[] = [];
  for (const bone of checked?.bones ?? []) {
    const index = firstByName.get(bone.bone);
    if (index === undefined) unmatchedBones.push(bone.bone);
    else posed.set(index, bone);
  }
  const nodes = doc.nodes.map((node, index): SceneNode => {
    const rest = node.restRotation ?? node.rotation;
    const bone = posed.get(index);
    const rotation: Vec3 = bone
      ? [rest[0] + bone.rotation[0], rest[1] + bone.rotation[1], rest[2] + bone.rotation[2]]
      : [rest[0], rest[1], rest[2]];
    return { ...node, rotation, translation: bone?.translation ?? ZERO, restRotation: rest };
  });
  const document: { -readonly [K in keyof SceneDocument]: SceneDocument[K] } = { ...doc, nodes };
  if (checked) document.pose = checked;
  else delete document.pose;
  return { document, unmatchedBones };
}

/** A validated copy, so a caller changing its pose object later never changes a posed document. */
function checkPose(pose: ScenePose): ScenePose {
  if (typeof pose !== 'object') throw new RangeError('pose: expected an object or null');
  const name = checkName(pose.name, 'pose.name');
  const bones: unknown = pose.bones;
  if (!Array.isArray(bones) || bones.length > MAX_POSE_BONES) {
    throw new RangeError(`pose.bones: expected an array of at most ${MAX_POSE_BONES} bones`);
  }
  const seen = new Map<string, number>();
  // Array.from visits the holes of a sparse array (map skips them), so a hole is reported as a bad bone.
  const checked = Array.from(bones as unknown[], (value, i): ScenePoseBone => {
    const path = `pose.bones[${i}]`;
    if (typeof value !== 'object' || value === null) throw new RangeError(`${path}: expected an object`);
    const bone = value as Partial<Record<keyof ScenePoseBone, unknown>>;
    const boneName = checkName(bone.bone, `${path}.bone`);
    const first = seen.get(boneName);
    if (first !== undefined) throw new RangeError(`${path}.bone: same bone as pose.bones[${first}]`);
    seen.set(boneName, i);
    const rotation = checkVec3(bone.rotation, `${path}.rotation`, MAX_POSE_ROTATION_DEG);
    if (bone.translation === undefined) return { bone: boneName, rotation };
    return {
      bone: boneName,
      rotation,
      translation: checkVec3(bone.translation, `${path}.translation`, MAX_POSE_TRANSLATION),
    };
  });
  return { name, bones: checked };
}
