import { describe, expect, it } from 'vitest';
import { statsText } from '../src/viewport/StatsOverlay';

describe('statsText', () => {
  it('tells fps, triangles and the bake time', () => {
    const text = statsText(60, { triangles: 12345, meshes: 3 }, 0.44, 119.6);
    expect(text).toBe('60 fps · 12,345 triangles · 3 meshes · overlay 0.4 ms · bake 120 ms');
  });

  it('says there is no bake time yet', () => {
    expect(statsText(30, { triangles: 1, meshes: 1 }, 1, null)).toContain('bake -');
  });
});
