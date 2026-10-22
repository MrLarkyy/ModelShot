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

  it('bakes per vertex a mesh with a vertex shared across UV maps, and an untextured mesh', () => {
    // A quad folded along its diagonal: both triangles share two vertices but lie in different planes.
    const folded = faceQuad(0, 0, { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0]) });
    const untextured = faceQuad(0, 0, { groups: [{ material: -1, start: 0, count: 6, doubleSided: true }] });
    const layout = lightmapLayout(withMeshes([folded, untextured]));
    expect(layout.charts.map((c) => [c.mesh, c.mode, c.width, c.height])).toEqual([
      [0, 'vertex', 1, 1],
      [0, 'vertex', 1, 1],
      [0, 'vertex', 1, 1],
      [0, 'vertex', 1, 1],
      [1, 'vertex', 1, 1],
      [1, 'vertex', 1, 1],
      [1, 'vertex', 1, 1],
      [1, 'vertex', 1, 1],
    ]);
    expect(layout.charts.map((c) => c.back)).toEqual([false, false, false, false, true, true, true, true]);
    // Each vertex sampled at its corner of the first triangle that uses it (indices 0 1 2, 0 2 3).
    expect(layout.charts.slice(0, 4).map((c) => [c.triangles[0], c.corner])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [3, 2],
    ]);
    const data = layout.vertexData[1]!;
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(1);
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
