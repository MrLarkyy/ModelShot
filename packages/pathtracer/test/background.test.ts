import { DEFAULT_LOOK, MAX_LOOK_COLOR, checkLookPreset } from '@modelshot/looks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathTracer } from '../src/PathTracer';

// The constructor checks the options before it touches the context, so a bare stub canvas is enough.
const canvas = {
  getContext: () => ({}),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HTMLCanvasElement;

describe('PathTracer background option', () => {
  it.each([[[NaN, 0, 0]], [[0, Infinity, 0]], [[0, 0, -0.1]], [[0, 0, 16.5]], [[0, 0]], [[1, 1, 1, 1]]])(
    'rejects %j with a RangeError naming background',
    (background) => {
      expect(() => PathTracer.create(canvas, { background: background as [number, number, number] })).toThrow(
        /^background must be/,
      );
      expect(() => PathTracer.create(canvas, { background: background as [number, number, number] })).toThrow(
        RangeError,
      );
    },
  );

  describe('with the GPU setup stubbed', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('hands out a background at the limit as a look checkLookPreset and a second PathTracer accept', () => {
      vi.spyOn(PathTracer.prototype as unknown as { createGpu: () => unknown }, 'createGpu').mockReturnValue(null);
      const tracer = PathTracer.create(canvas, { background: [MAX_LOOK_COLOR, 0, 0] });
      expect(tracer.look.backdrop).toEqual({ top: [MAX_LOOK_COLOR, 0, 0], bottom: [MAX_LOOK_COLOR, 0, 0] });
      expect(checkLookPreset(tracer.look)).toEqual(tracer.look);
      expect(PathTracer.create(canvas, { look: tracer.look }).look).toEqual(tracer.look);
      expect(PathTracer.create(canvas, { look: tracer.look }).look).not.toEqual(DEFAULT_LOOK);
    });
  });
});
