import { describe, expect, it } from 'vitest';
import { PathTracer } from '../src/PathTracer';

// The constructor checks the options before it touches the context, so a bare stub canvas is enough.
const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;

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
});
