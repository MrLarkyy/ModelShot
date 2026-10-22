import { describe, expect, it } from 'vitest';
import {
  MAX_SUPERSAMPLE,
  MAX_SUPERSAMPLED_PIXELS,
  PathTracer,
  PathTracerError,
  packageName,
  supersampledScale,
} from '../src/index';

describe('@modelshot/pathtracer', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/pathtracer');
  });

  it('exports the tracer and its error', () => {
    expect(typeof PathTracer.create).toBe('function');
    const error = new PathTracerError('SCENE_TOO_LARGE', 'too many', 'meshes[0]');
    expect(error.message).toBe('too many (at meshes[0])');
    expect(error.code).toBe('SCENE_TOO_LARGE');
  });

  it('exports the supersampling limits and scale', () => {
    expect(MAX_SUPERSAMPLE).toBe(4);
    expect(MAX_SUPERSAMPLED_PIXELS).toBe(2 ** 22);
    expect(supersampledScale(2, 256, 256, { maxWidth: 4096, maxHeight: 4096 })).toBe(2);
  });
});
