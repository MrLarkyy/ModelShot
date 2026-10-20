/** Static GLSL chunks by include name, e.g. `{ agx: agxSource }`. */
export type ShaderChunks = Readonly<Record<string, string>>;

const INCLUDE_LINE = /^\s*#\s*include\b/;
const INCLUDE = /^\s*#\s*include\s+"([A-Za-z0-9_./-]+)"\s*$/;
const VERSION_LINE = /^\s*#\s*version\b/;

/**
 * Replaces every `#include "name"` line of `source` by the chunk `chunks[name]`, recursively and depth first. A chunk
 * included more than once is emitted only the first time. An unknown name, a malformed include, a cycle, a `#version`
 * inside a chunk or a `#version` that is not the first line of `source` throws. Only static sources go in here, never
 * text derived from user input.
 */
export function linkShader(source: string, chunks: ShaderChunks): string {
  const lines = source.split(/\r?\n/);
  const versionAt = lines.findIndex((line) => VERSION_LINE.test(line));
  if (versionAt > 0) throw new Error(`#version must be the first line of a shader, found on line ${versionAt + 1}`);

  const emitted = new Set<string>();
  const out: string[] = [];
  const expand = (text: string, stack: readonly string[]): void => {
    for (const line of text.split(/\r?\n/)) {
      if (!INCLUDE_LINE.test(line)) {
        out.push(line);
        continue;
      }
      const name = INCLUDE.exec(line)?.[1];
      const where = stack.length > 0 ? ` in chunk "${stack[stack.length - 1]}"` : '';
      if (name === undefined) throw new Error(`malformed shader include${where}: ${line.trim()}`);
      if (stack.includes(name)) throw new Error(`shader include cycle: ${[...stack, name].join(' -> ')}`);
      const chunk = Object.hasOwn(chunks, name) ? chunks[name] : undefined;
      if (chunk === undefined) throw new Error(`unknown shader include "${name}"${where}`);
      if (emitted.has(name)) continue;
      if (chunk.split(/\r?\n/).some((chunkLine) => VERSION_LINE.test(chunkLine))) {
        throw new Error(`shader chunk "${name}" must not contain #version`);
      }
      emitted.add(name);
      expand(chunk, [...stack, name]);
    }
  };
  expand(source, []);
  return out.join('\n');
}
