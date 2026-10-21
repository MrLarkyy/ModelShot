type Vec3 = readonly [number, number, number];
type Vec4 = readonly [number, number, number, number];

function rampIntegral(x: number, width: number): number {
  if (x <= 0) return x;
  if (x >= width) return 0.5 * width;
  return x - (0.5 * x * x) / width;
}

/**
 * The fillet ramp at distance `d` from an edge, as `glsl/edgeRounding.glsl` computes it: 1 at the edge falling to 0 at
 * `width`, box-filtered over `footprint` (0: unfiltered).
 */
export function edgeRamp(d: number, width: number, footprint: number): number {
  if (footprint <= 1e-6 * width) return Math.min(1, Math.max(0, 1 - d / width));
  const h = 0.5 * footprint;
  return (rampIntegral(d + h, width) - rampIntegral(d - h, width)) / footprint;
}

/**
 * The rounded shading normal of `glsl/edgeRounding.glsl`: `n` turned toward each slot's edge direction `t[k]` by phi
 * with sin(phi) = ramp · sin(angle / 2), normalised; `n` itself where no slot bends it or `width` is 0.
 */
export function roundedNormal(
  n: Vec3,
  d: Vec4,
  angle: Vec4,
  t: readonly [Vec3, Vec3, Vec3, Vec3],
  width: number,
  footprint: Vec4,
): Vec3 {
  if (width <= 0) return n;
  const offset = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const r = edgeRamp(d[k] ?? 0, width, footprint[k] ?? 0);
    const a = angle[k] ?? 0;
    if (r <= 0 || a === 0) continue;
    const bend = Math.tan(Math.asin(r * Math.sin(0.5 * a)));
    for (let i = 0; i < 3; i++) offset[i] = (offset[i] ?? 0) + bend * (t[k]?.[i] ?? 0);
  }
  const [ox, oy, oz] = offset as [number, number, number];
  if (ox * ox + oy * oy + oz * oz === 0) return n;
  const m: [number, number, number] = [n[0] + ox, n[1] + oy, n[2] + oz];
  const length = Math.hypot(...m);
  return [m[0] / length, m[1] / length, m[2] / length];
}
