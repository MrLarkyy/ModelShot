import { cameraBasis, fitClipPlanes, orbitDirection, type SceneBounds, type SceneCamera, type Vec3 } from '@modelshot/scene';

/** Share of the half-width and half-height the outline of the points may take. */
export const DEFAULT_FILL = 0.9;
const SEARCH_STEPS = 60;

/**
 * A perspective camera from the orbit angles whose view the projected `points` (world xyz triples, the model's
 * vertices) fill to `fill` on the tighter axis, centred on their outline. The app's frame-to-fit shows the bounding
 * sphere instead, which leaves a model with far-apart parts or an off-centre bulk small. `bounds` (of the same points)
 * gives the clip planes.
 */
export function fitCameraToPoints(
  points: ArrayLike<number>,
  bounds: SceneBounds,
  yawDeg: number,
  pitchDeg: number,
  fovYDeg: number,
  aspect: number,
  fill = DEFAULT_FILL,
): SceneCamera {
  const c = bounds.center;
  const toCamera = orbitDirection(yawDeg, pitchDeg);
  const { right, up } = cameraBasis({
    position: [c[0] + toCamera[0], c[1] + toCamera[1], c[2] + toCamera[2]],
    target: c,
    up: [0, 1, 0],
    projection: { kind: 'perspective', fovYDeg },
    near: 0.1,
    far: 1,
  });
  const n = Math.floor(points.length / 3);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  let nearest = -Infinity;
  for (let i = 0; i < n; i++) {
    const v: Vec3 = [
      (points[3 * i] ?? 0) - c[0],
      (points[3 * i + 1] ?? 0) - c[1],
      (points[3 * i + 2] ?? 0) - c[2],
    ];
    xs[i] = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
    ys[i] = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
    zs[i] = v[0] * toCamera[0] + v[1] * toCamera[1] + v[2] * toCamera[2];
    nearest = Math.max(nearest, zs[i] ?? 0);
  }
  const tanY = Math.tan((fovYDeg * Math.PI) / 360) * fill;
  const tanX = tanY * aspect;
  // At camera distance d from the target plane a point at depth offset z projects inside the fill on an axis when
  // |coordinate - shift| <= (d - z) * tan; some shift serves every point iff the tightest upper bound is not below
  // the loosest lower one. That only gets easier as d grows, so the smallest such d is found by bisection.
  const window = (coords: Float64Array, tan: number, d: number): [number, number] => {
    let low = -Infinity;
    let high = Infinity;
    for (let i = 0; i < n; i++) {
      const reach = (d - (zs[i] ?? 0)) * tan;
      low = Math.max(low, (coords[i] ?? 0) - reach);
      high = Math.min(high, (coords[i] ?? 0) + reach);
    }
    return [low, high];
  };
  const fits = (d: number): boolean => {
    const [lx, hx] = window(xs, tanX, d);
    const [ly, hy] = window(ys, tanY, d);
    return lx <= hx && ly <= hy;
  };
  const size = Math.max(bounds.radius, 1e-3);
  let lo = Math.max(nearest, 0) + size * 1e-3;
  let hi = lo + size;
  while (!fits(hi)) hi = lo + (hi - lo) * 2;
  for (let step = 0; step < SEARCH_STEPS && !fits(lo); step++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const distance = fits(lo) ? lo : hi;
  // Within the window, the shift that centres the outline (its largest and smallest projection opposite) also
  // minimises the largest one, so it keeps the fill; the sum of the two only falls as the shift grows.
  const centred = (coords: Float64Array, tan: number): number => {
    let [low, high] = window(coords, tan, distance);
    if (n === 0) return 0;
    for (let step = 0; step < SEARCH_STEPS; step++) {
      const shift = (low + high) / 2;
      let most = -Infinity;
      let least = Infinity;
      for (let i = 0; i < n; i++) {
        const projected = ((coords[i] ?? 0) - shift) / (distance - (zs[i] ?? 0));
        most = Math.max(most, projected);
        least = Math.min(least, projected);
      }
      if (most + least > 0) low = shift;
      else high = shift;
    }
    return (low + high) / 2;
  };
  const shiftX = centred(xs, tanX);
  const shiftY = centred(ys, tanY);
  const target: Vec3 = [
    c[0] + right[0] * shiftX + up[0] * shiftY,
    c[1] + right[1] * shiftX + up[1] * shiftY,
    c[2] + right[2] * shiftX + up[2] * shiftY,
  ];
  const position: Vec3 = [
    target[0] + toCamera[0] * distance,
    target[1] + toCamera[1] * distance,
    target[2] + toCamera[2] * distance,
  ];
  return {
    position,
    target,
    up: [0, 1, 0],
    projection: { kind: 'perspective', fovYDeg },
    ...fitClipPlanes(position, [-toCamera[0], -toCamera[1], -toCamera[2]], bounds),
  };
}
