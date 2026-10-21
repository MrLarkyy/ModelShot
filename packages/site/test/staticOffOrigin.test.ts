import { describe, expect, it } from 'vitest';
import { indexHtml, siteSources } from './siteSources';

// Any absolute or protocol-relative URL (the app's localFirst matcher). Scripts are checked for URLs with a scheme
// or quoted protocol-relative ones, since a comment also starts with //.
const IN_MARKUP = /(?:\b[a-z][a-z\d+.-]*:)?\/\/[^\s"'<>)]*/gi;
const IN_SCRIPT = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'`<>)]*|["'`]\/\/[^\s"'`]*/gi;

// Links the user follows on purpose; a link is not a request until clicked.
const ALLOWED_LINK = /^<a [^>]*href="https:\/\/github\.com\/MrLarkyy\/ModelShot(?:\/[^"]*)?"/;

function linksOffOrigin(html: string): string[] {
  return [...html.matchAll(/<[^>]+>/g)]
    .map((m) => m[0])
    .filter((tag) => (tag.match(IN_MARKUP) ?? []).length > 0)
    .filter((tag) => !ALLOWED_LINK.test(tag));
}

describe('the landing page source references no other origin', () => {
  it('index.html links only to the source repository', () => {
    expect(linksOffOrigin(indexHtml())).toEqual([]);
    expect(indexHtml()).toContain('href="https://github.com/MrLarkyy/ModelShot"');
  });

  it.each(siteSources('.css').map((f) => [f.path, f.text]))('%s has no URL off the page', (_path, text) => {
    expect(text.match(IN_MARKUP) ?? []).toEqual([]);
    expect(text).not.toMatch(/@import/);
  });

  it.each(siteSources('.ts').map((f) => [f.path, f.text]))('%s has no URL off the page', (_path, text) => {
    expect(text.match(IN_SCRIPT) ?? []).toEqual([]);
    expect(text).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
  });

  it.each([
    ['script src', '<script src="https://cdn.example/x.js"></script>'],
    ['font stylesheet', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope">'],
    ['protocol-relative', '<img src="//cdn.example/a.png">'],
    ['link to another site', '<a href="https://evil.example/">x</a>'],
  ])('flags a %s', (_name, html) => {
    expect(linksOffOrigin(html)).not.toEqual([]);
  });

  it('flags URLs in scripts but not comments', () => {
    expect('fetch("https://t.example/a")'.match(IN_SCRIPT)).not.toBeNull();
    expect("import('//cdn.example/m.js')".match(IN_SCRIPT)).not.toBeNull();
    expect('// a comment'.match(IN_SCRIPT)).toBeNull();
  });
});
