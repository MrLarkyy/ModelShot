import { pathTracerProgramSource, type PathTracerProgramName } from './pathTracerShaders';
import { PathTracerError } from './PathTracerError';

/** A linked program and a lookup of its uniform locations by name. */
export interface TracerProgram {
  readonly program: WebGLProgram;
  readonly uniform: (name: string) => WebGLUniformLocation | null;
}

/** The quality path's programs, linked the first time a request needs them. */
export type QualityProgramName = 'guide' | 'denoise' | 'resolve' | 'noise';

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

/**
 * The render's programs: the trace and present, linked with the context (a failure throws `PathTracerError`), and the
 * quality path's guide, denoise, resolve and noise, linked only when a request first needs them (`require`), so a
 * plain render never compiles them, nor does a restore before a quality request comes.
 */
export class TracerPrograms {
  readonly trace: TracerProgram;
  readonly present: TracerProgram;
  private readonly quality = new Map<QualityProgramName, TracerProgram>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.trace = linkTracerProgram(gl, 'trace');
    try {
      this.present = linkTracerProgram(gl, 'present');
    } catch (error) {
      gl.deleteProgram(this.trace.program);
      throw error;
    }
  }

  /** Links those of `names` not linked yet; a failure throws `PathTracerError` and keeps the ones linked before. */
  require(names: readonly QualityProgramName[]): void {
    for (const name of names) if (!this.quality.has(name)) this.quality.set(name, linkTracerProgram(this.gl, name));
  }

  /** A quality program `require` linked. */
  get(name: QualityProgramName): TracerProgram {
    const program = this.quality.get(name);
    if (!program) throw new Error(`the ${name} program is not linked`);
    return program;
  }

  dispose(): void {
    this.gl.deleteProgram(this.trace.program);
    this.gl.deleteProgram(this.present.program);
    for (const program of this.quality.values()) this.gl.deleteProgram(program.program);
    this.quality.clear();
  }
}
