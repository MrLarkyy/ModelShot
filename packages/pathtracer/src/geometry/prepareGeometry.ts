import { sceneBounds, type SceneBounds, type SceneDocument, type SharpEdgeOptions } from '@modelshot/scene';
import { buildBvh } from '../buildBvh';
import { flattenScene } from '../flattenScene';
import { packGeometry, type PackedGeometry } from '../packSceneData';

/** What `prepareGeometry` needs besides the document. */
export interface GeometryParams {
  readonly maxTriangles: number;
  /** Sharp-edge detection the edge texels are packed with. */
  readonly edges: SharpEdgeOptions;
  readonly maxTextureSize: number;
  /** Compute the visible geometry's bounds (`sceneBounds`); `false` when the caller brings its own. */
  readonly sceneBounds: boolean;
}

/** A scene's geometry as the trace shader reads it, and what an edge repack and the shadow catcher need. */
export interface PreparedGeometry {
  readonly geometry: PackedGeometry;
  /** `Bvh.order`. */
  readonly order: Uint32Array;
  /** `FlatScene.sources`. */
  readonly sources: Uint32Array;
  /** Triangles traced. */
  readonly count: number;
  /** `FlatScene.skipped`. */
  readonly skipped: number;
  /** `sceneBounds(doc)` when asked for, else `null`. */
  readonly bounds: SceneBounds | null;
}

/**
 * Flattens the visible triangles, builds the BVH and packs the data textures; throws `PathTracerError`
 * `SCENE_TOO_LARGE` over `maxTriangles` or for rows over `maxTextureSize`, before allocating them. The geometry worker
 * and the main-thread fallback both run this one function, so their bytes are the same. Textures are not read.
 */
export function prepareGeometry(doc: SceneDocument, params: GeometryParams): PreparedGeometry {
  const flat = flattenScene(doc, params.maxTriangles, params.edges);
  const bvh = buildBvh(flat.positions, flat.count);
  const geometry = packGeometry(flat, bvh, params.maxTextureSize);
  return {
    geometry,
    order: bvh.order,
    sources: flat.sources,
    count: flat.count,
    skipped: flat.skipped,
    bounds: params.sceneBounds ? sceneBounds(doc) : null,
  };
}

/** The buffers of `prepared` to transfer rather than copy, each once. */
export function preparedTransfer(prepared: PreparedGeometry): ArrayBuffer[] {
  const { nodes, triPositions, triAttributes } = prepared.geometry;
  const arrays = [nodes.data, triPositions.data, triAttributes.data, prepared.order, prepared.sources];
  return [...new Set(arrays.map((array) => array.buffer as ArrayBuffer))];
}
