import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineBrandSvg } from '../src/build/inlineBrandSvg';
import { indexHtml } from './siteSources';

function transform(html: string, slots: Record<string, string>): string {
  const hook = inlineBrandSvg(slots).transformIndexHtml as (html: string) => string;
  return hook(html);
}

describe('inlineBrandSvg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-site-'));
  const mark = join(dir, 'mark.svg');
  writeFileSync(mark, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>\n');

  it('replaces a slot with the committed SVG, without the namespace attribute', () => {
    expect(transform('<span><!-- brand:mark --></span>', { mark })).toBe(
      '<span><svg viewBox="0 0 1 1"><rect/></svg></span>',
    );
  });

  it('refuses a slot it does not know', () => {
    expect(() => transform('<!-- brand:logo -->', { mark })).toThrow(/unknown brand slot "logo"/);
  });

  it('the landing page asks for the mark and the hero island', () => {
    const html = indexHtml();
    expect([...html.matchAll(/<!-- brand:([a-z-]+) -->/g)].map((m) => m[1])).toEqual(['mark', 'hero-island']);
  });
});
