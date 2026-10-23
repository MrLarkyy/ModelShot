import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

// The app's own sources under src/ with the given extension.
export function appSources(extension: string): SourceFile[] {
  return walk(join(APP_ROOT, 'src'))
    .filter((path) => path.endsWith(extension))
    .map((path) => ({ path: relative(APP_ROOT, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));
}
