import { describe, expect, it } from 'vitest';
import { DEFAULT_ALPHA_CUTOFF, resolveMaterialAlpha, texelCoverage, type SceneMaterial } from '../src/index';

const material = (extra: Partial<SceneMaterial> = {}): SceneMaterial => ({ name: 'm', texture: 0, ...extra });

describe('resolveMaterialAlpha', () => {
  it('defaults to opaque with the glTF cutoff 0.5', () => {
    expect(DEFAULT_ALPHA_CUTOFF).toBe(0.5);
    expect(resolveMaterialAlpha(material())).toEqual({ mode: 'opaque', cutoff: 0.5 });
    expect(resolveMaterialAlpha(undefined)).toEqual({ mode: 'opaque', cutoff: 0.5 });
  });

  it.each(['opaque', 'mask', 'blend'] as const)('keeps mode %s and its cutoff', (alphaMode) => {
    expect(resolveMaterialAlpha(material({ alphaMode, alphaCutoff: 0.25 }))).toEqual({ mode: alphaMode, cutoff: 0.25 });
  });

  it('clamps a cutoff outside 0..1 and replaces a non-finite one', () => {
    expect(resolveMaterialAlpha(material({ alphaMode: 'mask', alphaCutoff: 2 })).cutoff).toBe(1);
    expect(resolveMaterialAlpha(material({ alphaMode: 'mask', alphaCutoff: -1 })).cutoff).toBe(0);
    expect(resolveMaterialAlpha(material({ alphaMode: 'mask', alphaCutoff: NaN })).cutoff).toBe(0.5);
  });

  it('treats an unknown mode from an untyped caller as opaque', () => {
    const odd = { alphaMode: 'additive' } as unknown as SceneMaterial;
    expect(resolveMaterialAlpha(odd).mode).toBe('opaque');
  });
});

describe('texelCoverage', () => {
  it('opaque ignores alpha', () => {
    const rule = resolveMaterialAlpha(material());
    expect([0, 0.3, 1].map((a) => texelCoverage(a, rule))).toEqual(['opaque', 'opaque', 'opaque']);
  });

  it('mask: below the cutoff invisible, at and above it opaque', () => {
    const rule = resolveMaterialAlpha(material({ alphaMode: 'mask', alphaCutoff: 0.5 }));
    expect([0, 0.4999, 0.5, 0.7, 1].map((a) => texelCoverage(a, rule))).toEqual([
      'invisible',
      'invisible',
      'opaque',
      'opaque',
      'opaque',
    ]);
  });

  it('blend: below the cutoff invisible, from the cutoff to below 1 partial, 1 opaque', () => {
    const rule = resolveMaterialAlpha(material({ alphaMode: 'blend', alphaCutoff: 0.01 }));
    expect([0, 0.0099, 0.01, 0.5, 254 / 255, 1].map((a) => texelCoverage(a, rule))).toEqual([
      'invisible',
      'invisible',
      'partial',
      'partial',
      'partial',
      'opaque',
    ]);
  });
});
