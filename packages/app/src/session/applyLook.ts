import { checkLookPreset, type LookPreset } from '@modelshot/looks';

export interface LookTarget {
  /** `bake: false`: the caller bakes the preview's light itself (sceneBakes); a tracer has none and ignores it. */
  setLook(look: LookPreset, options?: { readonly bake?: boolean }): void;
}

// The one place a look reaches the preview (and with it the bake), the path tracer and, through the tracer, every
// export: they all get the same checked object, whose edges they apply too.
export function applyLook(
  look: LookPreset,
  targets: readonly (LookTarget | null)[],
  options: { readonly bake?: boolean } = {},
): LookPreset {
  const checked = checkLookPreset(look);
  for (const target of targets) target?.setLook(checked, options);
  return checked;
}
