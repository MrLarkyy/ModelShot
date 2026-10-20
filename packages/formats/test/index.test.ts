import { describe, expect, it } from 'vitest';
import * as formats from '../src/index';

describe('@modelshot/formats', () => {
  it('names itself', () => {
    expect(formats.packageName).toBe('@modelshot/formats');
  });

  it('exports every loader with its error, limits and warning cap', () => {
    expect(typeof formats.loadBbmodel).toBe('function');
    expect(typeof formats.loadGltf).toBe('function');
    expect(typeof formats.loadObj).toBe('function');
    expect(new formats.GltfError('NOT_GLTF', '$', 'x')).toBeInstanceOf(Error);
    expect(new formats.ObjError('LINE_TOO_LONG', 'a.obj:1', 'x')).toBeInstanceOf(Error);
    expect(formats.DEFAULT_GLTF_LIMITS.maxTriangles).toBe(200_000);
    expect(formats.DEFAULT_OBJ_LIMITS.maxFaceVertices).toBe(64);
    expect(formats.MAX_GLTF_WARNINGS).toBe(100);
    expect(formats.MAX_OBJ_WARNINGS).toBe(100);
    expect(formats.DEFAULT_GLTF_UNIT_SCALE).toBe(16);
    expect(formats.DEFAULT_OBJ_UNIT_SCALE).toBe(16);
    expect(formats.BLEND_ALPHA_CUTOFF).toBe(0.5 / 255);
    expect(typeof formats.detectModelFormat).toBe('function');
  });

  it('freezes the default limits', () => {
    expect(Object.isFrozen(formats.DEFAULT_GLTF_LIMITS)).toBe(true);
    expect(Object.isFrozen(formats.DEFAULT_OBJ_LIMITS)).toBe(true);
  });
});
