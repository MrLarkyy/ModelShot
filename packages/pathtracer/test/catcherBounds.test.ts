import { DEFAULT_LOOK } from '@modelshot/looks';
import { shadowCatcherPlane } from '@modelshot/renderer-rt';
import { sceneBounds, type SceneBounds } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathTracer } from '../src/PathTracer';
import { boxMesh, sceneOf } from './testScenes';

// Enough of a context for setScene's capability query; the GPU setup itself is stubbed out.
const context = {
  isContextLost: () => false,
  getParameter: () => 4096,
  getExtension: () => null,
  MAX_TEXTURE_SIZE: 1,
  MAX_ARRAY_TEXTURE_LAYERS: 2,
  RENDERER: 3,
};
const canvas = {
  width: 4,
  height: 4,
  getContext: () => context,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HTMLCanvasElement;

const catcherOf = (tracer: PathTracer): unknown =>
  (tracer as unknown as { loaded: { catcher: unknown } }).loaded.catcher;

describe('SetSceneOptions.catcherBounds', () => {
  beforeEach(() => {
    vi.spyOn(PathTracer.prototype as unknown as { createGpu: () => unknown }, 'createGpu').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the catcher under the given bounds instead of the pose, the same plane for every pose', async () => {
    const tracer = PathTracer.create(canvas);
    const union: SceneBounds = { min: [-1, 0, -1], max: [1, 6, 1], center: [0, 3, 0], radius: 3.3 };
    const key = DEFAULT_LOOK.lights.key.direction;
    const planes: unknown[] = [];
    for (const lift of [0, 2, 4]) {
      const doc = sceneOf([boxMesh([-1, lift, -1], [1, lift + 2, 1])]);
      expect((await tracer.setScene(doc, { catcherBounds: union })).applied).toBe(true);
      planes.push(catcherOf(tracer));
      // Without the option the catcher rides with the pose.
      await tracer.setScene(doc);
      expect(catcherOf(tracer)).toEqual(shadowCatcherPlane(sceneBounds(doc), key, 1));
    }
    expect(planes[0]).toEqual(shadowCatcherPlane(union, key, 1));
    expect(planes[1]).toEqual(planes[0]);
    expect(planes[2]).toEqual(planes[0]);
  });

  it.each([
    [{ min: [0, 0, 0], max: [1, 1] }],
    [{ min: [0, NaN, 0], max: [1, 1, 1] }],
    [{ min: [0, 2, 0], max: [1, 1, 1] }],
    [null],
    ['floor'],
  ])('rejects catcherBounds %j with a RangeError naming it, keeping the scene', async (catcherBounds) => {
    const tracer = PathTracer.create(canvas);
    const doc = sceneOf([boxMesh([0, 0, 0], [1, 1, 1])]);
    await tracer.setScene(doc);
    const before = catcherOf(tracer);
    await expect(tracer.setScene(doc, { catcherBounds: catcherBounds as unknown as SceneBounds })).rejects.toThrow(
      /^catcherBounds/,
    );
    expect(catcherOf(tracer)).toBe(before);
  });
});
