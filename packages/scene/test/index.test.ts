import { describe, expect, it } from 'vitest';
import * as scene from '../src/index';

describe('@modelshot/scene', () => {
  it('names itself', () => {
    expect(scene.packageName).toBe('@modelshot/scene');
  });

  it('exports the material alpha rule', () => {
    expect(typeof scene.resolveMaterialAlpha).toBe('function');
    expect(typeof scene.texelCoverage).toBe('function');
    expect(scene.DEFAULT_ALPHA_CUTOFF).toBe(0.5);
  });
});
