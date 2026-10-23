import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathTracer } from '../src/PathTracer';

const canvas = {
  width: 4,
  height: 4,
  getContext: () => ({ isContextLost: () => false }),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HTMLCanvasElement;

describe('PathTracer transparent requests', () => {
  beforeEach(() => {
    vi.spyOn(PathTracer.prototype as unknown as { createGpu: () => unknown }, 'createGpu').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([['yes'], [1], [0], [null], [{}]])('rejects transparent: %j with a RangeError naming it', (transparent) => {
    const tracer = PathTracer.create(canvas);
    expect(() => tracer.start({ seed: 1, samples: 4, transparent: transparent as boolean })).toThrow(
      /^transparent must be a boolean/,
    );
    expect(() => tracer.start({ seed: 1, samples: 4, transparent: transparent as boolean })).toThrow(RangeError);
    expect(tracer.targetSamples).toBe(0);
  });

  it('accepts true, false and the field left out', () => {
    const tracer = PathTracer.create(canvas);
    for (const request of [{ transparent: true }, { transparent: false }, {}]) {
      expect(() => tracer.start({ seed: 1, samples: 4, ...request })).not.toThrow();
    }
  });

  it('reads no image before a sample, without a context and after dispose', () => {
    const tracer = PathTracer.create(canvas);
    expect(tracer.readImage()).toBeNull();
    tracer.start({ seed: 1, samples: 4, transparent: true });
    expect(tracer.step(4)).toBe(0);
    expect(tracer.readImage()).toBeNull();
    tracer.dispose();
    expect(tracer.readImage()).toBeNull();
  });

  it('reports the context lost from the moment it is, before its event', () => {
    let lost = false;
    const lossy = { ...canvas, getContext: () => ({ isContextLost: () => lost }) } as unknown as HTMLCanvasElement;
    const tracer = PathTracer.create(lossy);
    expect(tracer.contextLost).toBe(false);
    lost = true;
    expect(tracer.contextLost).toBe(true);
    expect(tracer.readImage()).toBeNull();
  });
});
