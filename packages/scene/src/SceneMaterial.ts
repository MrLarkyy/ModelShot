/**
 * How a material's texel alpha is read (glTF names). `opaque` ignores alpha; `mask` and `blend` hide texels below
 * `alphaCutoff` from camera, shadow and ambient-occlusion rays alike; `blend` also lets texels with
 * `alphaCutoff ≤ a < 1` through partially. `resolveMaterialAlpha` and `texelCoverage` are the one definition.
 */
export type SceneAlphaMode = 'opaque' | 'mask' | 'blend';

export interface SceneMaterial {
  readonly name: string;
  /** Index into `SceneDocument.textures`, −1 for none. */
  readonly texture: number;
  /** Absent: `opaque`. */
  readonly alphaMode?: SceneAlphaMode;
  /** Texel alpha in 0..1 below which a texel is invisible; absent: `DEFAULT_ALPHA_CUTOFF` (0.5). */
  readonly alphaCutoff?: number;
}
