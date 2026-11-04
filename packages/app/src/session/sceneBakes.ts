/** Which step of a setup change bakes the preview's light: exactly one when anything that is lit changed. */
export interface SceneBakes {
  /** `setDocument` bakes the changed scene. */
  readonly document: boolean;
  /** `setLook` bakes under the new look. */
  readonly look: boolean;
  /** The editor tools show the clip pose again and relight it (`EditorTools.documentChanged`). */
  readonly relight: boolean;
}

export interface SceneChange {
  readonly sceneChanged: boolean;
  readonly lookChanged: boolean;
  /** The editor tools show a clip pose rather than the committed document (`EditorTools.reposes`). */
  readonly reposes: boolean;
}

/**
 * One bake for the state finally shown: at a clip pose the relight of that pose (the rest pose and the look's own bake
 * would only be superseded), else the look's bake when the look changes (the scene is set first), else the scene's.
 */
export function sceneBakes({ sceneChanged, lookChanged, reposes }: SceneChange): SceneBakes {
  if (sceneChanged && reposes) return { document: false, look: false, relight: true };
  if (sceneChanged) return { document: !lookChanged, look: lookChanged, relight: false };
  return { document: false, look: lookChanged, relight: false };
}
