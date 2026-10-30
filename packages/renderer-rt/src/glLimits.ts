/** What this context can do; queried after creation and again after a context restore. */
export interface GlLimits {
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
  readonly maxViewport: readonly [number, number];
  /** Largest supported MSAA sample count of an RGBA16F renderbuffer; 0 without float render targets. */
  readonly maxSamplesRgba16f: number;
  /** The same for an R16F renderbuffer (the multisampled OIT weight, `oitMsaaActive`); 0 without float targets. */
  readonly maxSamplesR16f: number;
  readonly colorBufferFloat: boolean;
  readonly fragmentHighp: boolean;
  /** Unmasked renderer string when the browser exposes it. */
  readonly renderer: string;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Enables EXT_color_buffer_float when present and reads the limits the renderer sizes its resources by. */
export function queryGlLimits(gl: WebGL2RenderingContext): GlLimits {
  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const dims = viewport instanceof Int32Array ? viewport : new Int32Array([4096, 4096]);
  const maxSamplesOf = (format: number): number => {
    if (!colorBufferFloat) return 0;
    const samples: unknown = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES);
    return samples instanceof Int32Array ? samples.reduce((a, b) => Math.max(a, b), 0) : 0;
  };
  const maxSamples = positiveInt(gl.getParameter(gl.MAX_SAMPLES), 0);
  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return {
    maxTextureSize: positiveInt(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2048),
    maxRenderbufferSize: positiveInt(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 2048),
    maxViewport: [positiveInt(dims[0], 2048), positiveInt(dims[1], 2048)],
    maxSamplesRgba16f: Math.min(maxSamplesOf(gl.RGBA16F), maxSamples),
    maxSamplesR16f: Math.min(maxSamplesOf(gl.R16F), maxSamples),
    colorBufferFloat,
    fragmentHighp: precision !== null && precision.precision > 0,
    renderer: String(renderer),
  };
}
