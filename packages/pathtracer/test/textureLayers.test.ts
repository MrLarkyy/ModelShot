import { describe, expect, it } from 'vitest';
import { PathTracerError } from '../src/PathTracerError';
import { planTextureLayers, type TextureLayerPlan } from '../src/textureLayers';

function checkPlan(plan: TextureLayerPlan, sizes: readonly { width: number; height: number }[]): void {
  expect(plan.placements).toHaveLength(sizes.length);
  plan.placements.forEach((p, i) => {
    expect([p.width, p.height]).toEqual([sizes[i]?.width, sizes[i]?.height]);
    expect(p.layer).toBeGreaterThanOrEqual(0);
    expect(p.layer).toBeLessThan(plan.layers);
    expect(p.x + p.width).toBeLessThanOrEqual(plan.width);
    expect(p.y + p.height).toBeLessThanOrEqual(plan.height);
    plan.placements.forEach((q, j) => {
      if (j <= i || q.layer !== p.layer) return;
      const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
      expect(apart, `images ${i} and ${j} overlap`).toBe(true);
    });
  });
}

describe('planTextureLayers', () => {
  const sizes = [
    { width: 1, height: 1 },
    { width: 2, height: 2 },
    { width: 32, height: 32 },
    { width: 64, height: 64 },
    { width: 16, height: 48 },
  ];

  it('packs small scenes into one layer of the smallest power-of-two width, without overlap', () => {
    const plan = planTextureLayers(sizes, 4096, 256);
    checkPlan(plan, sizes);
    expect(plan.layers).toBe(1);
    expect(plan.width).toBe(128);
    expect(plan.height).toBeLessThanOrEqual(plan.width);
  });

  it('is deterministic and independent of nothing but the sizes', () => {
    expect(planTextureLayers(sizes, 4096, 256)).toEqual(planTextureLayers([...sizes], 4096, 256));
  });

  it('spills into layers of the maximum side when one layer is not enough', () => {
    const many = Array.from({ length: 9 }, () => ({ width: 64, height: 64 }));
    const plan = planTextureLayers(many, 128, 256);
    checkPlan(plan, many);
    expect([plan.width, plan.height, plan.layers]).toEqual([128, 128, 3]);
  });

  it('rejects an image over the side and more layers than the GPU allows', () => {
    expect(() => planTextureLayers([{ width: 129, height: 1 }], 128, 256)).toThrow(PathTracerError);
    expect(() =>
      planTextureLayers(
        Array.from({ length: 9 }, () => ({ width: 64, height: 64 })),
        128,
        2,
      ),
    ).toThrow(/need 3 layers of 128x128; this GPU allows 2/);
  });
});
