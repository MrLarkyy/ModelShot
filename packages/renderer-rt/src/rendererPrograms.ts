import { LOOK_UNIFORM_NAMES, type LookUniformName } from '@modelshot/looks';
import type { DepthKeyMode } from './depthKeyMode';
import { createGlProgram } from './glProgram';
import { shaderProgramSource, type ShaderProgramName } from './shaderSources';

/** A program's locations of the look uniforms (`uploadLookUniforms`); `null` for one it does not use. */
export type LookLocations = Readonly<Record<LookUniformName, WebGLUniformLocation | null>>;

export interface MeshProgram {
  readonly program: WebGLProgram;
  readonly look: LookLocations;
  readonly model: WebGLUniformLocation | null;
  readonly normalMatrix: WebGLUniformLocation | null;
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
  readonly lightmap: WebGLUniformLocation | null;
  readonly bakeOn: WebGLUniformLocation | null;
  readonly lightmapTextureSize: WebGLUniformLocation | null;
  readonly edgeWidth: WebGLUniformLocation | null;
  /** `u_alphaToCoverage`: the opaque pass only (`alphaToCoverageActive`); `null` in the OIT and fallback passes. */
  readonly alphaToCoverage: WebGLUniformLocation | null;
}

export interface FullscreenProgram {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
  readonly look: LookLocations;
}

export type MeshPassName = 'opaque' | 'oitAccum' | 'fallback';

/** The programs of one path: float (opaque, OIT, composite, present, backdrop) or no-float (fallback, backdrop). */
export interface RendererPrograms {
  /** Mesh passes in both depth-key variants; a frame uses one variant for all of them. */
  readonly meshPasses: Readonly<Record<DepthKeyMode, Readonly<Partial<Record<MeshPassName, MeshProgram>>>>>;
  /** `presentSamples`: the present pass of an exact-key frame's sample history (`exactSampleCount`). */
  readonly fullscreen: Readonly<
    Partial<Record<'oitComposite' | 'present' | 'presentSamples' | 'backdrop', FullscreenProgram>>
  >;
  /** The shadow catcher's quad, on both paths. */
  readonly catcher: FullscreenProgram;
  readonly all: readonly WebGLProgram[];
}

type FullscreenProgramName = 'oitComposite' | 'present' | 'presentSamples' | 'backdrop' | 'catcher';

const FULLSCREEN_UNIFORMS: Readonly<Record<FullscreenProgramName, readonly string[]>> = {
  oitComposite: ['u_accum', 'u_weight'],
  present: ['u_hdr'],
  presentSamples: ['u_samples', 'u_sampleCount'],
  backdrop: ['u_toneMap'],
  catcher: ['u_viewProjection', 'u_catcherLight', 'u_catcherRect', 'u_catcherSize', 'u_toneMap'],
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
  const lookLocations = (program: WebGLProgram): LookLocations =>
    Object.fromEntries(LOOK_UNIFORM_NAMES.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<
      LookUniformName,
      WebGLUniformLocation | null
    >;
  try {
    const meshProgram = (name: MeshPassName, depthKey: DepthKeyMode): MeshProgram => {
      const program = build(name, depthKey);
      const at = (uniform: string) => gl.getUniformLocation(program, uniform);
      return {
        program,
        look: lookLocations(program),
        model: at('u_model'),
        normalMatrix: at('u_normalMatrix'),
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
        lightmap: at('u_lightmap'),
        bakeOn: at('u_bakeOn'),
        lightmapTextureSize: at('u_lightmapTextureSize'),
        edgeWidth: at('u_edgeWidth'),
        alphaToCoverage: at('u_alphaToCoverage'),
      };
    };
    const fullscreenProgram = (name: FullscreenProgramName): FullscreenProgram => {
      const program = build(name, 'raster');
      const uniforms = Object.fromEntries(
        FULLSCREEN_UNIFORMS[name].map((uniform) => [uniform, gl.getUniformLocation(program, uniform)]),
      );
      return { program, uniforms, look: lookLocations(program) };
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
        fullscreen: {
          oitComposite: fullscreenProgram('oitComposite'),
          present: fullscreenProgram('present'),
          presentSamples: fullscreenProgram('presentSamples'),
          backdrop: fullscreenProgram('backdrop'),
        },
        catcher: fullscreenProgram('catcher'),
        all,
      };
    }
    return {
      meshPasses: passes(['fallback']),
      fullscreen: { backdrop: fullscreenProgram('backdrop') },
      catcher: fullscreenProgram('catcher'),
      all,
    };
  } catch (error) {
    for (const program of all) gl.deleteProgram(program);
    throw error;
  }
}
