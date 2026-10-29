/**
 * Offscreen targets of the float path: an optional MSAA RGBA16F + DEPTH24 pass, its single-sample resolve (HDR colour
 * texture and depth), and the two OIT accumulation textures sharing the resolved depth; on request a multisampled pair
 * of OIT targets sharing the MSAA depth, resolved into those textures (`multisampledOit`, `resolveOit`). Reallocated
 * only when the size changes.
 */
export class RenderTargets {
  width = 0;
  height = 0;
  msaaFramebuffer: WebGLFramebuffer | null = null;
  readonly resolveFramebuffer: WebGLFramebuffer;
  readonly oitFramebuffer: WebGLFramebuffer;
  hdr: WebGLTexture | null = null;
  accum: WebGLTexture | null = null;
  weight: WebGLTexture | null = null;
  private renderbuffers: WebGLRenderbuffer[] = [];
  private textures: WebGLTexture[] = [];
  private msaaDepth: WebGLRenderbuffer | null = null;
  private oitMsaa: WebGLFramebuffer | null = null;
  /** The driver rejected the multisampled OIT targets at this size; tried again after a resize. */
  private oitMsaaRejected = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    /** 0 renders the opaque pass straight into the resolve target. */
    readonly samples: number,
  ) {
    this.resolveFramebuffer = gl.createFramebuffer();
    this.oitFramebuffer = gl.createFramebuffer();
    if (samples > 0) this.msaaFramebuffer = gl.createFramebuffer();
  }

  /** Allocates for `width` × `height`; returns whether every framebuffer is complete. */
  ensure(width: number, height: number): boolean {
    if (width === this.width && height === this.height) return true;
    const gl = this.gl;
    this.releaseStorage();
    this.width = width;
    this.height = height;

    const depth = this.renderbuffer(gl.DEPTH_COMPONENT24, 0);
    this.hdr = this.colorTexture(gl.RGBA16F);
    this.accum = this.colorTexture(gl.RGBA16F);
    this.weight = this.colorTexture(gl.R16F);

    let complete = true;
    const check = (): void => {
      complete &&= gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hdr, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    check();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.oitFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accum, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.weight, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    check();

    if (this.msaaFramebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFramebuffer);
      const color = this.renderbuffer(gl.RGBA16F, this.samples);
      this.msaaDepth = this.renderbuffer(gl.DEPTH_COMPONENT24, this.samples);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
      check();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return complete;
  }

  /**
   * The multisampled OIT framebuffer of this size: RGBA16F accumulation and R16F weight renderbuffers at the MSAA
   * sample count, with the MSAA pass's depth, so partial faces are tested per sample against the opaque samples.
   * Allocated on the first call; null without an MSAA target or when the driver rejects it, which is not tried again
   * until the size changes. Leaves no framebuffer bound.
   */
  multisampledOit(): WebGLFramebuffer | null {
    if (this.oitMsaa) return this.oitMsaa;
    if (this.oitMsaaRejected || !this.msaaDepth) return null;
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const accum = this.renderbuffer(gl.RGBA16F, this.samples);
    const weight = this.renderbuffer(gl.R16F, this.samples);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, accum);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, weight);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      for (const renderbuffer of [accum, weight]) gl.deleteRenderbuffer(renderbuffer);
      this.renderbuffers = this.renderbuffers.filter(
        (renderbuffer) => renderbuffer !== accum && renderbuffer !== weight,
      );
      this.oitMsaaRejected = true;
      return null;
    }
    this.oitMsaa = framebuffer;
    return framebuffer;
  }

  /**
   * Resolves the multisampled OIT targets into the accumulation and weight textures, one attachment per blit (a
   * multisample resolve needs the same format on both sides). The composite then reads the per-pixel mean of every
   * sample's sums, as it reads a single-sampled pass. Leaves no framebuffer bound.
   */
  resolveOit(): void {
    const gl = this.gl;
    if (!this.oitMsaa) return;
    const { width, height } = this;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.oitMsaa);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.oitFramebuffer);
    for (const [attachment, buffers] of [
      [gl.COLOR_ATTACHMENT0, [gl.COLOR_ATTACHMENT0, gl.NONE]],
      [gl.COLOR_ATTACHMENT1, [gl.NONE, gl.COLOR_ATTACHMENT1]],
    ] as const) {
      gl.readBuffer(attachment);
      gl.drawBuffers(buffers);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    this.releaseStorage();
    gl.deleteFramebuffer(this.resolveFramebuffer);
    gl.deleteFramebuffer(this.oitFramebuffer);
    if (this.msaaFramebuffer) gl.deleteFramebuffer(this.msaaFramebuffer);
    this.msaaFramebuffer = null;
  }

  private renderbuffer(format: number, samples: number): WebGLRenderbuffer {
    const gl = this.gl;
    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, this.width, this.height);
    else gl.renderbufferStorage(gl.RENDERBUFFER, format, this.width, this.height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.renderbuffers.push(renderbuffer);
    return renderbuffer;
  }

  private colorTexture(format: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, this.width, this.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.textures.push(texture);
    return texture;
  }

  private releaseStorage(): void {
    const gl = this.gl;
    for (const renderbuffer of this.renderbuffers) gl.deleteRenderbuffer(renderbuffer);
    for (const texture of this.textures) gl.deleteTexture(texture);
    if (this.oitMsaa) gl.deleteFramebuffer(this.oitMsaa);
    this.renderbuffers = [];
    this.textures = [];
    this.msaaDepth = this.oitMsaa = null;
    this.oitMsaaRejected = false;
    this.hdr = this.accum = this.weight = null;
    this.width = this.height = 0;
  }
}
