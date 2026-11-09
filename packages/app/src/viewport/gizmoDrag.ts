import type { Vec3 } from '@modelshot/scene';
import type { GizmoFrame, GizmoMode } from './gizmoFrame';
import type { Projector, ScreenPoint } from './Projector';

export interface GizmoHandle {
  /** 0 = x, 1 = y, 2 = z. */
  readonly axis: 0 | 1 | 2;
  readonly polyline: readonly ScreenPoint[];
}

/** Length of a move handle and radius of a rotate ring on screen. */
export const GIZMO_SCREEN_PX = 84;
const RING_SEGMENTS = 48;

const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** World units that span `GIZMO_SCREEN_PX` at the gizmo's origin, so the gizmo keeps its size whatever the zoom. */
export function gizmoWorldSize(projector: Projector, origin: Vec3, axes: GizmoFrame['axes']): number {
  const from = projector.project(origin);
  if (!from) return 1;
  let longest = 0;
  for (const axis of axes) {
    const to = projector.project(add(origin, axis, 1));
    if (to) longest = Math.max(longest, Math.hypot(to.x - from.x, to.y - from.y));
  }
  return longest > 1e-6 ? GIZMO_SCREEN_PX / longest : 1;
}

/** The handles in screen space: a segment per axis for a move, a ring about each axis for a rotation. */
export function gizmoHandles(projector: Projector, frame: GizmoFrame, mode: GizmoMode): GizmoHandle[] {
  const size = gizmoWorldSize(projector, frame.origin, frame.axes);
  const handles: GizmoHandle[] = [];
  frame.axes.forEach((axis, index) => {
    const i = index as 0 | 1 | 2;
    const points: Vec3[] = [];
    if (mode === 'move') {
      points.push(frame.origin, add(frame.origin, axis, size));
    } else {
      const u = Math.abs(axis[1]) < 0.9 ? ([0, 1, 0] as Vec3) : ([1, 0, 0] as Vec3);
      const a: Vec3 = unitCross(axis, u);
      const b: Vec3 = unitCross(axis, a);
      for (let s = 0; s <= RING_SEGMENTS; s++) {
        const angle = (s / RING_SEGMENTS) * Math.PI * 2;
        points.push(add(add(frame.origin, a, Math.cos(angle) * size), b, Math.sin(angle) * size));
      }
    }
    const polyline = points.map((p) => projector.project(p));
    if (polyline.every((p): p is ScreenPoint => p !== null)) handles.push({ axis: i, polyline });
  });
  return handles;
}

function unitCross(a: Vec3, b: Vec3): Vec3 {
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / length, c[1] / length, c[2] / length];
}

function segmentDistance(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The handle nearest to `point` within `tolerance` CSS pixels, or null. */
export function hitHandle(handles: readonly GizmoHandle[], point: ScreenPoint, tolerance: number): GizmoHandle | null {
  let best: GizmoHandle | null = null;
  let bestDistance = tolerance;
  for (const handle of handles) {
    for (let i = 0; i + 1 < handle.polyline.length; i++) {
      const a = handle.polyline[i];
      const b = handle.polyline[i + 1];
      if (!a || !b) continue;
      const d = segmentDistance(point, a, b);
      if (d <= bestDistance) {
        bestDistance = d;
        best = handle;
      }
    }
  }
  return best;
}

/** Model units a pointer move from `from` to `to` slides along `axis`: the move projected on the axis as it appears on screen. */
export function moveDelta(
  projector: Projector,
  frame: GizmoFrame,
  axis: 0 | 1 | 2,
  from: ScreenPoint,
  to: ScreenPoint,
): number {
  const direction = frame.axes[axis];
  const a = projector.project(frame.origin);
  const b = projector.project(add(frame.origin, direction, 1));
  if (!a || !b) return 0;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const length2 = sx * sx + sy * sy;
  if (length2 < 1e-9) return 0;
  return ((to.x - from.x) * sx + (to.y - from.y) * sy) / length2;
}

/** Degrees a pointer move from `from` to `to` turns the node about `axis`: the angle swept about the origin on screen. */
export function rotateDelta(
  projector: Projector,
  frame: GizmoFrame,
  axis: 0 | 1 | 2,
  from: ScreenPoint,
  to: ScreenPoint,
): number {
  const centre = projector.project(frame.origin);
  if (!centre) return 0;
  let swept = Math.atan2(to.y - centre.y, to.x - centre.x) - Math.atan2(from.y - centre.y, from.x - centre.x);
  if (swept > Math.PI) swept -= Math.PI * 2;
  if (swept < -Math.PI) swept += Math.PI * 2;
  // Screen y points down, so a counter-clockwise turn about an axis pointing at the viewer has a negative sweep; an axis
  // pointing away from the viewer flips it.
  return (-swept * 180 * projector.depthSign(frame.axes[axis])) / Math.PI;
}
