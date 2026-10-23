import type { SceneDocument } from '@modelshot/scene';

// The document with the visibility the panel holds. Nodes and meshes that did not change keep their identity, so the
// light bake does not stream their geometry again.
export function withVisibility(
  base: SceneDocument,
  nodeVisible: readonly boolean[],
  meshVisible: readonly boolean[],
): SceneDocument {
  const nodes = base.nodes.map((node, i) =>
    node.visible === (nodeVisible[i] ?? node.visible) ? node : { ...node, visible: nodeVisible[i] ?? node.visible },
  );
  const meshes = base.meshes.map((mesh, i) =>
    mesh.visible === (meshVisible[i] ?? mesh.visible) ? mesh : { ...mesh, visible: meshVisible[i] ?? mesh.visible },
  );
  const same = nodes.every((node, i) => node === base.nodes[i]) && meshes.every((mesh, i) => mesh === base.meshes[i]);
  return same ? base : { ...base, nodes, meshes };
}

/** Visibility flags restored from the indices that were hidden; every other node or mesh is shown. */
export function visibilityFromHidden(count: number, hidden: readonly number[]): boolean[] {
  const flags: boolean[] = Array.from({ length: count }, () => true);
  for (const index of hidden) if (index < count) flags[index] = false;
  return flags;
}

export function hiddenIndices(visible: readonly boolean[]): number[] {
  return visible.flatMap((flag, index) => (flag ? [] : [index]));
}
