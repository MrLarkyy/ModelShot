import { EXACT_SAMPLE_OFFSETS } from './exactSupersample';

/**
 * The sample history of a still exact-key frame on the float path: one RGBA16F layer of a `TEXTURE_2D_ARRAY` per
 * jittered pass (`EXACT_SAMPLE_OFFSETS`), filled one pass per `render()` and averaged by the `presentSamples` program.
 * `filled` counts the layers holding a pass of the current view; `cursor` is the layer the next pass goes to.
 */
export class ExactSampleHistory {
  filled = 0;
  cursor = 0;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly texture: WebGLTexture,
    private readonly framebuffer: WebGLFramebuffer,
    readonly width: number,
    readonly height: number,
  ) {}

  /** Allocates the layers for `width` × `height`; `null` (nothing left allocated) when the framebuffer is incomplete. */
  static create(gl: WebGL2RenderingContext, width: number, height: number): ExactSampleHistory | null {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, width, height, EXACT_SAMPLE_OFFSETS.length);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (complete) return new ExactSampleHistory(gl, texture, framebuffer, width, height);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }

  /** Sub-pixel offset of the next pass. */
  get offset(): readonly [number, number] {
    return EXACT_SAMPLE_OFFSETS[this.cursor] ?? [0, 0];
  }

  get converged(): boolean {
    return this.filled >= EXACT_SAMPLE_OFFSETS.length;
  }

  /** Forgets every pass: the view changed. */
  reset(): void {
    this.filled = 0;
    this.cursor = 0;
  }

  /** Copies the colour of `source` (the pass just drawn, `width` × `height`) into the next layer. */
  store(source: WebGLFramebuffer): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, 0, this.cursor);
    const { width, height } = this;
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cursor = (this.cursor + 1) % EXACT_SAMPLE_OFFSETS.length;
    this.filled = Math.min(this.filled + 1, EXACT_SAMPLE_OFFSETS.length);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}
