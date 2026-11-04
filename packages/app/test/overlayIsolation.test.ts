import { describe, expect, it } from 'vitest';
import { appSources } from './appSources';

const IMPORT = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function imports(text: string): string[] {
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? '');
}

describe('overlays cannot reach an image', () => {
  const sources = appSources('.ts');

  it('finds the sources to check', () => {
    expect(sources.some((s) => s.path.startsWith('src/render/'))).toBe(true);
    expect(sources.some((s) => s.path.startsWith('src/viewport/'))).toBe(true);
  });

  it.each(['src/render/', 'src/export/'])('%s never imports the overlay, the timeline or the editor tools', (dir) => {
    const offenders = sources
      .filter((s) => s.path.startsWith(dir))
      .flatMap((s) =>
        imports(s.text)
          .filter((spec) => /(^|\/)(viewport|timeline|editor)(\/|$)/.test(spec))
          .map((spec) => `${s.path} imports ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it('draws the overlay on its own canvas, never on the preview or the result', () => {
    const renderer = sources.find((s) => s.path === 'src/viewport/OverlayRenderer.ts');
    expect(renderer?.text).toContain("getContext('2d')");
    for (const s of sources.filter((f) => f.path.startsWith('src/viewport/') || f.path.startsWith('src/timeline/'))) {
      expect(s.text, s.path).not.toMatch(
        /getElementById\(\s*['"](preview|result)['"]|byId\(\s*['"](preview|result)['"]/,
      );
    }
  });
});
