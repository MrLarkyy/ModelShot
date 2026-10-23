import { PathTracerError } from './PathTracerError';

/** Side of the blocks of canvas pixels the noise estimate takes its worst pixel of (noise.frag.glsl mirrors it). */
export const NOISE_BLOCK = 4;

interface ColorTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
}

/** A filter image and, for a transparent request, the filtered mean coverage beside it (R32F, attachment 1). */
interface FilterTarget extends ColorTarget {
  readonly coverage: WebGLTexture | null;
}

/** The denoiser's guides (guide.frag): mean albedo (floored), shading normal and view depth of stratified camera rays. */
interface GuideTarget {
  readonly albedo: WebGLTexture;
  readonly normal: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
}

/** What a quality request needs besides the accumulation: sizes and which targets. */
export interface ResolveLayout {
  /** The accumulation's (traced) size. */
  readonly width: number;
  readonly height: number;
  /** The canvas size; the accumulation is `scale` times it. */
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly denoise: boolean;
  /** A resolved canvas-size image to present (supersampled or denoised). */
  readonly resolve: boolean;
  /** A noise estimate per block (denoise or a noise threshold: the accumulation has moments). */
  readonly noise: boolean;
  /** A transparent request: denoised, the filter images carry the coverage too. */
  readonly transparent: boolean;
}

/**
 * The quality path's targets, allocated only when a request needs them: the guides and two filter images in turn at
 * the traced size (guides RGBA16F: a level of the final 8-bit image is far coarser than half precision; filter images
 * RGBA32F, as the variance of one sample over a floored albedo overflows half precision), the resolved canvas-size
 * image (RGBA32F, the mean as exact as the accumulation's), and one RGBA32F texel per noise block. Denoising a
 * transparent request, each filter image has an R32F coverage image beside it.
 */
export class ResolveTargets {
  readonly guide: GuideTarget | null = null;
  readonly filtered: readonly [FilterTarget, FilterTarget] | null = null;
  readonly resolved: ColorTarget | null = null;
  readonly noise: ColorTarget | null = null;
  readonly noiseWidth: number;
  readonly noiseHeight: number;
  private readonly textures: WebGLTexture[] = [];
  private readonly framebuffers: WebGLFramebuffer[] = [];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly layout: ResolveLayout,
  ) {
    this.noiseWidth = Math.ceil(layout.outputWidth / NOISE_BLOCK);
    this.noiseHeight = Math.ceil(layout.outputHeight / NOISE_BLOCK);
    try {
      const { width, height } = layout;
      if (layout.denoise) {
        const albedo = this.texture(gl.RGBA16F, width, height);
        const normal = this.texture(gl.RGBA16F, width, height);
        this.guide = { albedo, normal, framebuffer: this.framebuffer([albedo, normal]) };
        this.filtered = [this.filterTarget(layout), this.filterTarget(layout)];
      }
      if (layout.resolve) this.resolved = this.colorTarget(gl.RGBA32F, layout.outputWidth, layout.outputHeight);
      if (layout.noise) this.noise = this.colorTarget(gl.RGBA32F, this.noiseWidth, this.noiseHeight);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Whether these targets serve `layout`. */
  matches(layout: ResolveLayout): boolean {
    const own = this.layout;
    return (Object.keys(own) as (keyof ResolveLayout)[]).every((key) => own[key] === layout[key]);
  }

  /** The noise of every block, row-major from the bottom. */
  readNoise(): Float32Array {
    const gl = this.gl;
    const noise = this.noise;
    if (!noise) return new Float32Array(0);
    const texels = new Float32Array(this.noiseWidth * this.noiseHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, noise.framebuffer);
    gl.readPixels(0, 0, this.noiseWidth, this.noiseHeight, gl.RGBA, gl.FLOAT, texels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const values = new Float32Array(this.noiseWidth * this.noiseHeight);
    for (let i = 0; i < values.length; i++) values[i] = texels[i * 4] as number;
    return values;
  }

  dispose(): void {
    for (const framebuffer of this.framebuffers) this.gl.deleteFramebuffer(framebuffer);
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.framebuffers.length = 0;
    this.textures.length = 0;
  }

  private texture(format: number, width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    this.textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private framebuffer(attachments: readonly WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    this.framebuffers.push(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    attachments.forEach((texture, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
    });
    if (attachments.length > 1) gl.drawBuffers(attachments.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete && !gl.isContextLost()) {
      throw new PathTracerError('FLOAT_TARGETS_UNAVAILABLE', 'float targets of the denoiser are not renderable here');
    }
    return framebuffer;
  }

  private filterTarget(layout: ResolveLayout): FilterTarget {
    const gl = this.gl;
    const texture = this.texture(gl.RGBA32F, layout.width, layout.height);
    const coverage = layout.transparent ? this.texture(gl.R32F, layout.width, layout.height) : null;
    return { texture, coverage, framebuffer: this.framebuffer(coverage ? [texture, coverage] : [texture]) };
  }

  private colorTarget(format: number, width: number, height: number): ColorTarget {
    const texture = this.texture(format, width, height);
    return { texture, framebuffer: this.framebuffer([texture]) };
  }
}
