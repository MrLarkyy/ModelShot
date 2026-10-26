import { describe, expect, it } from 'vitest';
import { devWithoutCsp } from '../src/devWithoutCsp';

describe('devWithoutCsp', () => {
  const plugin = devWithoutCsp();

  it('applies to the dev server only, so a build keeps the policy', () => {
    expect(plugin.apply).toBe('serve');
  });

  it('removes the policy meta, wherever its attributes are broken across lines, and keeps the other tags', () => {
    const html = [
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta',
      '    http-equiv="Content-Security-Policy"',
      '    content="default-src \'self\'"',
      '  />',
      '  <title>x</title>',
      '</head>',
    ].join('\n');
    expect(plugin.transformIndexHtml.handler(html)).toBe(
      '<head>\n  <meta charset="utf-8" />\n  <title>x</title>\n</head>',
    );
  });
});
