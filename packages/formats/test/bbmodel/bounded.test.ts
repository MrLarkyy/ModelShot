import { describe, expect, it } from 'vitest';
import { BbmodelError, DEFAULT_BBMODEL_LIMITS, loadBbmodel } from '../../src/index';
import { cube, model } from './fixtures';

function manyCubes(count: number): string {
  const elements = Array.from({ length: count }, (_, i) =>
    cube({ uuid: `c${i}`, from: [i % 100, Math.floor(i / 100), 0], to: [(i % 100) + 1, Math.floor(i / 100) + 1, 1] }),
  );
  return JSON.stringify(model({ elements, outliner: elements.map((_, i) => `c${i}`) }));
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

  it('leaves the defaults untouched when only some limits are overridden', () => {
    loadBbmodel(manyCubes(1), { limits: { maxTriangles: 12 } });
    expect(DEFAULT_BBMODEL_LIMITS.maxTriangles).toBe(200_000);
    expect(Object.isFrozen(DEFAULT_BBMODEL_LIMITS)).toBe(true);
  });
});
