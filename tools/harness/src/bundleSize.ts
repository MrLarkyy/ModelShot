import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const BUNDLE_TARGETS = ['app', 'app-entry', 'embed', 'site', 'site-assets', 'export'] as const;

export type BundleTarget = (typeof BUNDLE_TARGETS)[number];

type FileTarget = Exclude<BundleTarget, 'export' | 'app-entry'>;

const PACKAGE: Record<FileTarget, string> = {
  app: 'app',
  embed: 'embed',
  site: 'site',
  'site-assets': 'site',
};
const EXTENSIONS: Record<FileTarget, string[]> = {
  app: ['.js', '.css'],
  embed: ['.js', '.css'],
  site: ['.js', '.css', '.html'],
  'site-assets': ['.woff2', '.svg'],
};

interface OutputChunk {
  readonly type: string;
  readonly fileName: string;
  readonly isEntry?: boolean;
  readonly code?: string;
  readonly source?: string | Uint8Array;
  readonly imports?: readonly string[];
}

/** The entry chunk and every chunk it imports statically, however deep. */
function staticClosure(entry: OutputChunk, byName: ReadonlyMap<string, OutputChunk>): OutputChunk[] {
  const loaded = new Map([[entry.fileName, entry]]);
  const queue = [entry];
  for (let chunk = queue.pop(); chunk; chunk = queue.pop()) {
    for (const name of chunk.imports ?? []) {
      const next = byName.get(name);
      if (next && !loaded.has(name)) {
        loaded.set(name, next);
        queue.push(next);
      }
    }
  }
  return [...loaded.values()];
}

/**
 * What the app's page loads before anything is opened: index.html, its stylesheet and the entry script with the chunks
 * it imports statically. The path tracer, the export code, the loaders and the workers load on first use and are not
 * counted (the `app` row counts every file).
 */
async function measureAppEntry(): Promise<BundleSize> {
  const output = (await build({
    root: join(REPO_ROOT, 'packages', 'app'),
    logLevel: 'silent',
    build: { write: false, reportCompressedSize: false },
  })) as { output: OutputChunk[] } | { output: OutputChunk[] }[];
  const items = Array.isArray(output) ? output.flatMap((o) => o.output) : output.output;
  const chunks = items.filter((c) => c.type === 'chunk');
  const entry = chunks.find((c) => c.isEntry);
  if (!entry) throw new Error('the app build has no entry chunk');
  const scripts = staticClosure(entry, new Map(chunks.map((c) => [c.fileName, c])));
  const text = (item: OutputChunk): string => item.code ?? String(item.source ?? '');
  const assets = items.filter(
    (c) => c.type === 'asset' && (c.fileName.endsWith('.css') || c.fileName === 'index.html'),
  );
  const files = [...scripts, ...assets];
  const gzipBytes = files.reduce((n, c) => n + gzipSync(Buffer.from(text(c)), { level: 9 }).length, 0);
  return { gzipBytes, files: files.map((c) => c.fileName), sources: files.map(text).join(';') };
}

/**
 * `@modelshot/export` as a library: the entry chunk and the chunks it imports statically, what an app loads before an
 * export starts. The encoders are loaded on demand and not counted; the workspace packages are external (an app ships
 * the path tracer and the scene format anyway), so this is what importing the export API adds.
 */
async function measureExportEntry(): Promise<BundleSize> {
  const output = (await build({
    configFile: false,
    root: join(REPO_ROOT, 'packages', 'export'),
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      reportCompressedSize: false,
      lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
      rolldownOptions: { external: [/^@modelshot\//] },
    },
  })) as { output: OutputChunk[] } | { output: OutputChunk[] }[];
  const chunks = (Array.isArray(output) ? output.flatMap((o) => o.output) : output.output).filter(
    (c) => c.type === 'chunk',
  );
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry);
  if (!entry) throw new Error('the export build has no entry chunk');
  const files = staticClosure(entry, byName);
  const gzipBytes = files.reduce((n, c) => n + gzipSync(Buffer.from(c.code ?? ''), { level: 9 }).length, 0);
  return { gzipBytes, files: files.map((c) => c.fileName), sources: files.map((c) => c.code ?? '').join(';') };
}

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
  if (target === 'export') return measureExportEntry();
  if (target === 'app-entry') return measureAppEntry();
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
