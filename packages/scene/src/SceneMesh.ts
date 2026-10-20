/** A run of `count` indices starting at `start`, drawn with one material (−1: none, the renderer's default). */
export interface SceneMeshGroup {
  readonly material: number;
  readonly start: number;
  readonly count: number;
  /**
   * Absent or `false`: only the front (counter-clockwise) side is seen by camera rays. `true`: the back shows the same
   * texels, mirrored as seen from behind, with the normal flipped toward the viewer or ray. Shadow rays are blocked by
   * both sides either way.
   */
  readonly doubleSided?: boolean;
}

/**
 * Indexed triangles. Vertices are in model rest space with the source element's own rotation baked in; the owning
 * node's world matrix places them. Triangles wind counter-clockwise seen from outside.
 */
export interface SceneMesh {
  readonly name: string;
  /** Identifier in the source file (Blockbench uuid), `''` when the file has none. */
  readonly sourceId: string;
  /** Owning node index, −1 for a mesh at the model root (identity world matrix). */
  readonly node: number;
  /** `false` hides this mesh. */
  readonly visible: boolean;
  /**
   * Integer, absent: 0. Only breaks ties between surfaces at the same depth or hit distance (the higher wins); it never
   * shows a surface through a nearer opaque one.
   */
  readonly renderOrder?: number;
  /** 3 floats per vertex. */
  readonly positions: Float32Array;
  /** 3 floats per vertex, unit length. */
  readonly normals: Float32Array;
  /** 2 floats per vertex, normalised; origin top-left, v grows downwards (upload without flipping). */
  readonly uvs: Float32Array;
  /**
   * 4 floats per vertex `[uMin, vMin, uMax, vMax]`: the UV rectangle of the vertex's face, normalised like `uvs`, so a
   * renderer can clamp texel anti-aliasing to the face and never sample a neighbouring atlas region.
   */
  readonly uvRects: Float32Array;
  readonly indices: Uint32Array;
  readonly groups: readonly SceneMeshGroup[];
}
