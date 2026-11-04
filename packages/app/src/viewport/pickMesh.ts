import { cameraRay, type SceneCamera, type SceneDocument, type Vec3 } from '@modelshot/scene';
import { isMeshLocked, type LockState } from '../editor/isLocked';
import { BOX_TRIANGLES, placedBoxes } from './meshBoxes';

function hitDistance(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p: Vec3 = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const t: Vec3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) / det;
  if (u < 0 || u > 1) return null;
  const q: Vec3 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
  if (v < 0 || u + v > 1) return null;
  const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  return distance > 0 ? distance : null;
}

/**
 * The shown, unlocked mesh whose box the ray through (`ndcX`, `ndcY`) meets first, or null. Boxes, not triangles: a pick
 * costs a few dozen operations per mesh whatever the model's triangle count.
 */
export function pickMesh(
  doc: SceneDocument,
  lock: LockState,
  camera: SceneCamera,
  aspect: number,
  ndcX: number,
  ndcY: number,
): number | null {
  const ray = cameraRay(camera, aspect, ndcX, ndcY);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const box of placedBoxes(doc)) {
    if (isMeshLocked(doc, lock, box.mesh)) continue;
    for (const [i, j, k] of BOX_TRIANGLES) {
      const a = box.corners[i];
      const b = box.corners[j];
      const c = box.corners[k];
      if (!a || !b || !c) continue;
      const d = hitDistance(ray.origin, ray.direction, a, b, c);
      if (d !== null && d < bestDistance) {
        bestDistance = d;
        best = box.mesh;
      }
    }
  }
  return best;
}
