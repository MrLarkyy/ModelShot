import type { SceneMesh } from '@modelshot/scene';

/** World charts get one lightmap texel per this fraction of the scene's bounding diagonal (never finer than a texture texel). */
export const WORLD_TEXELS_PER_EXTENT = 256;
/** Most kept triangles a mesh may have to get world charts; a denser mesh samples its light per vertex. */
export const MAX_WORLD_MESH_TRIANGLES = 4096;
/** Two triangles lie in one chart when their unit normals' dot product exceeds 1 minus this. */
const COPLANAR_TOLERANCE = 1e-6;

/** A triangle of the mesh as the layout keeps it: first index, group, and the group's sidedness. */
export interface WorldChartTriangle {
  readonly first: number;
  readonly group: number;
  readonly doubleSided: boolean;
}

/**
 * Edge-connected coplanar triangles of one group, projected onto their plane: u along the edge of the first triangle
 * that bounds the chart tightest, v = normal × u. Lengths in mesh units, so one chart serves every texel size.
 */
export interface WorldChart {
  /** First index (into the mesh's `indices`) of each triangle, ascending. */
  readonly triangles: readonly number[];
  readonly back: boolean;
  /** Extent along u and v. */
  readonly span: readonly [number, number];
  /** 6 per triangle: (u, v) of its corners 0, 1, 2, measured from the chart's lowest u and v. */
  readonly corners: Float64Array;
}

/** A world chart at one texel size: its size in texels and its corners in chart-local texels. */
export interface WorldChartTexels {
  readonly texels: readonly [number, number];
  readonly corners: Float32Array;
}

// Plain index loops: this runs on up to MAX_WORLD_MESH_TRIANGLES triangles per mesh on the main thread.
function triangleNormal(mesh: SceneMesh, first: number, out: Float64Array, at: number): void {
  const p = mesh.positions;
  const a = (mesh.indices[first] ?? 0) * 3;
  const b = (mesh.indices[first + 1] ?? 0) * 3;
  const c = (mesh.indices[first + 2] ?? 0) * 3;
  const ux = (p[b] ?? 0) - (p[a] ?? 0);
  const uy = (p[b + 1] ?? 0) - (p[a + 1] ?? 0);
  const uz = (p[b + 2] ?? 0) - (p[a + 2] ?? 0);
  const vx = (p[c] ?? 0) - (p[a] ?? 0);
  const vy = (p[c + 1] ?? 0) - (p[a + 1] ?? 0);
  const vz = (p[c + 2] ?? 0) - (p[a + 2] ?? 0);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  out[at] = nx / length;
  out[at + 1] = ny / length;
  out[at + 2] = nz / length;
}

/**
 * The chart's plane bases from its first triangle, one per edge: origin corner 0, u along the edge, v = n × u, as
 * [ox, oy, oz, ux, uy, uz, vx, vy, vz].
 */
function chartBases(mesh: SceneMesh, first: number, normals: Float64Array, at: number): number[][] {
  const corner = (c: number, axis: number) => mesh.positions[(mesh.indices[first + c] ?? 0) * 3 + axis] ?? 0;
  const [nx = 0, ny = 0, nz = 0] = [normals[at], normals[at + 1], normals[at + 2]];
  return [0, 1, 2].map((c) => {
    const edge = [0, 1, 2].map((axis) => corner((c + 1) % 3, axis) - corner(c, axis));
    const length = Math.hypot(edge[0] ?? 0, edge[1] ?? 0, edge[2] ?? 0) || 1;
    const [ux = 0, uy = 0, uz = 0] = edge.map((x) => x / length);
    return [
      corner(0, 0),
      corner(0, 1),
      corner(0, 2),
      ux,
      uy,
      uz,
      ny * uz - nz * uy,
      nz * ux - nx * uz,
      nx * uy - ny * ux,
    ];
  });
}

/** Corners of `members` in `basis`, from their lowest u and v, and their span. */
function project(
  mesh: SceneMesh,
  triangles: readonly WorldChartTriangle[],
  members: readonly number[],
  basis: readonly number[],
): { corners: Float64Array; span: [number, number] } {
  const p = mesh.positions;
  const [ox = 0, oy = 0, oz = 0, ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0] = basis;
  const corners = new Float64Array(members.length * 6);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  members.forEach((t, j) => {
    const first = triangles[t]?.first ?? 0;
    for (let c = 0; c < 3; c++) {
      const v = (mesh.indices[first + c] ?? 0) * 3;
      const dx = (p[v] ?? 0) - ox;
      const dy = (p[v + 1] ?? 0) - oy;
      const dz = (p[v + 2] ?? 0) - oz;
      const cu = dx * ux + dy * uy + dz * uz;
      const cv = dx * vx + dy * vy + dz * vz;
      corners[j * 6 + c * 2] = cu;
      corners[j * 6 + c * 2 + 1] = cv;
      minU = Math.min(minU, cu);
      minV = Math.min(minV, cv);
      maxU = Math.max(maxU, cu);
      maxV = Math.max(maxV, cv);
    }
  });
  for (let i = 0; i < corners.length; i += 2) {
    corners[i] = (corners[i] ?? 0) - minU;
    corners[i + 1] = (corners[i + 1] ?? 0) - minV;
  }
  return { corners, span: [maxU - minU, maxV - minV] };
}

/**
 * World charts of a mesh's kept triangles (finite, non-zero area): edges are matched by exact position, so a flat
 * mesh with its own vertices per face still joins, and only an edge of exactly two triangles joins them (linear time);
 * a chart grows from the first unassigned triangle in triangle order to at most `maxTriangles` triangles. A pure
 * function of the rest geometry and the triangle order.
 */
export function worldCharts(
  mesh: SceneMesh,
  triangles: readonly WorldChartTriangle[],
  maxTriangles: number,
): WorldChart[] {
  const count = triangles.length;
  const p = mesh.positions;
  const vertexCount = Math.floor(p.length / 3);
  const idOfVertex = new Int32Array(vertexCount).fill(-1);
  const byPosition = new Map<string, number>();
  const ids = new Int32Array(count * 3);
  const normals = new Float64Array(count * 3);
  for (let t = 0; t < count; t++) {
    const first = triangles[t]?.first ?? 0;
    triangleNormal(mesh, first, normals, t * 3);
    for (let c = 0; c < 3; c++) {
      const v = mesh.indices[first + c] ?? 0;
      let id = idOfVertex[v] ?? -1;
      if (id < 0) {
        const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
        id = byPosition.get(key) ?? byPosition.size;
        byPosition.set(key, id);
        idOfVertex[v] = id;
      }
      ids[t * 3 + c] = id;
    }
  }
  // Per edge slot (triangle × 3 + edge) the one other slot with the same position pair, −1 when the edge is open or
  // shared by more than two triangles: such an edge joins nothing, so a fan of thousands of triangles on one edge costs
  // no more than a strip.
  const distinct = byPosition.size;
  const partner = new Int32Array(count * 3).fill(-1);
  const firstSlot = new Map<number, number>();
  for (let s = 0; s < count * 3; s++) {
    const t = Math.floor(s / 3);
    const a = ids[s] ?? 0;
    const b = ids[t * 3 + ((s + 1) % 3)] ?? 0;
    const key = Math.min(a, b) * distinct + Math.max(a, b);
    const other = firstSlot.get(key);
    if (other === undefined) {
      firstSlot.set(key, s);
    } else if (other >= 0 && (partner[other] ?? -1) < 0) {
      partner[other] = s;
      partner[s] = other;
    } else {
      if (other >= 0) {
        partner[partner[other] ?? 0] = -1;
        partner[other] = -1;
      }
      firstSlot.set(key, -1);
    }
  }

  const chartOf = new Int32Array(count).fill(-1);
  const charts: WorldChart[] = [];
  for (let seed = 0; seed < count; seed++) {
    if ((chartOf[seed] ?? -1) >= 0) continue;
    const group = triangles[seed]?.group ?? -1;
    const members = [seed];
    chartOf[seed] = charts.length;
    for (let k = 0; k < members.length && members.length < maxTriangles; k++) {
      const t = members[k] ?? 0;
      for (let e = 0; e < 3; e++) {
        const s = partner[t * 3 + e] ?? -1;
        if (s < 0) continue;
        const other = Math.floor(s / 3);
        if ((chartOf[other] ?? -1) >= 0 || triangles[other]?.group !== group) continue;
        const dot =
          (normals[other * 3] ?? 0) * (normals[seed * 3] ?? 0) +
          (normals[other * 3 + 1] ?? 0) * (normals[seed * 3 + 1] ?? 0) +
          (normals[other * 3 + 2] ?? 0) * (normals[seed * 3 + 2] ?? 0);
        if (!(dot > 1 - COPLANAR_TOLERANCE) || members.length >= maxTriangles) continue;
        chartOf[other] = charts.length;
        members.push(other);
      }
    }
    members.sort((a, b) => a - b);
    // The edge whose direction bounds the chart tightest: a quad's side, never its diagonal.
    let best: { corners: Float64Array; span: [number, number] } | null = null;
    for (const basis of chartBases(mesh, triangles[seed]?.first ?? 0, normals, seed * 3)) {
      const candidate = project(mesh, triangles, members, basis);
      const area = candidate.span[0] * candidate.span[1];
      if (!best || area < best.span[0] * best.span[1] * (1 - 1e-9)) best = candidate;
    }
    const { corners, span } = best ?? { corners: new Float64Array(members.length * 6), span: [0, 0] };
    charts.push({
      triangles: members.map((t) => triangles[t]?.first ?? 0),
      back: triangles[seed]?.doubleSided === true,
      span,
      corners,
    });
  }
  return charts;
}

/** Texels of `chart` across at `texel` mesh units per lightmap texel, at least one each way, its back block excluded. */
export function worldChartArea(chart: WorldChart, texel: number): number {
  return Math.max(1, Math.ceil(chart.span[0] / texel)) * Math.max(1, Math.ceil(chart.span[1] / texel));
}

/** `chart` at `texel` mesh units per lightmap texel: at least one texel each way, corners in texels. */
export function worldChartTexels(chart: WorldChart, texel: number): WorldChartTexels {
  const corners = new Float32Array(chart.corners.length);
  for (let i = 0; i < corners.length; i++) corners[i] = (chart.corners[i] ?? 0) / texel;
  return {
    texels: [Math.max(1, Math.ceil(chart.span[0] / texel)), Math.max(1, Math.ceil(chart.span[1] / texel))],
    corners,
  };
}
