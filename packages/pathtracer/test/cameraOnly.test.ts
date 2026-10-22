import { describe, expect, it } from 'vitest';
import { buildBvh } from '../src/buildBvh';
import { flattenScene } from '../src/flattenScene';
import { packGeometry, TRIANGLE_POSITION_TEXELS } from '../src/packSceneData';
import { pathTracerProgramSource } from '../src/pathTracerShaders';
import { randomTriangles, sceneOf, triangleMesh } from './testScenes';

/** The sides code (w of the second position texel) of every packed triangle, in BVH order. */
function codes(groups: { doubleSided?: boolean; cameraOnly?: boolean }[]): number[] {
  const per = 4;
  const mesh = triangleMesh(randomTriangles(per * groups.length, 7), {
    groups: groups.map((flags, g) => ({ material: 0, start: g * per * 3, count: per * 3, ...flags })),
  });
  const flat = flattenScene(sceneOf([mesh]));
  const packed = packGeometry(flat, buildBvh(flat.positions, flat.count), 4096);
  return Array.from(
    { length: flat.count },
    (_, i) => packed.triPositions.data[i * TRIANGLE_POSITION_TEXELS * 4 + 7] ?? -1,
  );
}

describe('camera-only faces (SceneMeshGroup.cameraOnly)', () => {
  it('flattenScene marks them per triangle', () => {
    const mesh = triangleMesh(randomTriangles(2, 3), {
      groups: [
        { material: 0, start: 0, count: 3 },
        { material: 0, start: 3, count: 3, cameraOnly: true },
      ],
    });
    expect(Array.from(flattenScene(sceneOf([mesh])).cameraOnly)).toEqual([0, 1]);
  });

  it('packs the sides code double-sided 1 + camera-only 2', () => {
    expect(new Set(codes([{}]))).toEqual(new Set([0]));
    expect(new Set(codes([{ doubleSided: true }]))).toEqual(new Set([1]));
    expect(new Set(codes([{ cameraOnly: true }]))).toEqual(new Set([2]));
    expect(new Set(codes([{ doubleSided: true, cameraOnly: true }]))).toEqual(new Set([3]));
    expect(codes([{ cameraOnly: false }, { doubleSided: false, cameraOnly: false }])).toEqual(
      codes([{}, { doubleSided: false }]),
    );
  });

  it('packs a scene without the flag bit-identically to the doubleSided code alone', () => {
    const mesh = triangleMesh(randomTriangles(40, 11), {
      groups: [
        { material: 0, start: 0, count: 60, doubleSided: true },
        { material: 0, start: 60, count: 60 },
      ],
    });
    const flat = flattenScene(sceneOf([mesh]));
    const bvh = buildBvh(flat.positions, flat.count);
    const packed = packGeometry(flat, bvh, 4096).triPositions.data;
    for (let i = 0; i < flat.count; i++) {
      expect(packed[i * TRIANGLE_POSITION_TEXELS * 4 + 7]).toBe(flat.doubleSided[bvh.order[i] ?? 0]);
    }
  });

  it('only the path loop camera ray sees them; shadow, bounce, fill, catcher and bake rays skip them', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    const bake = pathTracerProgramSource('bake').fragment;
    // The 9-parameter form, used by every ray but the camera ray, forwards false.
    expect(trace).toMatch(
      /closestHit\(origin, direction, tMin, tMax, depthScale, skip, sampleKey, alphaDimension, hit, false\)/,
    );
    expect(trace).toContain('if (!cameraRay && isCameraOnly(p1.w)) continue;');
    expect(trace.match(/if \(isCameraOnly\(p1\.w\)\) continue;/g)).toHaveLength(1);
    expect(trace.match(/closestHit\([^;]*, pathVertex == 0\)/g)).toHaveLength(1);
    expect(bake).not.toMatch(/closestHit\([^;]*, (true|pathVertex == 0)\)/);
  });
});
