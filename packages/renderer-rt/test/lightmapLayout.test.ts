import { poseScene, type SceneDocument, type SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { LIGHTMAP_WIDTH, MAX_LIGHTMAP_TEXELS, lightmapLayout } from '../src/lightmapLayout';
import { RendererError } from '../src/RendererError';
import { quadScene, testTexture } from './testScene';

/** A quad over texels [x0, x0 + 6) × [y0, y0 + 6) of the 16 × 16 test texture, as a Blockbench face. */
function faceQuad(x0: number, y0: number, overrides: Partial<SceneMesh> = {}): SceneMesh {
  const base = quadScene().meshes[0]!;
  const [u0, v0, u1, v1] = [x0 / 16, y0 / 16, (x0 + 6) / 16, (y0 + 6) / 16];
  return {
    ...base,
    uvs: new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0]),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [u0, v0, u1, v1]).flat()),
    ...overrides,
  };
}

function withMeshes(meshes: SceneMesh[], change: Partial<SceneDocument> = {}): SceneDocument {
  const doc = quadScene();
  return { ...doc, meshes, nodes: [{ ...doc.nodes[0]!, meshes: meshes.map((_, i) => i) }], ...change };
}

describe('lightmapLayout', () => {
  it('gives a 6 x 6 texel face a chart of 36 texels at its own texel grid', () => {
    const layout = lightmapLayout(withMeshes([faceQuad(2, 3)]));
    expect(layout.charts).toHaveLength(1);
    const chart = layout.charts[0]!;
    expect(chart).toMatchObject({ mode: 'texel', width: 6, height: 6, back: false, texelLo: [2, 3] });
    expect(chart.width * chart.height).toBe(36);
    expect(chart.textureSize).toEqual([16, 16]);
    expect(chart.triangles).toEqual([0, 3]);
    expect([layout.width, layout.height, layout.downscale]).toEqual([LIGHTMAP_WIDTH, 6, 1]);
    expect(Array.from(layout.vertexData[0]!.subarray(0, 4))).toEqual([chart.x, chart.y, 1, 0]);
    // 6 texels over 1 unit.
    expect(layout.finestTexel).toBeCloseTo(1 / 6, 6);
  });

  it('gives faces sharing an atlas cell their own charts and a double-sided face a back chart', () => {
    const doubleSided = faceQuad(2, 3, { groups: [{ material: 0, start: 0, count: 6, doubleSided: true }] });
    const layout = lightmapLayout(withMeshes([doubleSided, faceQuad(2, 3)]));
    expect(layout.charts).toHaveLength(2);
    const [back, front] = layout.charts;
    expect(back?.back).toBe(true);
    expect(front?.back).toBe(false);
    expect(Array.from(layout.vertexData[0]!.subarray(0, 4))).toEqual([back!.x, back!.y, 1, 6]);
    // The back chart follows at x + width, so the next chart starts 12 texels on.
    expect(Math.abs(front!.x - back!.x)).toBeGreaterThanOrEqual(6);
    expect(front!.x === back!.x + 12 || back!.x === front!.x + 6).toBe(true);
  });

  it('gives world charts to a mesh with a vertex shared across UV maps and to an untextured mesh', () => {
    // A quad folded along its diagonal: both triangles share two vertices but lie in different planes.
    const folded = faceQuad(0, 0, { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0]) });
    const untextured = faceQuad(0, 0, { groups: [{ material: -1, start: 0, count: 6, doubleSided: true }] });
    const layout = lightmapLayout(withMeshes([folded, untextured]));
    expect(layout.charts.map((c) => [c.mesh, c.mode, c.back, c.triangles])).toEqual([
      [0, 'world', false, [0]],
      [0, 'world', false, [3]],
      [1, 'world', true, [0, 3]],
    ]);
    // One texel per 1/256 of the rest diagonal (sqrt 3).
    const texel = Math.sqrt(3) / 256;
    expect([layout.charts[2]?.width, layout.charts[2]?.height]).toEqual([Math.ceil(1 / texel), Math.ceil(1 / texel)]);
    // Light by corner, none by vertex.
    expect(Array.from(layout.vertexData[1]!.subarray(0, 4))).toEqual([0, 0, -1, 0]);
    const corners = layout.cornerData[1]!;
    expect(corners).toHaveLength(6 * 8);
    const chart = layout.charts[2]!;
    for (let i = 0; i < 6; i++) {
      const at = Array.from(corners.subarray(i * 8, i * 8 + 8));
      expect(at.slice(2, 8)).toEqual([-2, chart.width, chart.x, chart.y, chart.width, chart.height]);
      expect(at[0]).toBeGreaterThanOrEqual(chart.x);
      expect(at[0]).toBeLessThanOrEqual(chart.x + chart.width);
    }
    expect(layout.cornerData[0]).toHaveLength(6 * 8);
  });

  it('gives a smooth untextured box a world chart per side, its corners per index', () => {
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const faces = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
    ];
    const indices = faces.flatMap(([a = 0, b = 0, c = 0, d = 0]) => [a, b, c, a, c, d]);
    const box: SceneMesh = {
      ...quadScene().meshes[0]!,
      positions: new Float32Array(p),
      normals: new Float32Array(p),
      uvs: new Float32Array(16),
      uvRects: new Float32Array(32),
      indices: new Uint32Array(indices),
      groups: [{ material: -1, start: 0, count: 36 }],
    };
    const layout = lightmapLayout(withMeshes([box]));
    expect(layout.charts.map((c) => [c.mode, c.triangles.length])).toEqual(
      Array.from({ length: 6 }, () => ['world', 2]),
    );
    expect(layout.cornerData[0]).toHaveLength(36 * 8);
    // A vertex shared by three sides lies in three charts.
    const charts = new Set<number>();
    indices.forEach((v, i) => {
      if (v === 0) charts.add(layout.cornerData[0]![i * 8 + 4]! * 4096 + layout.cornerData[0]![i * 8 + 5]!);
    });
    expect(charts.size).toBe(3);
    expect(layout.downscale).toBe(1);
  });

  it('sizes the world texel by the triangles kept, not by a vertex no triangle uses', () => {
    const untextured = faceQuad(0, 0, { groups: [{ material: -1, start: 0, count: 6 }] });
    const stray = {
      ...untextured,
      positions: new Float32Array([...untextured.positions, 1e6, 1e6, 1e6]),
      normals: new Float32Array([...untextured.normals, 0, 0, 1]),
      uvs: new Float32Array([...untextured.uvs, 0, 0]),
      uvRects: new Float32Array([...untextured.uvRects, 0, 0, 1, 1]),
    };
    const size = (mesh: SceneMesh) => {
      const chart = lightmapLayout(withMeshes([mesh])).charts[0]!;
      return [chart.mode, chart.width, chart.height];
    };
    // The unit quad at sqrt 2 / 256 per texel.
    expect(size(untextured)).toEqual(['world', 182, 182]);
    expect(size(stray)).toEqual(size(untextured));
  });

  it('bakes per vertex an untextured mesh of more than 4096 triangles', () => {
    const triangles = 4097;
    const positions = new Float32Array(triangles * 9);
    for (let t = 0; t < triangles; t++) positions.set([t, 0, 0, t + 1, 0, 0, t, 1, 0], t * 9);
    const dense: SceneMesh = {
      ...quadScene().meshes[0]!,
      positions,
      normals: new Float32Array(triangles * 9),
      uvs: new Float32Array(triangles * 6),
      uvRects: new Float32Array(triangles * 12),
      indices: Uint32Array.from({ length: triangles * 3 }, (_, i) => i),
      groups: [{ material: -1, start: 0, count: triangles * 3 }],
    };
    const layout = lightmapLayout(withMeshes([dense]));
    expect(layout.charts).toHaveLength(triangles * 3);
    expect(layout.charts.every((c) => c.mode === 'vertex')).toBe(true);
    expect(layout.cornerData[0]).toBeNull();
  });

  it('coarsens world charts before a textured face loses resolution, then falls back to per-vertex light', () => {
    const untextured = faceQuad(0, 0, { groups: [{ material: -1, start: 0, count: 6, doubleSided: true }] });
    const whole = () =>
      faceQuad(0, 0, { uvRects: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1, 1]).flat()) });
    // 2048 x 1000 texels of the 2 Mi cap: the world chart must shrink to fit beside them.
    const tight = lightmapLayout(
      withMeshes([whole(), untextured], { textures: [testTexture({ width: 2048, height: 1000 })] }),
    );
    expect(tight.downscale).toBe(1);
    const texelChart = tight.charts.find((c) => c.mode === 'texel')!;
    expect([texelChart.width, texelChart.height]).toEqual([2048, 1000]);
    const coarse = tight.charts.find((c) => c.mode === 'world')!;
    // At the rest diagonal (sqrt 2) / 256 the quad would be 182 texels square; here 2, 4, ... times coarser.
    const base = Math.SQRT2 / 256;
    const coarser = [2, 4, 8, 16, 32, 64, 128, 256].map((k) => Math.ceil(1 / (base * k)));
    expect(coarser).toContain(coarse.width);
    expect(coarse.width).toBe(coarse.height);
    expect(tight.height * LIGHTMAP_WIDTH).toBeLessThanOrEqual(MAX_LIGHTMAP_TEXELS);
    // Texel charts filling the whole cap: the world mesh falls back to per-vertex light, the rules after unchanged.
    const full = lightmapLayout(
      withMeshes([whole(), untextured], { textures: [testTexture({ width: 2048, height: 1024 })] }),
    );
    expect(full.charts.filter((c) => c.mesh === 1).map((c) => c.mode)).toEqual([
      'vertex',
      'vertex',
      'vertex',
      'vertex',
    ]);
    expect(full.cornerData[1]).toBeNull();
    expect(full.downscale).toBe(2);
  });

  it('lays out a scene without a world-charted mesh as before world charts (key recorded on 086af35)', () => {
    const doubleSided = faceQuad(2, 3, { groups: [{ material: 0, start: 0, count: 6, doubleSided: true }] });
    const layout = lightmapLayout(withMeshes([doubleSided, faceQuad(8, 8)]));
    expect(layout.layoutKey).toBe('81ad42f474700503');
    expect(layout.cornerData).toEqual([null, null]);
  });

  it('keeps a world-charted layout and its key across repeats and poses', () => {
    const untextured = faceQuad(0, 0, { groups: [{ material: -1, start: 0, count: 6 }] });
    const doc = withMeshes([faceQuad(2, 3), untextured]);
    const layout = lightmapLayout(doc);
    expect(layout.charts.map((c) => c.mode)).toEqual(['texel', 'world']);
    expect(lightmapLayout(withMeshes([faceQuad(2, 3), { ...untextured }])).layoutKey).toBe(layout.layoutKey);
    const posed = poseScene(doc, { name: 'p', bones: [{ bone: 'root', rotation: [0, 45, 10] }] }).document;
    const again = lightmapLayout(posed);
    expect(again.layoutKey).toBe(layout.layoutKey);
    expect(Array.from(again.cornerData[1]!)).toEqual(Array.from(layout.cornerData[1]!));
    // Moving a corner moves the chart's corners: a new key.
    const moved = { ...untextured, positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1.5, 0, 0, 1, 0]) };
    expect(lightmapLayout(withMeshes([faceQuad(2, 3), moved])).layoutKey).not.toBe(layout.layoutKey);
  });

  it('leaves degenerate triangles without light and hidden meshes out', () => {
    const flat = faceQuad(0, 0, { positions: new Float32Array(12) });
    const hidden = faceQuad(0, 0, { visible: false });
    const layout = lightmapLayout(withMeshes([flat, hidden]));
    expect(layout.charts).toEqual([]);
    expect(Array.from(layout.vertexData[0]!.subarray(0, 4))).toEqual([0, 0, -1, 0]);
    expect(layout.vertexData[1]).toBeNull();
    expect(layout.height).toBe(1);
  });

  it('doubles the texture texels per lightmap texel until the charts fit', () => {
    const doc = withMeshes([{ ...quadScene().meshes[0]! }], {
      textures: [testTexture({ width: 4096, height: 4096 })],
    });
    const layout = lightmapLayout(doc);
    // 4096 texels: 2048 wide at 2 (4 Mi texels, too many), 1024 at 4.
    expect(layout.downscale).toBe(4);
    expect([layout.charts[0]?.width, layout.charts[0]?.height]).toEqual([1024, 1024]);
    expect(layout.vertexData[0]?.[2]).toBe(4);
  });

  it('rejects a scene whose per-vertex charts exceed the lightmap with SCENE_TOO_LARGE', () => {
    const triangles = Math.ceil(MAX_LIGHTMAP_TEXELS / 6) + 1;
    const positions = new Float32Array(triangles * 9);
    for (let t = 0; t < triangles; t++) positions.set([t, 0, 0, t + 1, 0, 0, t, 1, 0], t * 9);
    const mesh: SceneMesh = {
      ...quadScene().meshes[0]!,
      positions,
      normals: new Float32Array(triangles * 9),
      uvs: new Float32Array(triangles * 6),
      uvRects: new Float32Array(triangles * 12),
      indices: Uint32Array.from({ length: triangles * 3 }, (_, i) => i),
      groups: [{ material: -1, start: 0, count: triangles * 3, doubleSided: true }],
    };
    let error: unknown;
    try {
      lightmapLayout(withMeshes([mesh]));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RendererError);
    expect((error as RendererError).code).toBe('SCENE_TOO_LARGE');
    expect((error as RendererError).path).toBe('meshes');
  });

  it('keeps its key across poses and changes it with topology or UVs', () => {
    const doc = withMeshes([faceQuad(2, 3), faceQuad(8, 8)]);
    const key = lightmapLayout(doc).layoutKey;
    const posed = poseScene(doc, { name: 'p', bones: [{ bone: 'root', rotation: [0, 45, 10] }] }).document;
    expect(posed.nodes[0]?.rotation).toEqual([0, 45, 10]);
    expect(lightmapLayout(posed).layoutKey).toBe(key);
    expect(lightmapLayout(withMeshes([faceQuad(2, 3), faceQuad(8, 8)])).layoutKey).toBe(key);
    const uv = withMeshes([faceQuad(2, 3), faceQuad(8, 9)]);
    expect(lightmapLayout(uv).layoutKey).not.toBe(key);
    const topology = withMeshes([faceQuad(2, 3), faceQuad(8, 8, { indices: new Uint32Array([0, 1, 2, 2, 3, 0]) })]);
    expect(lightmapLayout(topology).layoutKey).not.toBe(key);
  });

  it('changes its key when a group becomes camera-only, so a bake that shaded it is not reused', () => {
    const groups = (cameraOnly?: boolean) => [
      { material: 0, start: 0, count: 6, ...(cameraOnly === undefined ? {} : { cameraOnly }) },
    ];
    const key = lightmapLayout(withMeshes([faceQuad(2, 3, { groups: groups() })])).layoutKey;
    expect(lightmapLayout(withMeshes([faceQuad(2, 3, { groups: groups(false) })])).layoutKey).toBe(key);
    expect(lightmapLayout(withMeshes([faceQuad(2, 3, { groups: groups(true) })])).layoutKey).not.toBe(key);
  });
});
