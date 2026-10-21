import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const brandRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(brandRoot, 'fonts');
const cssPath = join(brandRoot, 'css', 'fonts.css');
const require = createRequire(join(brandRoot, 'package.json'));
const families = readdirSync(fontsDir);

function fontsourceDir(family: string): string {
  return dirname(require.resolve(`@fontsource/${family}/package.json`));
}

describe('self-hosted fonts', () => {
  it('ships the three brand families', () => {
    expect([...families].sort()).toEqual(['ibm-plex-mono', 'manrope', 'unbounded']);
  });

  it.each(families)('fonts/%s holds only woff2 files and OFL.txt', (family) => {
    const names = readdirSync(join(fontsDir, family));
    expect(names).toContain('OFL.txt');
    expect(names.filter((n) => n !== 'OFL.txt').every((n) => n.endsWith('.woff2'))).toBe(true);
    expect(readFileSync(join(fontsDir, family, 'OFL.txt'), 'utf8')).toContain('SIL Open Font License');
  });

  it.each(families)('fonts/%s is byte-identical to the pinned @fontsource package', (family) => {
    const source = fontsourceDir(family);
    for (const name of readdirSync(join(fontsDir, family))) {
      const original = name === 'OFL.txt' ? join(source, 'LICENSE') : join(source, 'files', name);
      expect(readFileSync(join(fontsDir, family, name)).equals(readFileSync(original)), name).toBe(true);
    }
  });

  it('fonts.css points at every committed font file and nothing else', () => {
    const css = readFileSync(cssPath, 'utf8');
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
    const committed = families.flatMap((family) =>
      readdirSync(join(fontsDir, family))
        .filter((n) => n.endsWith('.woff2'))
        .map((n) => join(fontsDir, family, n)),
    );
    const resolved = urls.map((url) => resolve(dirname(cssPath), url));
    expect(resolved.every((path) => existsSync(path))).toBe(true);
    expect(resolved.sort()).toEqual(committed.sort());
  });

  it('fonts.css loads nothing from another origin and blocks instead of swapping', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).not.toMatch(/\/\/|@import/);
    const faces = css.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(6);
    expect(css.match(/font-display: block;/g)).toHaveLength(faces.length);
  });
});
