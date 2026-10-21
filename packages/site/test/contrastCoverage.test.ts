import { CONTRAST_PAIRS, type ColorRole } from '@modelshot/brand';
import { describe, expect, it } from 'vitest';
import { siteSources } from './siteSources';

function role(cssName: string): ColorRole {
  return cssName.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()) as ColorRole;
}

// Rules that set both a text colour and a ground. Inherited pairs are checked on the rendered page instead
// (e2e/landing.a11y.spec.ts).
function declaredPairs(css: string): { fg: ColorRole; bg: ColorRole; rule: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => {
    const fg = /(?:^|[;\s])color:\s*var\(--ms-color-([a-z-]+)\)/.exec(body!);
    const bg = /background(?:-color)?:\s*var\(--ms-color-([a-z-]+)\)/.exec(body!);
    return fg && bg ? [{ fg: role(fg[1]!), bg: role(bg[1]!), rule: selector!.trim() }] : [];
  });
}

describe('contrast pairs cover the landing page stylesheets', () => {
  const pairs = siteSources('.css').flatMap((file) => declaredPairs(file.text));

  it('finds the coloured rules', () => {
    expect(pairs.length).toBeGreaterThan(8);
  });

  it.each(pairs.map((p) => [`${p.rule}: ${p.fg} on ${p.bg}`, p] as const))('%s is a checked pair', (_name, pair) => {
    const listed = CONTRAST_PAIRS.some((p) => p.fg === pair.fg && p.bg === pair.bg && p.use !== 'ring');
    expect(listed).toBe(true);
  });
});
