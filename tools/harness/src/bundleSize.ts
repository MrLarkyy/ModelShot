import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const BUNDLE_TARGETS = ['app', 'embed', 'site', 'site-assets'] as const;

export type BundleTarget = (typeof BUNDLE_TARGETS)[number];

const PACKAGE: Record<BundleTarget, string> = { app: 'app', embed: 'embed', site: 'site', 'site-assets': 'site' };
const EXTENSIONS: Record<BundleTarget, string[]> = {
  app: ['.js', '.css'],
  embed: ['.js', '.css'],
  site: ['.js', '.css', '.html'],
  'site-assets': ['.woff2', '.svg'],
};

export interface BundleSize {
  gzipBytes: number;
  files: string[];
  sources: string;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export async function measureBundle(target: BundleTarget): Promise<BundleSize> {
  const outDir = mkdtempSync(join(tmpdir(), `modelshot-bundle-${target}-`));
  try {
    await build({
      root: join(REPO_ROOT, 'packages', PACKAGE[target]),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, write: true, reportCompressedSize: false },
    });
    const assets = listFiles(outDir).filter((f) => EXTENSIONS[target].includes(extname(f)));
    let gzipBytes = 0;
    let sources = '';
    for (const file of assets) {
      const data = readFileSync(file);
      gzipBytes += gzipSync(data, { level: 9 }).length;
      sources += data.toString('utf8');
    }
    return { gzipBytes, files: assets.map((f) => f.slice(outDir.length + 1)), sources };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
