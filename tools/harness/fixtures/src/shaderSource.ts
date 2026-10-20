const VERSION = '#version 300 es';

/**
 * Joins a stage shader with its includes: the stage's `#version` line, then the includes in the given order, then the
 * rest of the stage. Only static `.glsl` files imported with `?raw` are joined, never text from a model or a URL.
 */
export function buildShader(stage: string, includes: readonly string[]): string {
  const newline = stage.indexOf('\n');
  const first = (newline < 0 ? stage : stage.slice(0, newline)).trim();
  if (first !== VERSION) throw new Error(`a stage shader must start with "${VERSION}"`);
  if (includes.some((include) => /^\s*#version/m.test(include))) {
    throw new Error('an include must not declare #version');
  }
  return [VERSION, ...includes, newline < 0 ? '' : stage.slice(newline + 1)].join('\n');
}
