/**
 * How a look rounds sharp edges, read by the preview and the path tracer alike (`glsl/edgeRounding.glsl`): the
 * shading normal bends toward the edge as on a circular fillet, without changing the geometry. Presets set it as data.
 */
export interface EdgeLook {
  /** Distance from the edge (model units) over which the normal turns; 0 rounds nothing. 0..`MAX_EDGE_WIDTH`. */
  readonly width: number;
  /** Faces meeting at this angle between their normals (degrees) or more form a sharp edge. 1..179. */
  readonly sharpAngleDeg: number;
}

/** The widest rounding: sharp-edge detection takes edges up to this far into a triangle's slots. */
export const MAX_EDGE_WIDTH = 4;

export const EDGE_LOOK_V0: EdgeLook = Object.freeze({ width: 0.5, sharpAngleDeg: 30 });

function checkRange(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${path} must be a finite number in ${min}..${max}, got ${String(value)}`);
  }
  return value;
}

/**
 * `edges` over `base` (fields left out keep the base's), checked: a width outside 0..`MAX_EDGE_WIDTH` or an angle
 * outside 1..179 degrees, or a value that is not a finite number, throws a `RangeError` naming `edges.width` or
 * `edges.sharpAngleDeg`.
 */
export function checkEdgeLook(edges: Partial<EdgeLook> | undefined, base: EdgeLook = EDGE_LOOK_V0): EdgeLook {
  const merged = { ...base, ...edges };
  return {
    width: checkRange(merged.width, 'edges.width', 0, MAX_EDGE_WIDTH),
    sharpAngleDeg: checkRange(merged.sharpAngleDeg, 'edges.sharpAngleDeg', 1, 179),
  };
}
