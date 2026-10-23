// The visibility flags of the panel and the record that keeps them: hidden nodes and meshes by index.
/** Visibility flags restored from the indices that were hidden; every other node or mesh is shown. */
export function visibilityFromHidden(count: number, hidden: readonly number[]): boolean[] {
  const flags: boolean[] = Array.from({ length: count }, () => true);
  for (const index of hidden) if (index < count) flags[index] = false;
  return flags;
}

/** The indices of the flags that are off. */
export function hiddenIndices(visible: readonly boolean[]): number[] {
  return visible.flatMap((flag, index) => (flag ? [] : [index]));
}
