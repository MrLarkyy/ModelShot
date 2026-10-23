import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { serviceWorkerSource } from './sw.template.ts';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** The files the worker precaches: the page itself (also at the folder's own URL), the build's, the public ones. */
export function precacheList(bundleFiles: readonly string[], publicFiles: readonly string[]): string[] {
  const own = [...bundleFiles, ...publicFiles].filter((file) => file !== 'sw.js' && !file.startsWith('social-'));
  return [...new Set(['./', ...own])].sort();
}

export function buildVersion(contents: readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256');
  for (const part of contents) hash.update(part);
  return hash.digest('hex').slice(0, 16);
}

// Emits sw.js next to index.html with the list and version of the build it belongs to.
export function swPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'modelshot-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.build.copyPublicDir && config.publicDir ? config.publicDir : '';
    },
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle);
      const publicPaths = publicDir && existsSync(publicDir) ? listFiles(publicDir) : [];
      const publicFiles = publicPaths.map((path) => relative(publicDir, path).replaceAll(sep, '/'));
      const contents = [
        ...bundleFiles.sort().flatMap((name) => {
          const item = bundle[name];
          if (!item) return [];
          return [name, item.type === 'chunk' ? item.code : item.source];
        }),
        ...publicPaths.sort().flatMap((path, i) => [publicFiles[i] ?? '', readFileSync(path)]),
      ];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource({
          version: buildVersion(contents),
          files: precacheList(bundleFiles, publicFiles),
        }),
      });
    },
  };
}
