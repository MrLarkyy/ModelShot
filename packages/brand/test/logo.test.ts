import { describe, expect, it } from 'vitest';
import { heroIslandSvg, HERO_ISLAND_LABEL } from '../src/illustration/heroIslandSvg';
import { MARK_VARIANTS, markSvg, type MarkVariant } from '../src/logo/markSvg';
import { tokens } from '../src/tokens';

const FILES: Record<MarkVariant, string> = {
  primary: 'mark.svg',
  inverse: 'mark-inverse.svg',
  mono: 'mark-mono.svg',
  favicon16: 'favicon-16.svg',
  favicon32: 'favicon-32.svg',
  appIcon: 'app-icon.svg',
};

const brandColours = new Set<string>(Object.values(tokens.color));

function fills(svg: string): string[] {
  return [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]!);
}

function expectCleanSvg(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toMatch(/viewBox="[\d\s.-]+"/);
  expect(svg).not.toMatch(/<text|<metadata|<!--|<\?xml|sodipodi|inkscape|<script|<image|href="http|style=/);
}

describe('logo SVGs', () => {
  it.each(MARK_VARIANTS)('%s is generated into assets/logo', async (variant) => {
    await expect(markSvg(variant)).toMatchFileSnapshot(`../assets/logo/${FILES[variant]}`);
  });

  it.each(MARK_VARIANTS)('%s is small, clean and on the 132 grid', (variant) => {
    const svg = markSvg(variant);
    expect(new TextEncoder().encode(svg).length).toBeLessThanOrEqual(1024);
    expectCleanSvg(svg);
    expect(svg).toContain('viewBox="0 0 132 132"');
  });

  it.each(MARK_VARIANTS.filter((v) => v !== 'mono'))('%s uses brand colours only', (variant) => {
    const used = fills(markSvg(variant));
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(brandColours.has(colour), colour).toBe(true);
  });

  it('drops the flash dot only at 16 px', () => {
    expect(markSvg('favicon16')).not.toContain(tokens.color.flash);
    for (const variant of ['primary', 'inverse', 'favicon32', 'appIcon'] as const) {
      expect(markSvg(variant)).toContain(tokens.color.flash);
    }
    expect(markSvg('favicon32')).toContain('r="14"');
    expect(markSvg('primary')).toContain('r="12"');
  });

  it('inverse puts a paper tile behind a blue cube', () => {
    expect(markSvg('inverse')).toMatch(new RegExp(`^<svg[^>]*><rect[^>]*fill="${tokens.color.paper}"`));
  });

  it('app icon is full bleed', () => {
    expect(markSvg('appIcon')).not.toContain('rx=');
  });

  it('mono is one currentColor shape with knocked-out faces and a ringed dot', () => {
    const svg = markSvg('mono');
    expect(fills(svg)).toEqual(['currentColor']);
    expect(svg).toContain('fill-rule="evenodd"');
    // tile, three faces, ring, dot
    expect(svg.match(/Z/g)).toHaveLength(6);
  });
});

describe('hero island illustration', () => {
  it('is generated into assets/illustrations', async () => {
    await expect(heroIslandSvg()).toMatchFileSnapshot('../assets/illustrations/hero-island.svg');
  });

  it('takes every colour from illustration.css classes', () => {
    const svg = heroIslandSvg();
    expectCleanSvg(svg);
    expect(svg).not.toMatch(/#[\da-f]{3,6}\b/i);
    expect(svg.match(/<g class="isl-/g)).toHaveLength(18);
  });

  it('says it is an illustration, not a render', () => {
    expect(heroIslandSvg()).toContain(`role="img" aria-label="${HERO_ISLAND_LABEL}"`);
    expect(HERO_ISLAND_LABEL).toMatch(/^Illustration, not a render/);
  });
});
