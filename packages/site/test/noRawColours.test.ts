import { tokens } from '@modelshot/brand';
import { describe, expect, it } from 'vitest';
import { indexHtml, siteSources } from './siteSources';

const RAW_COLOUR =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![-\w])(?:white|black)(?![-\w])/gi;

function rawColours(text: string): string[] {
  return text.match(RAW_COLOUR) ?? [];
}

describe('landing page colours come from tokens only', () => {
  const css = siteSources('.css');

  it('has stylesheets to check', () => {
    expect(css.map((f) => f.path)).toEqual(
      expect.arrayContaining(['src/styles/base.css', 'src/styles/components.css', 'src/styles/motion.css']),
    );
  });

  it.each(css.map((f) => [f.path, f.text]))('%s has no raw colour', (_path, text) => {
    expect(rawColours(text)).toEqual([]);
  });

  it('the matcher catches the usual spellings', () => {
    for (const sample of [
      'color: #fff',
      'fill: #2F4BFF;',
      'rgb(0 0 0)',
      'rgba(0,0,0,.5)',
      'hsl(1 2% 3%)',
      'border: 1px solid black',
    ]) {
      expect(rawColours(sample), sample).not.toEqual([]);
    }
    expect(rawColours('white-space: nowrap; color: var(--ms-color-ink); href="#faq"')).toEqual([]);
  });

  it('index.html has no inline styles or colour attributes', () => {
    const html = indexHtml();
    expect(html).not.toMatch(/\sstyle=|<style|\s(?:fill|stroke|color|bgcolor)="/i);
  });

  it('the theme colour is the cloud token, the only colour in index.html', () => {
    const html = indexHtml();
    expect(html).toContain(`<meta name="theme-color" content="${tokens.color.cloud}" />`);
    const colours = html.replace(`content="${tokens.color.cloud}"`, '').match(/["'(\s:]#[\da-f]{3,8}["');\s]/gi);
    expect(colours).toBeNull();
  });
});
