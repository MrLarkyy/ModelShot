import type { SceneDocument } from '@modelshot/scene';

export interface LockState {
  readonly lockedNodes: readonly boolean[];
  readonly lockedMeshes: readonly boolean[];
}

/** Whether a node is locked itself or below a locked node. */
export function isNodeLocked(doc: SceneDocument, lock: LockState, node: number): boolean {
  let at = node;
  for (let steps = 0; at >= 0 && steps <= doc.nodes.length; steps++) {
    if (lock.lockedNodes[at] === true) return true;
    at = doc.nodes[at]?.parent ?? -1;
  }
  return false;
}

export function isMeshLocked(doc: SceneDocument, lock: LockState, mesh: number): boolean {
  if (lock.lockedMeshes[mesh] === true) return true;
  const node = doc.meshes[mesh]?.node ?? -1;
  return node >= 0 && isNodeLocked(doc, lock, node);
}
