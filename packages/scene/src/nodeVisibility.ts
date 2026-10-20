import type { SceneDocument } from './SceneDocument';

/** Effective visibility of every node, indexed like `nodes`: a hidden node hides its whole subtree. */
export function nodeVisibility(doc: SceneDocument): boolean[] {
  const visible: boolean[] = [];
  doc.nodes.forEach((node, index) => {
    const parentVisible = node.parent < 0 || (node.parent < index && visible[node.parent] === true);
    visible.push(node.visible && parentVisible);
  });
  return visible;
}

/** Whether a mesh is drawn: its own flag and its node's effective visibility (`visibility` from `nodeVisibility`). */
export function meshVisible(doc: SceneDocument, mesh: number, visibility: readonly boolean[]): boolean {
  const m = doc.meshes[mesh];
  return m !== undefined && m.visible && (m.node < 0 || visibility[m.node] === true);
}
