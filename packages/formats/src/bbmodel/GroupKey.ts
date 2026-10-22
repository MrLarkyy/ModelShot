/** What a mesh group shares: one material, one sidedness and whether only camera rays see it. */
export interface GroupKey {
  readonly material: number;
  readonly doubleSided: boolean;
  /** `SceneMeshGroup.cameraOnly`; absent: false. */
  readonly cameraOnly?: boolean;
}

/**
 * Orders faces by material, then single- before double-sided, then ordinary before camera-only, so each key becomes
 * one consecutive group.
 */
export function compareGroupKey(a: GroupKey, b: GroupKey): number {
  return (
    a.material - b.material ||
    Number(a.doubleSided) - Number(b.doubleSided) ||
    Number(a.cameraOnly === true) - Number(b.cameraOnly === true)
  );
}
