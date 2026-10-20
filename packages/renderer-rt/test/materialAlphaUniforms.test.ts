import {
  ALPHA_MODE_ID,
  COVERAGE_INVISIBLE,
  COVERAGE_OPAQUE,
  COVERAGE_PARTIAL,
  alphaCutoffByte,
  texelCoverageByte,
} from '@modelshot/looks';
import { resolveMaterialAlpha, texelCoverage, type SceneAlphaMode } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { alphaLevelsOf, hasPartialCoverage } from '../src/textureUpload';

const COVERAGE_BY_NAME = { invisible: COVERAGE_INVISIBLE, partial: COVERAGE_PARTIAL, opaque: COVERAGE_OPAQUE } as const;
const MODES: SceneAlphaMode[] = ['opaque', 'mask', 'blend'];
const CUTOFFS = [0, 0.5 / 255, 0.01, 0.5, 128 / 255, 1, NaN, -1, 2];

describe('byte coverage of the shaders', () => {
  it('equals the scene texelCoverage for every alpha byte, mode and cutoff', () => {
    for (const alphaMode of MODES) {
      for (const alphaCutoff of CUTOFFS) {
        const rule = resolveMaterialAlpha({ alphaMode, alphaCutoff });
        const cutoffByte = alphaCutoffByte(rule.cutoff);
        for (let k = 0; k <= 255; k++) {
          const expected = COVERAGE_BY_NAME[texelCoverage(k / 255, rule)];
          expect(texelCoverageByte(k, ALPHA_MODE_ID[rule.mode], cutoffByte), `${alphaMode} ${alphaCutoff} ${k}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it('a texture is partial under a rule only if one of its alpha bytes is', () => {
    const levels = alphaLevelsOf(new Uint8Array([9, 9, 9, 0, 9, 9, 9, 2, 9, 9, 9, 255]));
    expect(hasPartialCoverage(levels, ALPHA_MODE_ID.blend, alphaCutoffByte(0.5 / 255))).toBe(true);
    expect(hasPartialCoverage(levels, ALPHA_MODE_ID.blend, alphaCutoffByte(0.01))).toBe(false);
    expect(hasPartialCoverage(levels, ALPHA_MODE_ID.mask, alphaCutoffByte(0.5 / 255))).toBe(false);
    expect(hasPartialCoverage(levels, ALPHA_MODE_ID.opaque, 0)).toBe(false);
  });
});
