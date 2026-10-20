import { mat4TransformPoint } from './Mat4';
import { meshVisible, nodeVisibility } from './nodeVisibility';
import type { SceneDocument } from './SceneDocument';
import type { Vec3 } from './Vec3';
import { worldMatrices } from './worldMatrices';

/**
 * World-space bounds of the visible geometry: the axis-aligned box and its circumscribed sphere (centre of the box,
 * radius half its diagonal), so every box corner lies inside or on the sphere.
 */
export interface SceneBounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly center: Vec3;
  readonly radius: number;
}

/**
 * Bounds of the visible meshes placed by their node world matrices. A hidden node hides its subtree; vertices with a
 * non-finite coordinate are skipped. `null` when nothing visible remains.
 */
export function sceneBounds(doc: SceneDocument): SceneBounds | null {
  const world = worldMatrices(doc.nodes);
  const visibility = nodeVisibility(doc);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  doc.meshes.forEach((mesh, index) => {
    if (!meshVisible(doc, index, visibility)) return;
    const matrix = mesh.node >= 0 ? world[mesh.node] : undefined;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const local: Vec3 = [p[i] ?? NaN, p[i + 1] ?? NaN, p[i + 2] ?? NaN];
      if (!local.every(Number.isFinite)) continue;
      const [x, y, z] = matrix ? mat4TransformPoint(matrix, local) : local;
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
  });
  if (!(min[0] <= max[0])) return null;
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
}
