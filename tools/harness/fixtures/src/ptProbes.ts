import { LIGHT_RIG_V0 } from '@modelshot/looks';
import { mat4TransformPoint, worldMatrices, type SceneDocument } from '@modelshot/scene';
import type { PtProbe } from './fixtureApi';

type Point = [number, number, number];

/** A texel of a mesh (texture UV units) or, with `groundY`, where the key light's ray through it meets that height. */
export interface PtProbeRequest {
  readonly name: string;
  readonly mesh: string;
  readonly uv: readonly [number, number];
  readonly groundY?: number;
  /** Only triangles whose front faces the key light (of two coincident single-sided faces, the one that casts). */
  readonly facesLight?: boolean;
}

/**
 * The cutout plane's block (0, 3) is a hole and block (1, 3) opaque (texels (2, 14) and (6, 14), as in the model-view
 * fixture); on the flat cube, the face toward the key light has a hole at (14, 2) and an opaque texel at (14, 6).
 */
export const ALPHA_PLANE_PROBES: readonly PtProbeRequest[] = [
  { name: 'opaque-texel', mesh: 'cutout-plane', uv: [6, 14] },
  { name: 'transparent-texel', mesh: 'cutout-plane', uv: [2, 14] },
  { name: 'shadow-of-opaque-texel', mesh: 'cutout-plane', uv: [6, 14], groundY: 0 },
  { name: 'shadow-of-transparent-texel', mesh: 'cutout-plane', uv: [2, 14], groundY: 0 },
  { name: 'flat-shadow-of-opaque-texel', mesh: 'flat-plane', uv: [14, 6], groundY: 0, facesLight: true },
  { name: 'flat-shadow-of-transparent-texel', mesh: 'flat-plane', uv: [14, 2], groundY: 0, facesLight: true },
];

/**
 * The cut-out checker (cutoutChecker.ts): texels (1, 7) opaque and (2, 7) cut out in the bottom row, whose shadows fall
 * on the shadow catcher (y 0); texels (5, 3) opaque and (6, 3) cut out, whose shadows fall on the box's top (y 4.5).
 */
export const CUTOUT_CHECKER_PROBES: readonly PtProbeRequest[] = [
  { name: 'catcher-shadow-of-opaque-texel', mesh: 'checker', uv: [1.5, 7.5], groundY: 0 },
  { name: 'catcher-shadow-of-transparent-texel', mesh: 'checker', uv: [2.5, 7.5], groundY: 0 },
  { name: 'cube-shadow-of-opaque-texel', mesh: 'checker', uv: [5.5, 3.5], groundY: 4.5 },
  { name: 'cube-shadow-of-transparent-texel', mesh: 'checker', uv: [6.5, 3.5], groundY: 4.5 },
];

/** The probes of a scene: alpha-plane's and the cut-out checker's, none for the others. */
export function sceneProbes(scene: string): readonly PtProbeRequest[] {
  if (scene === 'alpha-plane') return ALPHA_PLANE_PROBES;
  if (scene === 'cutout-checker') return CUTOUT_CHECKER_PROBES;
  return [];
}

function barycentric(p: readonly number[], a: readonly number[], b: readonly number[], c: readonly number[]) {
  const det =
    ((b[1] ?? 0) - (c[1] ?? 0)) * ((a[0] ?? 0) - (c[0] ?? 0)) +
    ((c[0] ?? 0) - (b[0] ?? 0)) * ((a[1] ?? 0) - (c[1] ?? 0));
  if (Math.abs(det) < 1e-12) return null;
  const l0 =
    (((b[1] ?? 0) - (c[1] ?? 0)) * ((p[0] ?? 0) - (c[0] ?? 0)) +
      ((c[0] ?? 0) - (b[0] ?? 0)) * ((p[1] ?? 0) - (c[1] ?? 0))) /
    det;
  const l1 =
    (((c[1] ?? 0) - (a[1] ?? 0)) * ((p[0] ?? 0) - (c[0] ?? 0)) +
      ((a[0] ?? 0) - (c[0] ?? 0)) * ((p[1] ?? 0) - (c[1] ?? 0))) /
    det;
  return [l0, l1, 1 - l0 - l1];
}

/** World point of a texel request, from the document itself (not from any renderer). */
export function locateProbe(doc: SceneDocument, request: PtProbeRequest): Point {
  const world = worldMatrices(doc.nodes);
  const key = LIGHT_RIG_V0.keyDirection;
  for (const mesh of doc.meshes) {
    if (mesh.name !== request.mesh) continue;
    const matrix = mesh.node >= 0 ? world[mesh.node] : undefined;
    const corner = (k: number): Point => {
      const p: Point = [mesh.positions[k * 3] ?? 0, mesh.positions[k * 3 + 1] ?? 0, mesh.positions[k * 3 + 2] ?? 0];
      return matrix ? mat4TransformPoint(matrix, p) : p;
    };
    for (const group of mesh.groups) {
      const texture = doc.textures[doc.materials[group.material]?.texture ?? -1];
      if (!texture) continue;
      const target = [request.uv[0] / texture.uvWidth, request.uv[1] / texture.uvHeight];
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const v = [mesh.indices[i] ?? 0, mesh.indices[i + 1] ?? 0, mesh.indices[i + 2] ?? 0];
        const [a, b, c] = v.map(corner) as [Point, Point, Point];
        if (request.facesLight) {
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const n = [
            (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
            (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
            (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
          ];
          if ((n[0] ?? 0) * key[0] + (n[1] ?? 0) * key[1] + (n[2] ?? 0) * key[2] <= 0) continue;
        }
        const uv = (k: number) => [mesh.uvs[k * 2] ?? 0, mesh.uvs[k * 2 + 1] ?? 0];
        const w = barycentric(target, uv(v[0] ?? 0), uv(v[1] ?? 0), uv(v[2] ?? 0));
        if (!w || w.some((x) => x < -1e-6)) continue;
        const point = [0, 1, 2].map((k) => (w[0] ?? 0) * a[k]! + (w[1] ?? 0) * b[k]! + (w[2] ?? 0) * c[k]!) as Point;
        if (request.groundY === undefined) return point;
        const s = (point[1] - request.groundY) / key[1];
        return [point[0] - key[0] * s, request.groundY, point[2] - key[2] * s];
      }
    }
  }
  throw new Error(`probe ${request.name}: no triangle of "${request.mesh}" covers uv ${request.uv.join(', ')}`);
}

/** Probes of `requests` projected by `project` (world point to image pixels). */
export function computePtProbes(
  doc: SceneDocument,
  requests: readonly PtProbeRequest[],
  project: (p: Point) => [number, number],
): PtProbe[] {
  return requests.map((request) => {
    const [x, y] = project(locateProbe(doc, request));
    return { name: request.name, x, y };
  });
}
