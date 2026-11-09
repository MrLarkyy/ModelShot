import { environmentLighting, type EnvironmentLighting, type LookEnvironment } from '@modelshot/looks';

/** The part of a WebGL2 context the environment textures use. */
type EnvironmentGl = Pick<
  WebGL2RenderingContext,
  | 'createTexture'
  | 'deleteTexture'
  | 'bindTexture'
  | 'activeTexture'
  | 'texStorage2D'
  | 'texSubImage2D'
  | 'texParameteri'
  | 'pixelStorei'
  | 'getParameter'
  | 'MAX_TEXTURE_SIZE'
  | 'TEXTURE_2D'
  | 'TEXTURE0'
  | 'RGBA32F'
  | 'RGB32F'
  | 'RGBA'
  | 'RGB'
  | 'FLOAT'
  | 'NEAREST'
  | 'TEXTURE_MIN_FILTER'
  | 'TEXTURE_MAG_FILTER'
  | 'UNPACK_ALIGNMENT'
>;

/**
 * The look's environment image on one context, for the trace and the bake programs' `environmentMap` chunk: the
 * radiance and conditional CDF (`u_envRadiance`, RGBA32F) and per row the marginal CDF (r), the shadow catcher's (g)
 * and its row band (b; the bake reads r only) (`u_envMarginal`, RGB32F), NEAREST and read by texelFetch only. A dome
 * look has none: its units are left unbound, which its branch never reads. Kept while the prepared lighting
 * (`environmentLighting`) stays the same object, made again when it changes; dead with a lost context (make a new
 * instance on the restored one).
 */
export class EnvironmentTextures {
  private lighting: EnvironmentLighting | null = null;
  private radiance: WebGLTexture | null = null;
  private marginal: WebGLTexture | null = null;

  constructor(private readonly gl: EnvironmentGl) {}

  /** Binds the textures of `environment` to `radianceUnit` and `marginalUnit` (nothing, for a dome). */
  bind(environment: LookEnvironment, radianceUnit: number, marginalUnit: number): void {
    const gl = this.gl;
    const lighting = environment.kind === 'hdri' ? environmentLighting(environment) : null;
    if (lighting !== this.lighting) this.upload(lighting);
    gl.activeTexture(gl.TEXTURE0 + radianceUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.radiance);
    gl.activeTexture(gl.TEXTURE0 + marginalUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.marginal);
  }

  dispose(): void {
    this.release();
  }

  private upload(lighting: EnvironmentLighting | null): void {
    this.release();
    if (!lighting) return;
    const gl = this.gl;
    const maxSide: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof maxSide === 'number' && Math.max(lighting.width, lighting.height) > maxSide) {
      throw new RangeError(
        `an environment image of ${lighting.width}x${lighting.height} is over MAX_TEXTURE_SIZE ${maxSide}`,
      );
    }
    const texture = (format: number, width: number, height: number, type: number, data: Float32Array) => {
      const handle = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, type, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return handle;
    };
    this.radiance = texture(gl.RGBA32F, lighting.width, lighting.height, gl.RGBA, lighting.table);
    const marginals = new Float32Array(lighting.height * 3);
    for (let row = 0; row < lighting.height; row++) {
      marginals[row * 3] = lighting.marginal[row] ?? 1;
      marginals[row * 3 + 1] = lighting.catcherMarginal[row] ?? 1;
      marginals[row * 3 + 2] = lighting.catcherBands[row] ?? 0;
    }
    this.marginal = texture(gl.RGB32F, lighting.height, 1, gl.RGB, marginals);
    this.lighting = lighting;
  }

  private release(): void {
    if (this.radiance) this.gl.deleteTexture(this.radiance);
    if (this.marginal) this.gl.deleteTexture(this.marginal);
    this.radiance = null;
    this.marginal = null;
    this.lighting = null;
  }
}
