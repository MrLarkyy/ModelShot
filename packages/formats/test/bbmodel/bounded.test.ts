import { describe, expect, it } from 'vitest';
import { BbmodelError, DEFAULT_BBMODEL_LIMITS, loadBbmodel } from '../../src/index';
import { cube, mesh, meshFace, model } from './fixtures';

function manyCubes(count: number): string {
  const elements = Array.from({ length: count }, (_, i) =>
    cube({ uuid: `c${i}`, from: [i % 100, Math.floor(i / 100), 0], to: [(i % 100) + 1, Math.floor(i / 100) + 1, 1] }),
  );
  return JSON.stringify(model({ elements, outliner: elements.map((_, i) => `c${i}`) }));
}

/** One mesh of `faces` concave 16-vertex combs (14 triangles each), all over the same 16 vertices. */
function combMesh(faces: number): string {
  const points: [number, number][] = [[0, 0]];
  for (let k = 0; k < 7; k++) points.push([k * 2 + 1, 0], [k * 2 + 2, 3]);
  points.push([0, 4]);
  const keys = points.map((_, i) => `v${i}`);
  const vertices = Object.fromEntries(points.map(([x, y], i) => [`v${i}`, [x, y, 0]]));
  const faceList = Object.fromEntries(Array.from({ length: faces }, (_, i) => [`f${i}`, meshFace(keys)]));
  return JSON.stringify(model({ elements: [mesh({ vertices, faces: faceList })] }));
}

describe('bounded loading', () => {
  it('a model at the default element limit loads in under 5 s', () => {
    const text = manyCubes(DEFAULT_BBMODEL_LIMITS.maxElements);
    const start = performance.now();
    const { scene } = loadBbmodel(text);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(scene.meshes).toHaveLength(DEFAULT_BBMODEL_LIMITS.maxElements);
  });

  it('honours a lowered triangle limit exactly', () => {
    const text = manyCubes(10);
    expect(loadBbmodel(text, { limits: { maxTriangles: 120 } }).scene.meshes).toHaveLength(10);
    expect(() => loadBbmodel(text, { limits: { maxTriangles: 119 } })).toThrow(BbmodelError);
  });

  it('concave 16-gons up to the default triangle limit load in under 5 s', () => {
    const faces = Math.floor(DEFAULT_BBMODEL_LIMITS.maxTriangles / 14);
    const text = combMesh(faces);
    const start = performance.now();
    const { scene } = loadBbmodel(text);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(scene.meshes[0]?.indices).toHaveLength(faces * 14 * 3);
    expect(() => loadBbmodel(combMesh(faces + 1))).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_TRIANGLES' }) as Error,
    );
  });

  it('honours a lowered vertex limit exactly', () => {
    const text = combMesh(3);
    expect(loadBbmodel(text, { limits: { maxVertices: 48 } }).scene.meshes[0]?.positions).toHaveLength(48 * 3);
    expect(() => loadBbmodel(text, { limits: { maxVertices: 47 } })).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_VERTICES' }) as Error,
    );
  });

  it('leaves the defaults untouched when only some limits are overridden', () => {
    loadBbmodel(manyCubes(1), { limits: { maxTriangles: 12 } });
    expect(DEFAULT_BBMODEL_LIMITS.maxTriangles).toBe(200_000);
    expect(Object.isFrozen(DEFAULT_BBMODEL_LIMITS)).toBe(true);
  });
});
