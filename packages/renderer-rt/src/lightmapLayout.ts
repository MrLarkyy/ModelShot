import { meshVisible, nodeVisibility, type SceneDocument, type SceneMesh } from '@modelshot/scene';
import { RendererError } from './RendererError';

/** Texels per lightmap row. */
export const LIGHTMAP_WIDTH = 2048;
/** Most texels a scene's model lightmap may have (2048 × 1024); the shadow catcher has its own. */
export const MAX_LIGHTMAP_TEXELS = 2 ** 21;
/** Most triangles one texel chart may have; the bake searches them per texel. More: the mesh is baked per vertex. */
export const MAX_CHART_TRIANGLES = 32;
/** Largest texture texels per lightmap texel tried before a scene is rejected. */
const MAX_DOWNSCALE = 4096;
/** Two triangles lie on one chart when their UV-to-position maps agree to this (relative) tolerance. */
const AFFINE_TOLERANCE = 1e-5;

/** One chart: a face on its texture's texel grid, or one vertex of a mesh baked per vertex. */
export interface LightmapChart {
  readonly mesh: number;
  /** `texel`: a lightmap texel per `downscale` × `downscale` texels of the face's texture; `vertex`: one texel. */
  readonly mode: 'texel' | 'vertex';
  /** The chart's first lightmap texel and its size; a double-sided chart's back side follows at `x + width`. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly back: boolean;
  /** Texel mode: the first texture texel the chart covers (`faceTexelRange` of the face's UV rectangle). */
  readonly texelLo: readonly [number, number];
  /** Texel mode: the texture's size in texels (`SceneTexture.width`, `height`). */
  readonly textureSize: readonly [number, number];
  /** First index (into the mesh's `indices`) of each triangle; vertex mode: the triangle the vertex is sampled on. */
  readonly triangles: readonly number[];
  /** Vertex mode: the vertex's corner 0..2 in that triangle. */
  readonly corner: number;
}

/**
 * Where every visible face's baked light lies in the lightmap: a pure function of the document's topology, UVs, rest
 * geometry and textures' sizes, never of its pose, so a posed document keeps its layout and `layoutKey`.
 */
export interface LightmapLayout {
  readonly width: number;
  readonly height: number;
  /** Texture texels per lightmap texel along each axis (a power of two, 1 unless the scene would not fit). */
  readonly downscale: number;
  readonly charts: readonly LightmapChart[];
  /**
   * Per mesh, 4 floats per vertex for the preview's `a_lightmap`: texel mode (chart x, chart y, downscale, back
   * offset), vertex mode (texel x, texel y, 0, back offset), (0, 0, −1, 0) for a vertex without light (drawn
   * unoccluded); `null` for a hidden mesh.
   */
  readonly vertexData: readonly (Float32Array | null)[];
  /**
   * Size of the finest texture texel of any texel chart in mesh units, which are world units at rest (the layout is
   * pose-independent; an animated node scale stretches the texels with the mesh); Infinity without one.
   */
  readonly finestTexel: number;
  /** Changes whenever the layout or what it was built from (other than the pose) changes. */
  readonly layoutKey: string;
}

/** What of a layout the preview keeps: no charts (one per vertex in vertex mode), which only the bake reads. */
export type LightmapLayoutSummary = Pick<
  LightmapLayout,
  'width' | 'height' | 'downscale' | 'vertexData' | 'finestTexel' | 'layoutKey'
>;

/** Inclusive texel range of a UV rectangle, as `faceTexelRange` of the look's GLSL computes it. */
function faceTexelRange(rect: ArrayLike<number>, at: number, width: number, height: number): number[] {
  const loX = Math.floor(Math.fround((rect[at] ?? 0) * width) + 1e-3);
  const loY = Math.floor(Math.fround((rect[at + 1] ?? 0) * height) + 1e-3);
  const hiX = Math.max(Math.ceil(Math.fround((rect[at + 2] ?? 0) * width) - 1e-3) - 1, loX);
  const hiY = Math.max(Math.ceil(Math.fround((rect[at + 3] ?? 0) * height) - 1e-3) - 1, loY);
  return [loX, loY, hiX, hiY];
}

interface ProtoChart {
  readonly mesh: number;
  readonly mode: 'texel' | 'vertex';
  /** Texels across at downscale 1. */
  readonly texels: readonly [number, number];
  readonly back: boolean;
  readonly texelLo: readonly [number, number];
  readonly textureSize: readonly [number, number];
  readonly triangles: readonly number[];
  readonly corner: number;
  readonly vertices: readonly number[];
}

/** A triangle's UV-to-position map p = A·(u, v) + b as [A00, A10, A20, A01, A11, A21, b0, b1, b2], or null. */
function affineMap(mesh: SceneMesh, v: readonly number[]): number[] | null {
  const p = (k: number, axis: number) => mesh.positions[(v[k] ?? 0) * 3 + axis] ?? 0;
  const uv = (k: number, axis: number) => mesh.uvs[(v[k] ?? 0) * 2 + axis] ?? 0;
  const du1 = uv(1, 0) - uv(0, 0);
  const dv1 = uv(1, 1) - uv(0, 1);
  const du2 = uv(2, 0) - uv(0, 0);
  const dv2 = uv(2, 1) - uv(0, 1);
  const det = du1 * dv2 - du2 * dv1;
  if (!(Math.abs(det) > 1e-12) || !Number.isFinite(det)) return null;
  const map: number[] = new Array<number>(9);
  for (let axis = 0; axis < 3; axis++) {
    const e1 = p(1, axis) - p(0, axis);
    const e2 = p(2, axis) - p(0, axis);
    const a = (e1 * dv2 - e2 * dv1) / det;
    const b = (e2 * du1 - e1 * du2) / det;
    map[axis] = a;
    map[3 + axis] = b;
    map[6 + axis] = p(0, axis) - a * uv(0, 0) - b * uv(0, 1);
  }
  return map.every(Number.isFinite) ? map : null;
}

function sameMap(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 9; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Math.abs(x - y) > AFFINE_TOLERANCE * Math.max(1, Math.abs(x), Math.abs(y))) return false;
  }
  return true;
}

// Plain scalar code: this runs once per triangle of up to the loaders' 200 000 on the main thread.
function finiteTriangle(mesh: SceneMesh, first: number): boolean {
  const p = mesh.positions;
  const a = (mesh.indices[first] ?? 0) * 3;
  const b = (mesh.indices[first + 1] ?? 0) * 3;
  const c = (mesh.indices[first + 2] ?? 0) * 3;
  const ax = p[a] ?? NaN;
  const ay = p[a + 1] ?? NaN;
  const az = p[a + 2] ?? NaN;
  const ux = (p[b] ?? NaN) - ax;
  const uy = (p[b + 1] ?? NaN) - ay;
  const uz = (p[b + 2] ?? NaN) - az;
  const vx = (p[c] ?? NaN) - ax;
  const vy = (p[c + 1] ?? NaN) - ay;
  const vz = (p[c + 2] ?? NaN) - az;
  if (![ux, uy, uz, vx, vy, vz].every(Number.isFinite)) return false;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const area = nx * nx + ny * ny + nz * nz;
  return area > 0 && Number.isFinite(area);
}

interface MeshTriangle {
  readonly first: number;
  readonly group: number;
  readonly doubleSided: boolean;
}

function meshTriangles(mesh: SceneMesh): MeshTriangle[] {
  const triangles: MeshTriangle[] = [];
  mesh.groups.forEach((group, g) => {
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      if (finiteTriangle(mesh, i)) triangles.push({ first: i, group: g, doubleSided: group.doubleSided === true });
    }
  });
  return triangles;
}

function corners(mesh: SceneMesh, first: number): number[] {
  return [mesh.indices[first] ?? 0, mesh.indices[first + 1] ?? 0, mesh.indices[first + 2] ?? 0];
}

/**
 * Texel charts of a mesh, or null when it must be baked per vertex: an untextured group, a degenerate UV triangle, a
 * vertex shared by triangles of different groups, UV rectangles or UV-to-position maps (a smooth mesh), or a chart of
 * more than MAX_CHART_TRIANGLES triangles.
 */
function texelCharts(
  doc: SceneDocument,
  m: number,
  mesh: SceneMesh,
  triangles: readonly MeshTriangle[],
): { charts: ProtoChart[]; finest: number } | null {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (v: number): number => {
    let root = v;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    while ((parent[v] ?? v) !== root) {
      const next = parent[v] ?? v;
      parent[v] = root;
      v = next;
    }
    return root;
  };
  for (const { first } of triangles) {
    const [a = 0, b = 0, c = 0] = corners(mesh, first);
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
  }
  const chartOf = new Int32Array(vertexCount).fill(-1);
  const charts: {
    group: number;
    rect: number;
    map: number[];
    texture: readonly [number, number];
    triangles: number[];
    back: boolean;
  }[] = [];
  let finest = Infinity;
  for (const { first, group, doubleSided } of triangles) {
    const v = corners(mesh, first);
    const material = doc.materials[mesh.groups[group]?.material ?? -1];
    const texture = material && material.texture >= 0 ? doc.textures[material.texture] : undefined;
    if (!texture || texture.missing || !(texture.width > 0) || !(texture.height > 0)) return null;
    const map = affineMap(mesh, v);
    if (!map) return null;
    // The face's rectangle is the one the preview's flat varying reads: the last corner's.
    const rect = (v[2] ?? 0) * 4;
    const root = find(v[0] ?? 0);
    const existing = chartOf[root] ?? -1;
    if (existing < 0) {
      chartOf[root] = charts.length;
      charts.push({
        group,
        rect,
        map,
        texture: [texture.width, texture.height],
        triangles: [first],
        back: doubleSided,
      });
      const u = Math.hypot(map[0] ?? 0, map[1] ?? 0, map[2] ?? 0) / texture.width;
      const w = Math.hypot(map[3] ?? 0, map[4] ?? 0, map[5] ?? 0) / texture.height;
      finest = Math.min(finest, u, w);
      continue;
    }
    const chart = charts[existing];
    if (!chart || chart.group !== group || !sameMap(chart.map, map)) return null;
    for (let i = 0; i < 4; i++) if (mesh.uvRects[chart.rect + i] !== mesh.uvRects[rect + i]) return null;
    chart.triangles.push(first);
    if (chart.triangles.length > MAX_CHART_TRIANGLES) return null;
  }
  const vertices = charts.map((): number[] => []);
  for (let v = 0; v < vertexCount; v++) {
    const chart = chartOf[find(v)] ?? -1;
    if (chart >= 0) vertices[chart]?.push(v);
  }
  return {
    finest,
    charts: charts.map((chart, i) => {
      const [width, height] = chart.texture;
      const [loX = 0, loY = 0, hiX = 0, hiY = 0] = faceTexelRange(mesh.uvRects, chart.rect, width, height);
      return {
        mesh: m,
        mode: 'texel',
        texels: [hiX - loX + 1, hiY - loY + 1],
        back: chart.back,
        texelLo: [loX, loY],
        textureSize: [width, height],
        triangles: chart.triangles,
        corner: 0,
        vertices: vertices[i] ?? [],
      };
    }),
  };
}

/** One chart per vertex any kept triangle uses, sampled on the first such triangle. */
function vertexCharts(m: number, mesh: SceneMesh, triangles: readonly MeshTriangle[]): ProtoChart[] {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const back = new Uint8Array(vertexCount);
  for (const { first, doubleSided } of triangles) if (doubleSided) for (const v of corners(mesh, first)) back[v] = 1;
  const seen = new Uint8Array(vertexCount);
  const charts: ProtoChart[] = [];
  for (const { first } of triangles) {
    corners(mesh, first).forEach((v, corner) => {
      if (seen[v]) return;
      seen[v] = 1;
      charts.push({
        mesh: m,
        mode: 'vertex',
        texels: [1, 1],
        back: back[v] === 1,
        texelLo: [0, 0],
        textureSize: [0, 0],
        triangles: [first],
        corner,
        vertices: [v],
      });
    });
  }
  return charts;
}

interface Packing {
  readonly height: number;
  readonly places: readonly (readonly [number, number, number, number])[];
}

/** Shelf packing, tallest first then by chart order, so the result depends on the charts only. */
function pack(protos: readonly ProtoChart[], downscale: number): Packing | null {
  const sizes = protos.map((proto): [number, number] =>
    proto.mode === 'texel' ? [Math.ceil(proto.texels[0] / downscale), Math.ceil(proto.texels[1] / downscale)] : [1, 1],
  );
  const order = protos.map((_, i) => i);
  order.sort((a, b) => (sizes[b]?.[1] ?? 0) - (sizes[a]?.[1] ?? 0) || a - b);
  const places: [number, number, number, number][] = new Array<[number, number, number, number]>(protos.length);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const index of order) {
    const [width = 1, height = 1] = sizes[index] ?? [];
    const block = protos[index]?.back ? width * 2 : width;
    if (block > LIGHTMAP_WIDTH) return null;
    if (x + block > LIGHTMAP_WIDTH) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    places[index] = [x, y, width, height];
    x += block;
    shelf = Math.max(shelf, height);
    if ((y + shelf) * LIGHTMAP_WIDTH > MAX_LIGHTMAP_TEXELS) return null;
  }
  return { height: y + shelf, places };
}

/** Two FNV-1a hashes over 32-bit words, as 16 hex digits. */
class LayoutHash {
  private a = 0x811c9dc5;
  private b = 0x01000193 ^ 0x5bd1e995;

  word(value: number): void {
    this.a = Math.imul(this.a ^ (value >>> 0), 16777619) >>> 0;
    this.b = Math.imul(this.b ^ (value >>> 0), 0x01000193) >>> 0;
    this.b = (this.b ^ (this.b >>> 15)) >>> 0;
  }

  number(value: number): void {
    const f = new Float64Array([value]);
    const words = new Uint32Array(f.buffer);
    this.word(words[0] ?? 0);
    this.word(words[1] ?? 0);
  }

  array(values: Float32Array | Uint32Array): void {
    const words = new Uint32Array(values.buffer, values.byteOffset, values.length);
    this.word(words.length);
    for (let i = 0; i < words.length; i++) this.word(words[i] ?? 0);
  }

  hex(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

function hashDocument(hash: LayoutHash, doc: SceneDocument, visible: readonly boolean[]): void {
  for (const node of doc.nodes) {
    hash.number(node.parent);
    for (const value of [...node.pivot, ...(node.restRotation ?? node.rotation)]) hash.number(value);
    hash.word(node.visible ? 1 : 0);
  }
  doc.meshes.forEach((mesh, m) => {
    hash.word(visible[m] ? 1 : 0);
    if (!visible[m]) return;
    hash.number(mesh.node);
    hash.array(mesh.positions);
    hash.array(mesh.uvs);
    hash.array(mesh.uvRects);
    hash.array(mesh.indices);
    for (const group of mesh.groups) {
      for (const value of [group.material, group.start, group.count]) hash.number(value);
      hash.word(group.doubleSided === true ? 1 : 0);
    }
  });
  for (const material of doc.materials) hash.number(material.texture);
  for (const texture of doc.textures) {
    for (const value of [texture.width, texture.height]) hash.number(value);
    hash.word(texture.missing ? 1 : 0);
  }
}

/**
 * Lays out the lightmap of a validated document's visible meshes. A mesh whose faces each map one texture rectangle
 * affinely (every Blockbench element) gets a chart per face at its own texel grid, so light changes per texel like the
 * albedo; faces sharing atlas cells each get their own chart and a double-sided face a second one for its back. Other
 * meshes (shared smooth vertices, untextured faces) get one texel per vertex, interpolated. If the charts do not fit
 * MAX_LIGHTMAP_TEXELS, texel charts take 2, 4, … texture texels per lightmap texel; when even that fails it throws
 * `RendererError` `SCENE_TOO_LARGE` before allocating any lightmap.
 */
export function lightmapLayout(doc: SceneDocument): LightmapLayout {
  const visibility = nodeVisibility(doc);
  const visible = doc.meshes.map((_, m) => meshVisible(doc, m, visibility));
  const protos: ProtoChart[] = [];
  let finestTexel = Infinity;
  doc.meshes.forEach((mesh, m) => {
    if (!visible[m]) return;
    const triangles = meshTriangles(mesh);
    const texel = texelCharts(doc, m, mesh, triangles);
    if (texel) finestTexel = Math.min(finestTexel, texel.finest);
    // A loop, not a spread: a mesh may have hundreds of thousands of charts.
    for (const chart of texel?.charts ?? vertexCharts(m, mesh, triangles)) protos.push(chart);
  });

  // No packing fits fewer texels than the charts hold: start at the first downscale whose area could fit.
  let downscale = 1;
  const area = (k: number) =>
    protos.reduce((sum, proto) => {
      const texels = proto.mode === 'texel' ? Math.ceil(proto.texels[0] / k) * Math.ceil(proto.texels[1] / k) : 1;
      return sum + texels * (proto.back ? 2 : 1);
    }, 0);
  while (downscale < MAX_DOWNSCALE && area(downscale) > MAX_LIGHTMAP_TEXELS) downscale *= 2;
  let packing = pack(protos, downscale);
  while (!packing && downscale < MAX_DOWNSCALE) {
    downscale *= 2;
    packing = pack(protos, downscale);
  }
  if (!packing) {
    throw new RendererError(
      'SCENE_TOO_LARGE',
      `the lightmap needs more than ${MAX_LIGHTMAP_TEXELS} texels even at ${MAX_DOWNSCALE} texture texels per texel (${protos.length} charts)`,
      'meshes',
    );
  }

  const vertexData = doc.meshes.map((mesh, m) => {
    if (!visible[m]) return null;
    const data = new Float32Array(Math.floor(mesh.positions.length / 3) * 4);
    for (let v = 0; v < data.length; v += 4) data[v + 2] = -1;
    return data;
  });
  const places = packing.places;
  const charts = protos.map((proto, i): LightmapChart => {
    const [x = 0, y = 0, width = 1, height = 1] = places[i] ?? [];
    const data = vertexData[proto.mesh];
    if (data) {
      const k = proto.mode === 'texel' ? downscale : 0;
      const back = proto.back ? width : 0;
      for (const v of proto.vertices) {
        data[v * 4] = x;
        data[v * 4 + 1] = y;
        data[v * 4 + 2] = k;
        data[v * 4 + 3] = back;
      }
    }
    return {
      mesh: proto.mesh,
      mode: proto.mode,
      x,
      y,
      width,
      height,
      back: proto.back,
      texelLo: proto.texelLo,
      textureSize: proto.textureSize,
      triangles: proto.triangles,
      corner: proto.corner,
    };
  });

  const height = Math.max(1, packing.height);
  const hash = new LayoutHash();
  hash.word(LIGHTMAP_WIDTH);
  hash.word(height);
  hash.word(downscale);
  for (const chart of charts) {
    for (const value of [chart.mesh, chart.x, chart.y, chart.width, chart.height, chart.corner]) hash.word(value);
    hash.word(chart.mode === 'texel' ? 1 : 0);
    hash.word(chart.back ? 1 : 0);
    for (const value of chart.triangles) hash.word(value);
  }
  hashDocument(hash, doc, visible);
  return { width: LIGHTMAP_WIDTH, height, downscale, charts, vertexData, finestTexel, layoutKey: hash.hex() };
}
