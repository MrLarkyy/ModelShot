import { PathTracerError } from './PathTracerError';

/**
 * Enables EXT_color_buffer_float and checks 32-bit highp floats and integers in fragment shaders: what exact,
 * order-independent float sums need (the path tracer and the light bake). Throws `PathTracerError`
 * `FLOAT_TARGETS_UNAVAILABLE` or `HIGHP_UNAVAILABLE`.
 */
export function requireExactAccumulation(gl: WebGL2RenderingContext): void {
  if (gl.getExtension('EXT_color_buffer_float') === null) {
    throw new PathTracerError(
      'FLOAT_TARGETS_UNAVAILABLE',
      'EXT_color_buffer_float is missing: the path tracer needs RGBA32F render targets',
    );
  }
  const float = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const int = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_INT);
  if (!float || float.precision < 23 || !int || int.rangeMax < 30) {
    throw new PathTracerError('HIGHP_UNAVAILABLE', 'fragment shaders lack 32-bit highp floats and integers');
  }
}
