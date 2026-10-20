import { describe, expect, it } from 'vitest';
import { assertSampleCount } from '../src/sampleCount';

describe('assertSampleCount', () => {
  it('accepts the requested count', () => {
    expect(() => assertSampleCount(64, 64)).not.toThrow();
  });

  it('rejects an off-by-one accumulation in either direction', () => {
    expect(() => assertSampleCount(64, 63)).toThrow(/accumulated 63 samples, the spec asks for 64/);
    expect(() => assertSampleCount(64, 65)).toThrow(/accumulated 65 samples/);
  });
});
