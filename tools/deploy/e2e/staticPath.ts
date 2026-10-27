import { statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export type StaticResolution =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'badRequest' };

function kindOf(path: string): 'file' | 'directory' | null {
  try {
    const info = statSync(path);
    return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

/**
 * Maps a request path to a file under `root`, the site served below `prefix` (`/ModelShot/`) like GitHub Pages: a
 * directory gives its index.html, a directory without the closing slash redirects to it, anything else is 404.
 * Traversal, encoded separators, NUL and malformed percent-encoding are refused (400), never mapped.
 */
export function resolveStaticPath(root: string, prefix: string, rawPath: string): StaticResolution {
  if (rawPath.includes('\0') || /%(?:2f|5c|00)/i.test(rawPath)) return { kind: 'badRequest' };
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return { kind: 'badRequest' };
  }
  if (path.includes('\\') || path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return { kind: 'badRequest' };
  }
  if (path === prefix.slice(0, -1)) return { kind: 'redirect', location: prefix };
  if (!path.startsWith(prefix)) return { kind: 'notFound' };
  const base = resolve(root);
  const target = resolve(join(base, path.slice(prefix.length)));
  if (target !== base && !target.startsWith(base + sep)) return { kind: 'badRequest' };
  const kind = kindOf(target);
  if (kind === 'file') return { kind: 'file', path: target };
  if (kind === 'directory') {
    if (!path.endsWith('/')) return { kind: 'redirect', location: `${rawPath}/` };
    const index = join(target, 'index.html');
    return kindOf(index) === 'file' ? { kind: 'file', path: index } : { kind: 'notFound' };
  }
  return { kind: 'notFound' };
}
