import { pathTracerProgramSource, type PathTracerProgramName } from './pathTracerShaders';
import { PathTracerError } from './PathTracerError';

/** A linked program and a lookup of its uniform locations by name. */
export interface TracerProgram {
  readonly program: WebGLProgram;
  readonly uniform: (name: string) => WebGLUniformLocation | null;
}

/** The render's programs: the trace and present of every render, the quality path's guide, denoise, resolve, noise. */
const RENDER_PROGRAMS = ['trace', 'present', 'guide', 'denoise', 'resolve', 'noise'] as const;

export type TracerPrograms = Readonly<Record<(typeof RENDER_PROGRAMS)[number], TracerProgram>>;

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

/** Compiles and links one program; a failure throws `PathTracerError` with the driver's info log. */
export function linkTracerProgram(gl: WebGL2RenderingContext, name: PathTracerProgramName): TracerProgram {
  const source = pathTracerProgramSource(name);
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

/** Compiles and links every render program; a failure deletes those linked and throws `PathTracerError`. */
export function createTracerPrograms(gl: WebGL2RenderingContext): TracerPrograms {
  const linked: Partial<Record<(typeof RENDER_PROGRAMS)[number], TracerProgram>> = {};
  try {
    for (const name of RENDER_PROGRAMS) linked[name] = linkTracerProgram(gl, name);
  } catch (error) {
    for (const program of Object.values(linked)) gl.deleteProgram(program.program);
    throw error;
  }
  return linked as TracerPrograms;
}

export function disposeTracerPrograms(gl: WebGL2RenderingContext, programs: TracerPrograms): void {
  for (const name of RENDER_PROGRAMS) gl.deleteProgram(programs[name].program);
}
