import { field, type JsonObject } from '../json/JsonObject';

/**
 * The format whose rules apply, as Blockbench's `processCompatibility` picks it: a missing or empty `model_format` is
 * `bedrock_old` when `bone_rig` is truthy and `java_block` otherwise. `declared` is the file's own value (`''` absent).
 */
export function effectiveModelFormat(meta: JsonObject, declared: string): string {
  if (declared) return declared;
  const boneRig = Boolean(field(meta, 'bone_rig'));
  return boneRig ? 'bedrock_old' : 'java_block';
}
