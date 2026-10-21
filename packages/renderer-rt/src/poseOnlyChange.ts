import type { SceneDocument, SceneNode } from '@modelshot/scene';

const sameVec = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => v === b[i]);

function sameRestNode(a: SceneNode, b: SceneNode): boolean {
  return (
    a.parent === b.parent &&
    a.visible === b.visible &&
    sameVec(a.pivot, b.pivot) &&
    sameVec(a.restRotation ?? a.rotation, b.restRotation ?? b.rotation) &&
    (a.meshes === b.meshes || (a.meshes.length === b.meshes.length && sameVec(a.meshes, b.meshes)))
  );
}

/**
 * Whether `next` differs from `previous` at most in its pose (node rotations and translations, `pose`): the same
 * meshes, materials and textures arrays and nodes with the same parents, pivots, rest rotations, visibility and
 * meshes, as `poseScene` returns them. Everything a lightmap layout reads is then unchanged, so it can be kept.
 */
export function poseOnlyChange(previous: SceneDocument, next: SceneDocument): boolean {
  if (previous === next) return true;
  if (
    next.meshes !== previous.meshes ||
    next.materials !== previous.materials ||
    next.textures !== previous.textures ||
    next.nodes.length !== previous.nodes.length
  ) {
    return false;
  }
  return next.nodes.every((node, i) => {
    const before = previous.nodes[i];
    return before !== undefined && sameRestNode(before, node);
  });
}
