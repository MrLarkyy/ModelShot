import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

// Any absolute or protocol-relative URL, wherever it appears (attributes, CSS, inline script, meta refresh).
const offOrigin = /(?:b[a-z][a-zd+.-]*:)?//[^s"'<>)]*/gi;

function offOriginReferences(html: string): string[] {
  return html.match(offOrigin) ?? [];
}

describe('local-first index.html', () => {
  it('references no off-origin URL', () => {
    expect(offOriginReferences(indexHtml)).toEqual([]);
  });

  it.each([
    ['script src', '<script src="https://cdn.example/x.js"></script>'],
    ['protocol-relative href', '<link href=//fonts.example/a.css>'],
    ['http img', "<img src='http://a.example/i.png'>"],
    ['css import', '<style>@import url(https://fonts.example/a.css);</style>'],
    ['srcset', '<img srcset="/a.png 1x, https://cdn.example/b.png 2x">'],
    ['inline module import', '<script type="module">import x from "https://cdn.example/m.js";</script>'],
    ['websocket', '<script>new WebSocket("wss://t.example");</script>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example/">'],
  ])('the matcher catches %s', (_name, html) => {
    expect(offOriginReferences(html)).not.toEqual([]);
  });

  it('accepts same-origin references', () => {
    expect(offOriginReferences('<script type="module" src="/src/main.ts"></script>')).toEqual([]);
  });
});
