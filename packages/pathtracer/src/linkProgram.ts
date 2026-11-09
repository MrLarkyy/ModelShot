import { PathTracerError } from './PathTracerError';

/** A linked program and a lookup of its uniform locations by name. */
export interface TracerProgram {
  readonly program: WebGLProgram;
  readonly uniform: (name: string) => WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new PathTracerError('SHADER_COMPILE', `${label}: could not create a shader object`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new PathTracerError('SHADER_COMPILE', `${label}: shader compile failed: ${log.trim()}`);
  }
  return shader;
}

/**
 * Compiles and links the linked GLSL `source` of the program `name`; a failure throws `PathTracerError` with the
 * driver's info log. Takes the source, not a name, so the light baker links its program without importing the
 * render's shader sources.
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  name: string,
  source: { readonly vertex: string; readonly fragment: string },
): TracerProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, source.vertex, `${name} vertex`);
  let fragment: WebGLShader;
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, source.fragment, `${name} fragment`);
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
    throw new PathTracerError('SHADER_LINK', `${name}: program link failed: ${log.trim()}`);
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  const uniform = (uniformName: string): WebGLUniformLocation | null => {
    if (!locations.has(uniformName)) locations.set(uniformName, gl.getUniformLocation(program, uniformName));
    return locations.get(uniformName) ?? null;
  };
  return { program, uniform };
}
