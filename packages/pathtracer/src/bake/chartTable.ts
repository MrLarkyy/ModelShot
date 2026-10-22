import type { LightmapLayout } from '@modelshot/renderer-rt';
import type { FlatScene } from '../flattenScene';
import { dataTexture, rowsFor, type DataTexture } from '../packSceneData';

/** RGBA32F texels per chart record (bake.frag.glsl reads the same layout). */
export const CHART_TEXELS = 4;
export const CHART_MODE_TEXEL = 0;
export const CHART_MODE_VERTEX = 1;
export const CHART_MODE_WORLD = 2;
/** RGBA32F texels per world chart triangle in the corners texture: (s0, t0, s1, t1), (s2, t2, 0, 0). */
export const CORNER_TEXELS = 2;

/**
 * What the bake shader needs to find the surface point of every lightmap texel. Chart record (4 texels):
 * (x, y, width, height) of the front chart; (u0, v0, du, dv) with the UV of chart-local texel point (s, t) at
 * (u0 + s du, v0 + t dv) in texel mode, (first corners entry, 0, 0, 0) in world mode; (first list entry, triangle
 * count, back offset, mode); (barycentric of the vertex in its triangle, 0, 0) for vertex mode. Triangle list: ids in
 * BVH order, 4 per texel, −1 for a triangle not traced. Corners: per triangle of a world chart, in list order, its
 * corners in chart-local texels (`LightmapChart.corners`), CORNER_TEXELS texels each.
 */
export interface ChartTable {
  readonly charts: DataTexture;
  readonly triangles: DataTexture;
  readonly corners: DataTexture;
  /** Per lightmap texel (row-major, `width` per row): its chart's index + 1, 0 for none. */
  readonly index: Uint32Array;
  readonly width: number;
  readonly height: number;
}

/**
 * The chart table of `layout` over the triangles of `flat` (built from the same document) in the order `bvhOrder`
 * (`Bvh.order`). Rows over `maxTextureSize` throw `PathTracerError` `SCENE_TOO_LARGE` before anything is allocated.
 */
export function buildChartTable(
  layout: LightmapLayout,
  flat: FlatScene,
  bvhOrder: Uint32Array,
  maxTextureSize: number,
): ChartTable {
  const entries = layout.charts.reduce((sum, chart) => sum + chart.triangles.length, 0);
  const chartRows = rowsFor(layout.charts.length * CHART_TEXELS, maxTextureSize, 'lightmap charts');
  const triangleRows = rowsFor(Math.ceil(entries / 4), maxTextureSize, 'lightmap chart triangles');
  const worldEntries = layout.charts.reduce(
    (sum, chart) => sum + (chart.mode === 'world' ? chart.triangles.length : 0),
    0,
  );
  const cornerRows = rowsFor(worldEntries * CORNER_TEXELS, maxTextureSize, 'lightmap chart corners');
  // The index and the sums are as wide as a data row (LIGHTMAP_WIDTH = DATA_TEXTURE_WIDTH): rows = lightmap height.
  rowsFor(layout.height * layout.width, maxTextureSize, 'lightmap rows');

  // The place in the BVH order of the flat triangle of (mesh, first index).
  const bvhIndex = new Int32Array(flat.count);
  for (let i = 0; i < flat.count; i++) bvhIndex[bvhOrder[i] ?? 0] = i;
  const lookup = new Map<number, Map<number, number>>();
  for (let t = 0; t < flat.count; t++) {
    const mesh = flat.sources[t * 2] ?? 0;
    let byFirst = lookup.get(mesh);
    if (!byFirst) {
      byFirst = new Map();
      lookup.set(mesh, byFirst);
    }
    byFirst.set(flat.sources[t * 2 + 1] ?? 0, bvhIndex[t] ?? -1);
  }

  const charts = dataTexture(chartRows);
  const triangles = dataTexture(triangleRows);
  triangles.data.fill(-1);
  const corners = dataTexture(cornerRows);
  const index = new Uint32Array(layout.width * layout.height);
  let entry = 0;
  let cornerEntry = 0;
  layout.charts.forEach((chart, c) => {
    const at = c * CHART_TEXELS * 4;
    const byFirst = lookup.get(chart.mesh);
    const first = entry;
    for (const triangle of chart.triangles) triangles.data[entry++] = byFirst?.get(triangle) ?? -1;
    const texel = chart.mode === 'texel';
    const [texWidth, texHeight] = chart.textureSize;
    const k = layout.downscale;
    charts.data.set([chart.x, chart.y, chart.width, chart.height], at);
    if (texel) {
      charts.data.set([chart.texelLo[0] / texWidth, chart.texelLo[1] / texHeight, k / texWidth, k / texHeight], at + 4);
    }
    const mode = texel ? CHART_MODE_TEXEL : chart.mode === 'world' ? CHART_MODE_WORLD : CHART_MODE_VERTEX;
    charts.data.set([first, chart.triangles.length, chart.back ? chart.width : 0, mode], at + 8);
    if (mode === CHART_MODE_WORLD) {
      charts.data[at + 4] = cornerEntry;
      chart.triangles.forEach((_, j) => {
        const c = chart.corners;
        const to = (cornerEntry + j) * CORNER_TEXELS * 4;
        corners.data.set([c[j * 6] ?? 0, c[j * 6 + 1] ?? 0, c[j * 6 + 2] ?? 0, c[j * 6 + 3] ?? 0], to);
        corners.data.set([c[j * 6 + 4] ?? 0, c[j * 6 + 5] ?? 0, 0, 0], to + 4);
      });
      cornerEntry += chart.triangles.length;
    } else if (!texel) {
      // Just inside the corner: a ray from the exact vertex could meet the faces that share it.
      const inset = 1e-3;
      const corners = [
        [inset, inset],
        [1 - 2 * inset, inset],
        [inset, 1 - 2 * inset],
      ];
      charts.data.set([...(corners[chart.corner] ?? [inset, inset]), 0, 0], at + 12);
    }
    const blocks = chart.back ? 2 : 1;
    for (let y = chart.y; y < chart.y + chart.height; y++) {
      index.fill(c + 1, y * layout.width + chart.x, y * layout.width + chart.x + chart.width * blocks);
    }
  });
  return { charts, triangles, corners, index, width: layout.width, height: layout.height };
}
