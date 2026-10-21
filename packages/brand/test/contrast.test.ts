import { describe, expect, it } from 'vitest';
import { compositeOver } from '../src/compositeOver';
import { CONTRAST_PAIRS, MIN_CONTRAST } from '../src/contrastPairs';
import { contrastRatio } from '../src/contrastRatio';
import { tokens } from '../src/tokens';

const { color } = tokens;

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio(color.slate, color.slate)).toBe(1);
  });

  // The kit canvas labels its swatches with rounded ratios (18.55 is shown as "18:1").
  it.each([
    ['ink', 'cloud', 16],
    ['slate', 'paper', 7.7],
    ['paper', 'ink', 18],
    ['paper', 'shotBlue', 5.9],
    ['ink', 'flash', 6.5],
    ['ink', 'sun', 13],
  ] as const)('%s on %s matches the kit label %s:1', (fg, bg, label) => {
    expect(Math.abs(contrastRatio(color[fg], color[bg]) - label)).toBeLessThan(0.6);
  });

  it('rejects a colour it cannot read', () => {
    expect(() => contrastRatio('rgb(0 0 0)', '#FFFFFF')).toThrow(/#RRGGBB/);
  });
});

describe('contrast pairs', () => {
  it.each(CONTRAST_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg} (${pair.use})`, pair] as const))(
    '%s meets WCAG AA',
    (_name, pair) => {
      expect(contrastRatio(color[pair.fg], color[pair.bg])).toBeGreaterThanOrEqual(MIN_CONTRAST[pair.use]);
    },
  );

  it('never puts paper text on flash or sun', () => {
    const light = CONTRAST_PAIRS.filter((p) => p.fg === 'paper' && (p.bg === 'flash' || p.bg === 'sun'));
    expect(light).toEqual([]);
    expect(contrastRatio(color.paper, color.flash)).toBeLessThan(MIN_CONTRAST.body);
    expect(contrastRatio(color.paper, color.sun)).toBeLessThan(MIN_CONTRAST.body);
  });

  it('has a focus ring pair for every ground that holds a focusable control', () => {
    const rings = CONTRAST_PAIRS.filter((p) => p.use === 'ring').map((p) => `${p.fg}/${p.bg}`);
    expect(rings).toEqual(expect.arrayContaining(['ink/cloud', 'ink/paper', 'sun/ink', 'sun/shotBlue']));
  });
});

describe('the render sweep', () => {
  it('composites like the browser', () => {
    expect(compositeOver('rgb(255 255 255 / 0.5)', '#000000')).toBe('#808080');
    expect(compositeOver('rgb(0 0 0 / 0)', color.shotBlue)).toBe(color.shotBlue);
    expect(() => compositeOver('#FFFFFF', color.ink)).toThrow(/expected rgb\(r g b \/ a\)/);
  });

  // axe reports text over a gradient as "incomplete", so the peak of the band is checked here.
  it('keeps every text colour on shot blue at AA under its brightest point', () => {
    const peak = compositeOver(tokens.illustration.sweep, color.shotBlue);
    const onBlue = CONTRAST_PAIRS.filter((p) => p.bg === 'shotBlue' && p.use !== 'ring');
    expect(onBlue.map((p) => p.fg)).toContain('paper');
    // The figure quoted in tokens.ts and docs/brand.md.
    expect(contrastRatio(color.paper, peak)).toBeCloseTo(4.74, 2);
    for (const pair of onBlue) {
      expect(contrastRatio(color[pair.fg], peak), pair.where).toBeGreaterThanOrEqual(MIN_CONTRAST[pair.use]);
    }
  });
});
