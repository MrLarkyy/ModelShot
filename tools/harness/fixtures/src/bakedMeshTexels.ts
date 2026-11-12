import type { BakedLighting, LightmapLayout } from '@modelshot/renderer-rt';

/**
 * The half-float RGBA texels (4 numbers each, as stored) of every lightmap chart of mesh `mesh`, chart by chart in
 * layout order, each row by row from its first texel (a double-sided chart's back side included), so two bakes of
 * documents whose mesh has the same charts compare texel for texel.
 */
export function bakedMeshTexels(lighting: BakedLighting, layout: LightmapLayout, mesh: number): number[] {
  const out: number[] = [];
  for (const chart of layout.charts) {
    if (chart.mesh !== mesh) continue;
    const width = chart.back ? chart.width * 2 : chart.width;
    for (let y = chart.y; y < chart.y + chart.height; y++) {
      const start = (y * lighting.width + chart.x) * 4;
      out.push(...lighting.data.subarray(start, start + width * 4));
    }
  }
  return out;
}
