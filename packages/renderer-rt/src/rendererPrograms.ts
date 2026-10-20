import type { DepthKeyMode } from './depthKeyMode';
import { createGlProgram } from './glProgram';
import { shaderProgramSource, type ShaderProgramName } from './shaderSources';

export interface MeshProgram {
  readonly program: WebGLProgram;
  readonly model: WebGLUniformLocation | null;
  readonly view: WebGLUniformLocation | null;
  readonly viewProjection: WebGLUniformLocation | null;
  readonly depthPull: WebGLUniformLocation | null;
  readonly orderPull: WebGLUniformLocation | null;
  readonly inverseProjection: WebGLUniformLocation | null;
  readonly viewportSize: WebGLUniformLocation | null;
  readonly depthRange: WebGLUniformLocation | null;
  readonly texture: WebGLUniformLocation | null;
  readonly texelAntialias: WebGLUniformLocation | null;
  readonly alphaMode: WebGLUniformLocation | null;
  readonly alphaCutoffByte: WebGLUniformLocation | null;
}

export interface FullscreenProgram {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

export type MeshPassName = 'opaque' | 'oitAccum' | 'fallback';

/** The programs of one path: float (opaque, OIT, composite, present) or no-float (fallback, backdrop). */
export interface RendererPrograms {
  /** Mesh passes in both depth-key variants; a frame uses one variant for all of them. */
  readonly meshPasses: Readonly<Record<DepthKeyMode, Readonly<Partial<Record<MeshPassName, MeshProgram>>>>>;
  readonly fullscreen: Readonly<Partial<Record<'oitComposite' | 'present' | 'backdrop', FullscreenProgram>>>;
  readonly all: readonly WebGLProgram[];
}

const FULLSCREEN_UNIFORMS: Readonly<Record<'oitComposite' | 'present' | 'backdrop', readonly string[]>> = {
  oitComposite: ['u_accum', 'u_weight'],
  present: ['u_hdr'],
  backdrop: ['u_background'],
};

const DEPTH_KEY_MODES: readonly DepthKeyMode[] = ['raster', 'exact'];

export function createRendererPrograms(gl: WebGL2RenderingContext, floatPath: boolean): RendererPrograms {
  const all: WebGLProgram[] = [];
  const build = (name: ShaderProgramName, depthKey: DepthKeyMode): WebGLProgram => {
    const source = shaderProgramSource(name, depthKey);
    const program = createGlProgram(gl, source.vertex, source.fragment, name);
    all.push(program);
    return program;
  };
  try {
    const meshProgram = (name: MeshPassName, depthKey: DepthKeyMode): MeshProgram => {
      const program = build(name, depthKey);
      const at = (uniform: string) => gl.getUniformLocation(program, uniform);
      return {
        program,
        model: at('u_model'),
        view: at('u_view'),
        viewProjection: at('u_viewProjection'),
        depthPull: at('u_depthPull'),
        orderPull: at('u_orderPull'),
        inverseProjection: at('u_inverseProjection'),
        viewportSize: at('u_viewportSize'),
        depthRange: at('u_depthRange'),
        texture: at('u_texture'),
        texelAntialias: at('u_texelAntialias'),
        alphaMode: at('u_alphaMode'),
        alphaCutoffByte: at('u_alphaCutoffByte'),
      };
    };
    const fullscreenProgram = (name: 'oitComposite' | 'present' | 'backdrop'): FullscreenProgram => {
      const program = build(name, 'raster');
      const uniforms = Object.fromEntries(
        FULLSCREEN_UNIFORMS[name].map((uniform) => [uniform, gl.getUniformLocation(program, uniform)]),
      );
      return { program, uniforms };
    };
    const passes = (names: readonly MeshPassName[]): RendererPrograms['meshPasses'] => {
      const variant = (depthKey: DepthKeyMode) =>
        Object.fromEntries(names.map((name) => [name, meshProgram(name, depthKey)]));
      const [raster, exact] = DEPTH_KEY_MODES.map(variant);
      return { raster: raster ?? {}, exact: exact ?? {} };
    };
    if (floatPath) {
      return {
        meshPasses: passes(['opaque', 'oitAccum']),
        fullscreen: { oitComposite: fullscreenProgram('oitComposite'), present: fullscreenProgram('present') },
        all,
      };
    }
    return {
      meshPasses: passes(['fallback']),
      fullscreen: { backdrop: fullscreenProgram('backdrop') },
      all,
    };
  } catch (error) {
    for (const program of all) gl.deleteProgram(program);
    throw error;
  }
}
