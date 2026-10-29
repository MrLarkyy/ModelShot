/** One recorded WebGL call. */
export interface GlCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface StubGlOptions {
  /** Whether a shader of this source compiles; default every one. */
  readonly compiles?: (source: string) => boolean;
  /** Whether the context is lost now; default never. */
  readonly lost?: () => boolean;
  /** Called with each call as it is recorded. */
  readonly onCall?: (call: GlCall) => void;
}

/**
 * A WebGL2 context that records every call and does nothing: each constant (an upper-case name) is a distinct number,
 * `create*` returns a fresh object, shaders compile as `options.compiles` says, programs link, framebuffers are
 * complete and the context is lost as `options.lost` says (default never). Enough for the resource and program code,
 * never for drawing.
 */
export function stubGl(options: StubGlOptions = {}): { gl: WebGL2RenderingContext; calls: GlCall[] } {
  const calls: GlCall[] = [];
  const constants = new Map<string, number>();
  const sources = new Map<unknown, string>();
  const constant = (name: string): number => {
    if (!constants.has(name)) constants.set(name, 0x10000 + constants.size);
    return constants.get(name) as number;
  };
  const results: Record<string, (...args: unknown[]) => unknown> = {
    shaderSource: (shader, source) => sources.set(shader, String(source)),
    getShaderParameter: (shader) => (options.compiles ?? (() => true))(sources.get(shader) ?? ''),
    getProgramParameter: () => true,
    getShaderInfoLog: () => 'stub compile log',
    getProgramInfoLog: () => '',
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    isContextLost: () => options.lost?.() ?? false,
    getUniformLocation: () => ({}),
  };
  const gl = new Proxy(
    {},
    {
      get: (_, property) => {
        if (typeof property !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
        return (...args: unknown[]) => {
          const call = { name: property, args };
          calls.push(call);
          options.onCall?.(call);
          if (property.startsWith('create')) return { created: property };
          return results[property]?.(...args);
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls };
}

/**
 * Records what the 2D data textures hold: `onCall` is fed each stub call; `texStorage2D` sizes the bound handle and
 * `texSubImage2D` copies its data at call time (the caller's array is mutated later), so equal contents mean equal bytes.
 */
export function dataTextureRecorder(rowFloats = 2048 * 4) {
  const contents = new Map<unknown, Float32Array>();
  let bound: unknown = null;
  const onCall = (call: GlCall): void => {
    const a = call.args;
    if (call.name === 'bindTexture') bound = a[1];
    else if (call.name === 'texStorage2D') contents.set(bound, new Float32Array(Number(a[4]) * rowFloats));
    else if (call.name === 'texSubImage2D') {
      contents.get(bound)?.set(Float32Array.from(a[8] as Float32Array), Number(a[3]) * rowFloats);
    }
  };
  return { contents, onCall };
}
