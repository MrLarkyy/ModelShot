/**
 * A WebGL2 context that draws nothing and records every call, for tests of what the renderer asks the GPU to do.
 * Constants are distinct numbers, `create*` returns a fresh object, shaders compile, framebuffers are complete, and
 * no extension exists (the renderer takes its no-float path).
 */
export interface FakeWebGl {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  /** Arguments of every call of `name`, in order. */
  calls(name: string): unknown[][];
  /** How many calls of any of `names`. */
  count(...names: string[]): number;
  /** Runs the canvas listeners registered for `type` (a context loss or restore). */
  fire(type: string): void;
}

export function fakeWebGl(): FakeWebGl {
  const log = new Map<string, unknown[][]>();
  const constants = new Map<string, number>();
  const constant = (name: string): number => {
    let value = constants.get(name);
    if (value === undefined) {
      value = 0x1000 + constants.size;
      constants.set(name, value);
    }
    return value;
  };
  const results: Readonly<Record<string, (...args: unknown[]) => unknown>> = {
    getExtension: () => null,
    getParameter: () => null,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    isContextLost: () => false,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    getUniformLocation: (_program, name) => ({ name }),
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
  };
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const gl = new Proxy(
    {},
    {
      get(_target, property) {
        // Never a thenable, so `await` or a matcher never mistakes it for a promise.
        if (typeof property !== 'string' || property === 'then') return undefined;
        if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
        return (...args: unknown[]): unknown => {
          const list = log.get(property);
          if (list) list.push(args);
          else log.set(property, [args]);
          const result = results[property];
          if (result) return result(...args);
          return property.startsWith('create') ? { created: property } : undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  const canvas = {
    width: 64,
    height: 64,
    getContext: (kind: string) => (kind === 'webgl2' ? gl : null),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as HTMLCanvasElement;
  return {
    gl,
    canvas,
    calls: (name) => log.get(name) ?? [],
    count: (...names) => names.reduce((sum, name) => sum + (log.get(name)?.length ?? 0), 0),
    fire: (type) => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ preventDefault: () => undefined } as Event);
    },
  };
}
