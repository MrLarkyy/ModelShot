/** What a mesh group shares: one material and one sidedness. */
export interface GroupKey {
  readonly material: number;
  readonly doubleSided: boolean;
}

/** Orders faces by material, then single- before double-sided, so each key becomes one consecutive group. */
export function compareGroupKey(a: GroupKey, b: GroupKey): number {
  return a.material - b.material || Number(a.doubleSided) - Number(b.doubleSided);
}
