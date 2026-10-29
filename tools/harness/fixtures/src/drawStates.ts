/** The renderer's programs as the draw-state recorder tells them apart (by their active uniforms and outputs). */
export type DrawProgram =
  'opaque' | 'oitAccum' | 'fallback' | 'oitComposite' | 'present' | 'catcher' | 'backdrop' | 'other';

/** GL state at one draw call. */
export interface DrawState {
  readonly program: DrawProgram;
  /** SAMPLE_ALPHA_TO_COVERAGE enabled. */
  readonly alphaToCoverage: boolean;
  /** SAMPLES of the bound draw framebuffer (0: single-sampled). */
  readonly samples: number;
}

function programKind(gl: WebGL2RenderingContext, program: WebGLProgram): DrawProgram {
  const has = (uniform: string): boolean => gl.getUniformLocation(program, uniform) !== null;
  if (has('u_alphaToCoverage')) return 'opaque';
  if (gl.getFragDataLocation(program, 'outAccum') >= 0) return 'oitAccum';
  if (has('u_texture')) return 'fallback';
  if (has('u_accum')) return 'oitComposite';
  // The single-texel present and the present of an exact frame's sample history.
  if (has('u_hdr') || has('u_samples')) return 'present';
  if (has('u_catcherLight')) return 'catcher';
  if (has('u_toneMap')) return 'backdrop';
  return 'other';
}

/**
 * Runs `render` with every drawArrays and drawElements of `gl` recorded: the program, whether alpha-to-coverage is on
 * and the draw framebuffer's sample count. The wrappers are own properties of the context, removed afterwards.
 */
export function recordDrawStates(gl: WebGL2RenderingContext, render: () => void): DrawState[] {
  const states: DrawState[] = [];
  const kinds = new Map<WebGLProgram, DrawProgram>();
  const record = (): void => {
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    let kind: DrawProgram = 'other';
    if (program) {
      kind = kinds.get(program) ?? programKind(gl, program);
      kinds.set(program, kind);
    }
    states.push({
      program: kind,
      alphaToCoverage: gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),
      samples: gl.getParameter(gl.SAMPLES) as number,
    });
  };
  const drawArrays = gl.drawArrays.bind(gl);
  const drawElements = gl.drawElements.bind(gl);
  gl.drawArrays = (...args: Parameters<WebGL2RenderingContext['drawArrays']>): void => {
    record();
    drawArrays(...args);
  };
  gl.drawElements = (...args: Parameters<WebGL2RenderingContext['drawElements']>): void => {
    record();
    drawElements(...args);
  };
  try {
    render();
  } finally {
    const own = gl as Partial<Pick<WebGL2RenderingContext, 'drawArrays' | 'drawElements'>>;
    delete own.drawArrays;
    delete own.drawElements;
  }
  return states;
}
