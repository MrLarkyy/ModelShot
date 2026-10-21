/**
 * How a material's texel alpha is read (glTF names). `opaque` ignores alpha; `mask` and `blend` hide texels below
 * `alphaCutoff` from camera, shadow and ambient-occlusion rays alike; `blend` also lets texels with
 * `alphaCutoff ≤ a < 1` through partially. `resolveMaterialAlpha` and `texelCoverage` are the one definition.
 */
export type SceneAlphaMode = 'opaque' | 'mask' | 'blend';

/**
 * How a covered texel combines with what lies behind it. `normal` follows `alphaMode`; `additive` adds `rgb · a` of
 * the shaded texel to what lies behind, independent of draw order, and never occludes camera, shadow or
 * ambient-occlusion rays. `resolveMaterialRenderMode` is the one definition.
 */
export type SceneBlending = 'normal' | 'additive';

export interface SceneMaterial {
  readonly name: string;
  /** Index into `SceneDocument.textures`, −1 for none. */
  readonly texture: number;
  /** Absent: `opaque`. */
  readonly alphaMode?: SceneAlphaMode;
  /** Texel alpha in 0..1 below which a texel is invisible; absent: `DEFAULT_ALPHA_CUTOFF` (0.5). */
  readonly alphaCutoff?: number;
  /** Absent: `normal`. */
  readonly blending?: SceneBlending;
  /**
   * Texel alpha is an inverted emission mask (Blockbench `emissive`, Bedrock `entity_emissive_alpha`): a covered
   * texel of colour `c` and alpha `a` reflects `c · a` and emits `c · (1 − a)`, relative to unshaded white light; the
   * radiance scale is the renderer's. Coverage still follows `alphaMode`. Absent: `false`.
   */
  readonly alphaEmission?: boolean;
  /**
   * Texture indices bottom to top (at most `MAX_MATERIAL_LAYERS`), composited with the over operator at the face UV;
   * the alpha rule applies to the composite alpha. Absent: `[texture]`.
   */
  readonly layers?: readonly number[];
}
