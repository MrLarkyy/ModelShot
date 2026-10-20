import { RendererError } from './RendererError';

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new RendererError('SHADER_COMPILE', `${label}: could not create a shader object`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new RendererError('SHADER_COMPILE', `${label}: shader compile failed: ${log.trim()}`);
  }
  return shader;
}

/** Compiles and links a program; a failure throws `RendererError` with the driver's info log. */
export function createGlProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new RendererError('SHADER_LINK', `${label}: program link failed: ${log.trim()}`);
  }
  return program;
}
