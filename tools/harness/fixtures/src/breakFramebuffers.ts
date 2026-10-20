/**
 * From the call on, every framebuffer of every WebGL2 context on the page reports itself incomplete: a driver that
 * rejects float targets at some size, which SwiftShader never does by itself.
 */
export function breakFramebuffers(): void {
  const proto = WebGL2RenderingContext.prototype as unknown as {
    checkFramebufferStatus: (this: WebGL2RenderingContext, target: number) => number;
  };
  proto.checkFramebufferStatus = function (this: WebGL2RenderingContext): number {
    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
  };
}
