const VERSION = '#version 300 es';
const DEFINE_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A constant shared by TypeScript and GLSL; the type picks the GLSL literal (ES 3.00 has no implicit conversion). */
export type ShaderDefine = { readonly int: number } | { readonly float: number };

/**
 * Joins a stage shader with its includes: the stage's `#version` line, then one `#define` per entry of `defines`, then
 * the includes in the given order, then the rest of the stage. Only static `.glsl` files imported with `?raw` and
 * numeric constants from the fixture's own code are joined, never text from a model or a URL.
 */
export function buildShader(
  stage: string,
  includes: readonly string[],
  defines: Readonly<Record<string, ShaderDefine>> = {},
): string {
  const newline = stage.indexOf('\n');
  const first = (newline < 0 ? stage : stage.slice(0, newline)).trim();
  if (first !== VERSION) throw new Error(`a stage shader must start with "${VERSION}"`);
  if (includes.some((include) => /^\s*#version/m.test(include))) {
    throw new Error('an include must not declare #version');
  }
  const defineLines = Object.entries(defines).map(([name, define]) => `#define ${name} ${literal(name, define)}`);
  return [VERSION, ...defineLines, ...includes, newline < 0 ? '' : stage.slice(newline + 1)].join('\n');
}

function literal(name: string, define: ShaderDefine): string {
  if (!DEFINE_NAME.test(name)) throw new Error(`define name "${name}" must match ${String(DEFINE_NAME)}`);
  if ('int' in define) {
    if (!Number.isSafeInteger(define.int)) throw new Error(`define ${name} must be an integer`);
    return String(define.int);
  }
  if (!Number.isFinite(define.float)) throw new Error(`define ${name} must be a finite number`);
  return Number.isInteger(define.float) ? define.float.toFixed(1) : String(define.float);
}
