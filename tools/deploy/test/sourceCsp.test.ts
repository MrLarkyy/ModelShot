import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages');

// The policy is in the source pages, so every suite of every package runs under it, not only the deploy one.
describe.each(['app', 'site', 'embed'])('%s index.html', (name) => {
  const html = readFileSync(join(PACKAGES, name, 'index.html'), 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

  it('carries the Content-Security-Policy meta before any script, link or style', () => {
    const meta = head.search(/http-equiv="Content-Security-Policy"/);
    expect(meta).toBeGreaterThan(-1);
    const first = head.search(/<(?:script|link|style)\b/);
    expect(first === -1 || first > meta).toBe(true);
    expect(head.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it("starts from default-src 'self' and never allows inline code", () => {
    const policy = /content="([^"]*)"/.exec(head.slice(head.search(/http-equiv="Content-Security-Policy"/)))?.[1] ?? '';
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toMatch(/unsafe-|\*/);
  });
});
