import { createGlProgram } from './glProgram';
import { shaderProgramSource, type ShaderProgramName } from './shaderSources';

export interface MeshProgram {
  readonly program: WebGLProgram;
  readonly model: WebGLUniformLocation | null;
  readonly viewProjection: WebGLUniformLocation | null;
  readonly texture: WebGLUniformLocation | null;
  readonly texelAntialias: WebGLUniformLocation | null;
}

export interface FullscreenProgram {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

/** The programs of one path: float (opaque, OIT, composite, present) or no-float (fallback, backdrop). */
export interface RendererPrograms {
  readonly meshPasses: Readonly<Partial<Record<'opaque' | 'oitAccum' | 'fallback', MeshProgram>>>;
  readonly fullscreen: Readonly<Partial<Record<'oitComposite' | 'present' | 'backdrop', FullscreenProgram>>>;
  readonly all: readonly WebGLProgram[];
}

const FULLSCREEN_UNIFORMS: Readonly<Record<'oitComposite' | 'present' | 'backdrop', readonly string[]>> = {
  oitComposite: ['u_accum', 'u_weight'],
  present: ['u_hdr'],
  backdrop: ['u_background'],
};

export function createRendererPrograms(gl: WebGL2RenderingContext, floatPath: boolean): RendererPrograms {
  const all: WebGLProgram[] = [];
  const build = (name: ShaderProgramName): WebGLProgram => {
    const source = shaderProgramSource(name);
    const program = createGlProgram(gl, source.vertex, source.fragment, name);
    all.push(program);
    return program;
  };
  try {
    const meshProgram = (name: 'opaque' | 'oitAccum' | 'fallback'): MeshProgram => {
      const program = build(name);
      return {
        program,
        model: gl.getUniformLocation(program, 'u_model'),
        viewProjection: gl.getUniformLocation(program, 'u_viewProjection'),
        texture: gl.getUniformLocation(program, 'u_texture'),
        texelAntialias: gl.getUniformLocation(program, 'u_texelAntialias'),
      };
    };
    const fullscreenProgram = (name: 'oitComposite' | 'present' | 'backdrop'): FullscreenProgram => {
      const program = build(name);
      const uniforms = Object.fromEntries(
        FULLSCREEN_UNIFORMS[name].map((uniform) => [uniform, gl.getUniformLocation(program, uniform)]),
      );
      return { program, uniforms };
    };
    if (floatPath) {
      return {
        meshPasses: { opaque: meshProgram('opaque'), oitAccum: meshProgram('oitAccum') },
        fullscreen: { oitComposite: fullscreenProgram('oitComposite'), present: fullscreenProgram('present') },
        all,
      };
    }
    return {
      meshPasses: { fallback: meshProgram('fallback') },
      fullscreen: { backdrop: fullscreenProgram('backdrop') },
      all,
    };
  } catch (error) {
    for (const program of all) gl.deleteProgram(program);
    throw error;
  }
}
