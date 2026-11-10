import { LOOK_UNIFORM_NAMES, type LookUniformName } from '@modelshot/looks';
import type { DepthKeyMode } from './depthKeyMode';
import { createGlProgram } from './glProgram';
import { shaderProgramSource, type ShaderProgramName, type TexelFilterVariant } from './shaderSources';

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
  /** `u_seamCoverage`: the OIT pass only (`oitSeamCoverageMode`); `null` in the opaque and fallback passes. */
  readonly seamCoverage: WebGLUniformLocation | null;
}

export interface FullscreenProgram {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
  readonly look: LookLocations;
}

export type MeshPassName = 'opaque' | 'oitAccum' | 'fallback';

/** The programs of one path: float (opaque, OIT, composite, present, backdrop) or no-float (fallback, backdrop). */
export interface RendererPrograms {
  /**
   * A mesh pass of this path in a depth-key variant (a frame uses one for all its passes) and a texel-filter variant
   * (per draw). The nearest ones are linked with the path; a linear one on its first use, so a scene without a linear
   * texture never links it, and then kept in `all`. Undefined for a pass the path does not draw.
   */
  meshPass(depthKey: DepthKeyMode, name: MeshPassName, filter: TexelFilterVariant): MeshProgram | undefined;
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
  const build = (
    name: ShaderProgramName,
    depthKey: DepthKeyMode,
    filter: TexelFilterVariant = 'nearest',
  ): WebGLProgram => {
    const source = shaderProgramSource(name, depthKey, filter);
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
    const meshProgram = (
      name: MeshPassName,
      depthKey: DepthKeyMode,
      filter: TexelFilterVariant = 'nearest',
    ): MeshProgram => {
      const program = build(name, depthKey, filter);
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
        seamCoverage: name === 'oitAccum' ? at('u_seamCoverage') : null,
      };
    };
    const fullscreenProgram = (name: FullscreenProgramName): FullscreenProgram => {
      const program = build(name, 'raster');
      const uniforms = Object.fromEntries(
        FULLSCREEN_UNIFORMS[name].map((uniform) => [uniform, gl.getUniformLocation(program, uniform)]),
      );
      return { program, uniforms, look: lookLocations(program) };
    };
    const meshPasses = (names: readonly MeshPassName[]): RendererPrograms['meshPass'] => {
      const nearest = new Map(
        DEPTH_KEY_MODES.flatMap((depthKey) =>
          names.map((name) => [`${depthKey} ${name}`, meshProgram(name, depthKey)]),
        ),
      );
      const linear = new Map<string, MeshProgram>();
      return (depthKey, name, filter) => {
        const key = `${depthKey} ${name}`;
        const program = nearest.get(key);
        if (!program || filter === 'nearest') return program;
        let linked = linear.get(key);
        if (!linked) {
          linked = meshProgram(name, depthKey, 'linear');
          linear.set(key, linked);
        }
        return linked;
      };
    };
    if (floatPath) {
      return {
        meshPass: meshPasses(['opaque', 'oitAccum']),
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
      meshPass: meshPasses(['fallback']),
      fullscreen: { backdrop: fullscreenProgram('backdrop') },
      catcher: fullscreenProgram('catcher'),
      all,
    };
  } catch (error) {
    for (const program of all) gl.deleteProgram(program);
    throw error;
  }
}
