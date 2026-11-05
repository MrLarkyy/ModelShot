import { describe, expect, it } from 'vitest';
import { decodeRadianceHdr } from '@modelshot/formats';
import { softboxStudioHdr, softboxStudioSh } from '../scripts/softboxStudioHdr.mjs';
import { ENVIRONMENT_IMAGE_IDS } from '../src/environmentImageIds';
import { BUNDLED_ENVIRONMENT_IMAGES, environmentImageBytes } from '../src/environmentImages';
import licence from '../src/environments/LICENSE?raw';
import shText from '../src/environments/softbox-studio.sh.json?raw';

/** Equal bytes, without a per-element diff of 23 KB on failure. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

describe('the bundled environment image softbox-studio', () => {
  it('the inlined file is its generator output byte for byte', () => {
    const committed = environmentImageBytes('softbox-studio');
    const generated = softboxStudioHdr();
    expect(committed.length).toBe(generated.length);
    expect(sameBytes(committed, generated)).toBe(true);
  });

  it('the committed preview harmonics are the generator output, text for text', () => {
    expect(shText).toBe(`${JSON.stringify(softboxStudioSh())}
`);
  });

  it('every bundled id is one the format accepts, and nothing else resolves', () => {
    expect([...BUNDLED_ENVIRONMENT_IMAGES]).toEqual([...ENVIRONMENT_IMAGE_IDS]);
    expect(() => environmentImageBytes('https://example.com/a.hdr')).toThrow(RangeError);
    expect(() => environmentImageBytes('constructor')).toThrow(RangeError);
  });

  it('decodes to 32 x 16 under the default limits, every pixel at least 0.02', () => {
    const image = decodeRadianceHdr(environmentImageBytes('softbox-studio'));
    expect([image.width, image.height]).toEqual([32, 16]);
    expect(image.rgb.reduce((a, b) => Math.min(a, b), Infinity)).toBeGreaterThanOrEqual(0.02);
  });

  it('has its CC0-1.0 licence in the same directory', () => {
    expect(licence).toContain('softbox-studio.hdr');
    expect(licence).toContain('softbox-studio.sh.json');
    expect(licence).toContain('CC0-1.0');
    expect(licence).toContain('node packages/looks/scripts/softboxStudioHdr.mjs');
  });
});
