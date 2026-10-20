import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

const offOrigin = /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//gi;

function offOriginReferences(html: string): string[] {
  return html.match(offOrigin) ?? [];
}

describe('local-first index.html', () => {
  it('references no off-origin URL', () => {
    expect(offOriginReferences(indexHtml)).toEqual([]);
  });

  it('the matcher catches CDN, protocol-relative and http references', () => {
    expect(offOriginReferences('<script src="https://cdn.example/x.js"></script>')).toHaveLength(1);
    expect(offOriginReferences('<link href=//fonts.example/a.css>')).toHaveLength(1);
    expect(offOriginReferences("<img src='http://a.example/i.png'>")).toHaveLength(1);
    expect(offOriginReferences('<script type="module" src="/src/main.ts"></script>')).toEqual([]);
  });
});
