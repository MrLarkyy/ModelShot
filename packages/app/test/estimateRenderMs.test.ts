import { describe, expect, it } from 'vitest';
import { estimateRenderMs, estimateText } from '../src/render/estimateRenderMs';
import { samplesNote } from '../src/render/samplesNote';

const last = { samples: 100, pixels: 1000, ms: 10_000 };

describe('estimateRenderMs', () => {
  it('is null before a render finished or for a timing that cannot scale', () => {
    expect(estimateRenderMs(null, { samples: 10, pixels: 10 })).toBeNull();
    expect(estimateRenderMs({ ...last, ms: 0 }, { samples: 10, pixels: 10 })).toBeNull();
    expect(estimateRenderMs({ ...last, pixels: 0 }, { samples: 10, pixels: 10 })).toBeNull();
    expect(estimateRenderMs(last, { samples: 0, pixels: 10 })).toBeNull();
  });

  it('scales with samples and with pixels', () => {
    expect(estimateRenderMs(last, last)).toBe(10_000);
    expect(estimateRenderMs(last, { samples: 200, pixels: 1000 })).toBe(20_000);
    expect(estimateRenderMs(last, { samples: 100, pixels: 4000 })).toBe(40_000);
  });

  it('labels the estimate and says when there is none', () => {
    expect(estimateText(null)).toBe('No estimate before the first render.');
    expect(estimateText(12_000)).toBe('About 0:12, estimated from your last render.');
  });
});

describe('samplesNote', () => {
  it('names both defaults and why they differ', () => {
    expect(samplesNote()).toContain('Render uses 256 samples');
    expect(samplesNote()).toContain('Export uses 64 per frame because clips render many frames');
  });
});
