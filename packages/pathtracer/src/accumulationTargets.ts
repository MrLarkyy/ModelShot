import { PathTracerError } from './PathTracerError';

interface Target {
  readonly texture: WebGLTexture;
  /** R32F sum of the samples' squared luminance at COLOR_ATTACHMENT1; `null` without moments. */
  readonly moments: WebGLTexture | null;
  /** RG32F sums of the samples' coverage and squared coverage at COLOR_ATTACHMENT2; `null` unless transparent. */
  readonly coverage: WebGLTexture | null;
  readonly framebuffer: WebGLFramebuffer;
}

/**
 * Two RGBA32F images of the running per-pixel sum of samples, used in turn: a sample reads the sum so far from one and
 * writes sum + sample into the other, then they swap. No blending (which would need EXT_float_blend), and exact float
 * adds in sample order, so the result depends only on the samples, never on how they were batched. With `moments`
 * each also holds the running sum of squared luminance (R32F, the same way), from which the noise estimate and the
 * denoiser take each pixel's variance. With `transparent` each holds the running sums of coverage and of its square
 * too (RG32F, the square for the noise estimate): the radiance sum's alpha already counts capped traversals.
 */
export class AccumulationTargets {
  private readonly targets: [Target, Target];
  private current = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    readonly moments = false,
    readonly transparent = false,
  ) {
    const first = this.createTarget();
    let second: Target;
    try {
      second = this.createTarget();
    } catch (error) {
      this.deleteTarget(first);
      throw error;
    }
    this.targets = [first, second];
    this.clear();
  }

  /** The sum of the samples drawn so far. */
  get sum(): Target {
    return this.targets[this.current] as Target;
  }

  /** Where the next sample's sum goes. */
  get next(): Target {
    return this.targets[1 - this.current] as Target;
  }

  swap(): void {
    this.current = 1 - this.current;
  }

  /** Zeroes both sums (and both moment and coverage sums). */
  clear(): void {
    const gl = this.gl;
    for (const target of this.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      if (target.moments) gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      if (target.coverage) gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = 0;
  }

  /** The float sums (RGBA per pixel, rows bottom to top; a counts capped traversals), for a denoiser or a test. */
  read(): Float32Array {
    const gl = this.gl;
    const pixels = new Float32Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sum.framebuffer);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  dispose(): void {
    for (const target of this.targets) this.deleteTarget(target);
  }

  private deleteTarget(target: Target): void {
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
    if (target.moments) this.gl.deleteTexture(target.moments);
    if (target.coverage) this.gl.deleteTexture(target.coverage);
  }

  private createTexture(format: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, this.width, this.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private createTarget(): Target {
    const gl = this.gl;
    const texture = this.createTexture(gl.RGBA32F);
    const moments = this.moments ? this.createTexture(gl.R32F) : null;
    const coverage = this.transparent ? this.createTexture(gl.RG32F) : null;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (moments) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, moments, 0);
    if (coverage) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, coverage, 0);
      // Draw buffer i must be attachment i or NONE: the trace writes coverage at location 2 with or without moments.
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, moments ? gl.COLOR_ATTACHMENT1 : gl.NONE, gl.COLOR_ATTACHMENT2]);
    } else if (moments) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    }
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const target = { texture, moments, coverage, framebuffer };
    if (!complete && !gl.isContextLost()) {
      this.deleteTarget(target);
      throw new PathTracerError(
        'FLOAT_TARGETS_UNAVAILABLE',
        coverage
          ? `RGBA32F + ${moments ? 'R32F moment and ' : ''}RG32F coverage accumulation targets are not renderable here`
          : moments
            ? 'RGBA32F + R32F accumulation targets are not renderable here'
            : 'RGBA32F accumulation targets are not renderable here',
      );
    }
    return target;
  }
}
