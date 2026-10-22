import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * Gzip bytes the entry chunk and the chunks it imports statically may take (what loads before an export starts):
 * measured 5 839 (2026-10-22, round 2), times 1.25. The workspace packages are external: the app ships the path
 * tracer and the scene format anyway, so this is what importing the export API adds to it. Moves to budgets.json once
 * the budget file is free to edit (MS-41).
 */
const EXPORT_ENTRY_GZIP_MAX = 7299;

/** Strings only an encoder or a muxer holds. */
const ENCODER_MARKERS = ['NETSCAPE2.0', 'acTL', 'fdAT', 'VP8X', 'ANMF', 'ftyp', 'avcC', 'V_VP9', 'VideoFrame('];

const packageRoot = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

interface Chunk {
  readonly type: string;
  readonly isEntry?: boolean;
  readonly fileName: string;
  readonly code?: string;
  readonly imports?: readonly string[];
}

/** The chunk and every chunk it imports statically, transitively. */
function upFront(entry: Chunk, chunks: readonly Chunk[]): Chunk[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Map<string, Chunk>([[entry.fileName, entry]]);
  const queue = [entry];
  for (let chunk = queue.pop(); chunk; chunk = queue.pop()) {
    for (const name of chunk.imports ?? []) {
      const next = byName.get(name);
      if (next && !seen.has(name)) {
        seen.set(name, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
}

describe('export bundle', () => {
  it('keeps the entry chunk small and every encoder in a chunk loaded on demand', async () => {
    const output = (await build({
      configFile: false,
      root: packageRoot,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        reportCompressedSize: false,
        lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
        rolldownOptions: { external: [/^@modelshot\//] },
      },
    })) as { output: Chunk[] } | { output: Chunk[] }[];
    const chunks = (Array.isArray(output) ? output.flatMap((o) => o.output) : output.output).filter(
      (c) => c.type === 'chunk',
    );
    const entry = chunks.find((c) => c.isEntry);
    if (!entry) throw new Error('no entry chunk');
    const loaded = upFront(entry, chunks);
    const code = loaded.map((c) => c.code ?? '').join(';');
    const gzip = await gzipSize(code);
    console.log(`[budget] export entry gzip: measured ${gzip} / max ${EXPORT_ENTRY_GZIP_MAX}`);
    expect(gzip).toBeLessThanOrEqual(EXPORT_ENTRY_GZIP_MAX);
    for (const marker of ENCODER_MARKERS) expect(code, marker).not.toContain(marker);
    const lazy = chunks.filter((c) => !loaded.includes(c)).map((c) => c.code ?? '');
    for (const marker of ENCODER_MARKERS)
      expect(
        lazy.some((c) => c.includes(marker)),
        marker,
      ).toBe(true);
  });
});
