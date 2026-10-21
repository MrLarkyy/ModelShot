import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

// Page sources under src/ (build-time code in src/build is not shipped to the browser) with the given extension.
export function siteSources(extension: string): SourceFile[] {
  return walk(join(SITE_ROOT, 'src'))
    .filter(
      (path) => path.endsWith(extension) && !relative(SITE_ROOT, path).replaceAll('\\', '/').startsWith('src/build/'),
    )
    .map((path) => ({ path: relative(SITE_ROOT, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));
}

export function indexHtml(): string {
  return readFileSync(join(SITE_ROOT, 'index.html'), 'utf8');
}
