import type { Vec3 } from '@modelshot/scene';

export interface FaceTriangulation {
  /** Unit face normal (Newell's method over the vertex loop); `[0, 0, 0]` when there are no triangles. */
  readonly normal: Vec3;
  /** Index triples into the face's points, counter-clockwise about `normal`. */
  readonly triangles: readonly number[];
}

type Point2 = readonly [number, number];

const NONE: FaceTriangulation = { normal: [0, 0, 0], triangles: [] };
/** A face whose area is at most this times its squared extent is degenerate (collinear or coincident points). */
const DEGENERATE_AREA = 1e-12;

/**
 * Triangulates one planar face. 3 points: one triangle. 4 points: Blockbench's vertex order (a quad stored out of order
 * becomes a simple loop) split along the 0–2 diagonal as Blockbench does, or along 1–3 when that one stays inside a
 * concave quad; a concave quad that Blockbench's order turns into a bow-tie is split as Blockbench draws it. 5 or more: ear clipping in the plane of the dominant normal axis; a polygon without ears (self-intersecting)
 * falls back to a fan. Fewer than 3 points or a zero area: no triangles. Pure and bounded: O(n³) for n points.
 * `quadOrder: 'loop'` takes 4 points as the polygon loop they are (OBJ), without Blockbench's reordering.
 */
export function triangulateFace(
  points: readonly Vec3[],
  quadOrder: 'blockbench' | 'loop' = 'blockbench',
): FaceTriangulation {
  if (points.length < 3) return NONE;
  const loop =
    points.length === 4 && quadOrder === 'blockbench' ? blockbenchQuadOrder(points) : points.map((_, i) => i);
  const newell = newellNormal(points, loop);
  const length = Math.hypot(newell[0], newell[1], newell[2]);
  const extent = boundingExtent(points);
  if (!(length / 2 > DEGENERATE_AREA * extent * extent)) return NONE;
  const normal: Vec3 = [newell[0] / length, newell[1] / length, newell[2] / length];
  const epsilon = DEGENERATE_AREA * extent * extent;
  let triangles: number[];
  if (loop.length === 3) triangles = loop;
  else if (loop.length === 4) triangles = splitQuad(points, loop, normal, epsilon);
  else triangles = earClip(project(points, normal), loop, epsilon) ?? fan(loop);
  return { normal, triangles };
}

/**
 * Blockbench's own face normal (`MeshFace.getNormal(true)`): the unit `(s1 − s0) × (s2 − s0)` of its vertex loop, or
 * `[0, 0, 0]` for a degenerate face. Smooth shading averages these, so it is kept separate from the Newell normal.
 */
export function blockbenchFaceNormal(points: readonly Vec3[]): Vec3 {
  if (points.length < 3) return ZERO;
  const loop = points.length === 4 ? blockbenchQuadOrder(points) : [0, 1, 2];
  const [s0, s1, s2] = loop.map((i) => points[i] ?? ZERO) as [Vec3, Vec3, Vec3];
  const n = cross(sub(s1, s0), sub(s2, s0));
  const length = Math.hypot(n[0], n[1], n[2]);
  return length > 0 ? [n[0] / length, n[1] / length, n[2] / length] : ZERO;
}

/**
 * Blockbench's `MeshFace.getSortedVertices`: if point 3 lies across the line 1–2 from point 0 the loop is 2, 0, 1, 3;
 * else if it lies across the line 0–1 from point 2 it is 0, 2, 1, 3; otherwise the stored order is the loop.
 */
function blockbenchQuadOrder(points: readonly Vec3[]): number[] {
  const [a, b, c, d] = points as readonly [Vec3, Vec3, Vec3, Vec3];
  if (acrossLine(b, c, a, d)) return [2, 0, 1, 3];
  if (acrossLine(a, b, c, d)) return [0, 2, 1, 3];
  return [0, 1, 2, 3];
}

/** Whether `check` lies on the other side of the line through `base1` and `base2` than `top`. */
function acrossLine(base1: Vec3, base2: Vec3, top: Vec3, check: Vec3): boolean {
  const line = sub(base2, base1);
  const lineLength2 = dot(line, line);
  const t = lineLength2 > 0 ? dot(sub(top, base1), line) / lineLength2 : 0;
  const foot: Vec3 = [base1[0] + line[0] * t, base1[1] + line[1] * t, base1[2] + line[2] * t];
  return dot(sub(foot, top), sub(check, base2)) > 0;
}

function splitQuad(points: readonly Vec3[], loop: readonly number[], normal: Vec3, epsilon: number): number[] {
  const [i0 = 0, i1 = 1, i2 = 2, i3 = 3] = loop;
  const facing = (a: number, b: number, c: number): boolean => orientation(points, a, b, c, normal) >= -epsilon;
  if (facing(i0, i1, i2) && facing(i0, i2, i3)) return [i0, i1, i2, i0, i2, i3];
  if (facing(i1, i2, i3) && facing(i1, i3, i0)) return [i1, i2, i3, i1, i3, i0];
  return [i0, i1, i2, i0, i2, i3];
}

/** Twice the signed area of triangle a, b, c about `normal`. */
function orientation(points: readonly Vec3[], a: number, b: number, c: number, normal: Vec3): number {
  const pa = points[a] ?? ZERO;
  return dot(cross(sub(points[b] ?? ZERO, pa), sub(points[c] ?? ZERO, pa)), normal);
}

/**
 * Ear clipping over `loop`; drops collinear vertices without a triangle (they add no area). `undefined` when no ear is
 * left before the polygon is used up, i.e. the loop crosses itself.
 */
function earClip(points: readonly Point2[], loop: readonly number[], epsilon: number): number[] | undefined {
  const remaining = [...loop];
  const out: number[] = [];
  const at = (k: number): number => remaining[(k + remaining.length) % remaining.length] ?? 0;
  const area2 = (a: number, b: number, c: number): number => signedArea2(points[a], points[b], points[c]);
  while (remaining.length > 3) {
    const collinear = remaining.findIndex((v, k) => Math.abs(area2(at(k - 1), v, at(k + 1))) <= epsilon);
    if (collinear >= 0) {
      remaining.splice(collinear, 1);
      continue;
    }
    const ear = remaining.findIndex((v, k) => isEar(points, remaining, at(k - 1), v, at(k + 1), epsilon));
    if (ear < 0) return undefined;
    out.push(at(ear - 1), at(ear), at(ear + 1));
    remaining.splice(ear, 1);
  }
  const [a = 0, b = 0, c = 0] = remaining;
  const last = area2(a, b, c);
  if (last < -epsilon) return undefined;
  if (last > epsilon) out.push(a, b, c);
  return out;
}

function isEar(
  points: readonly Point2[],
  remaining: readonly number[],
  prev: number,
  vertex: number,
  next: number,
  epsilon: number,
): boolean {
  const a = points[prev];
  const b = points[vertex];
  const c = points[next];
  if (signedArea2(a, b, c) <= epsilon) return false;
  return remaining.every((other) => {
    if (other === prev || other === vertex || other === next) return true;
    const p = points[other];
    if (samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) return true;
    return !(signedArea2(a, b, p) >= 0 && signedArea2(b, c, p) >= 0 && signedArea2(c, a, p) >= 0);
  });
}

function fan(loop: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 1; k + 1 < loop.length; k++) out.push(loop[0] ?? 0, loop[k] ?? 0, loop[k + 1] ?? 0);
  return out;
}

/**
 * Drops the dominant axis of `normal`, keeping the other two in cyclic order (swapped when the normal points along the
 * negative axis), so a loop counter-clockwise about `normal` has a positive area.
 */
function project(points: readonly Vec3[], normal: Vec3): Point2[] {
  const [ax, ay, az] = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])];
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const flip = normal[axis] < 0;
  return points.map((p): Point2 => {
    const pu = p[u] ?? 0;
    const pv = p[v] ?? 0;
    return flip ? [pv, pu] : [pu, pv];
  });
}

function signedArea2(a: Point2 | undefined, b: Point2 | undefined, c: Point2 | undefined): number {
  if (!a || !b || !c) return 0;
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function samePoint(p: Point2 | undefined, q: Point2 | undefined): boolean {
  return p !== undefined && q !== undefined && p[0] === q[0] && p[1] === q[1];
}

/** Newell's normal of `loop`, relative to its first point for precision; its length is twice the polygon's area. */
function newellNormal(points: readonly Vec3[], loop: readonly number[]): Vec3 {
  const origin = points[loop[0] ?? 0] ?? ZERO;
  let x = 0;
  let y = 0;
  let z = 0;
  loop.forEach((index, k) => {
    const p = sub(points[index] ?? ZERO, origin);
    const q = sub(points[loop[(k + 1) % loop.length] ?? 0] ?? ZERO, origin);
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return [x, y, z];
}

function boundingExtent(points: readonly Vec3[]): number {
  let extent = 0;
  for (let axis = 0; axis < 3; axis++) {
    const values = points.map((p) => p[axis]!);
    extent = Math.max(extent, Math.max(...values) - Math.min(...values));
  }
  return extent;
}

const ZERO: Vec3 = [0, 0, 0];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
