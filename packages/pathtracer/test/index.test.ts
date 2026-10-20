import { describe, expect, it } from 'vitest';
import { PathTracer, PathTracerError, packageName } from '../src/index';

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
});
