import { pathTracerProgramSource, type PathTracerProgramName } from './pathTracerShaders';
import { linkProgram, type TracerProgram } from './linkProgram';

export type { TracerProgram } from './linkProgram';

/** The quality path's programs, linked the first time a request needs them. */
export type QualityProgramName = 'guide' | 'denoise' | 'resolve' | 'noise';

/** Compiles and links one program by name (`linkProgram` on `pathTracerProgramSource`). */
export function linkTracerProgram(gl: WebGL2RenderingContext, name: PathTracerProgramName): TracerProgram {
  return linkProgram(gl, name, pathTracerProgramSource(name));
}

/**
 * The render's programs: the trace and present, linked with the context (a failure throws `PathTracerError`), and the
 * quality path's guide, denoise, resolve and noise, linked only when a request first needs them (`require`), so a
 * plain render never compiles them, nor does a restore before a quality request comes. A program that failed to
 * compile or link keeps its error: every later `require` of it throws that error again without compiling, until the
 * context is rebuilt (a restore makes a new `TracerPrograms`).
 */
export class TracerPrograms {
  readonly trace: TracerProgram;
  readonly present: TracerProgram;
  private readonly quality = new Map<QualityProgramName, TracerProgram>();
  private readonly failures = new Map<QualityProgramName, unknown>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.trace = linkTracerProgram(gl, 'trace');
    try {
      this.present = linkTracerProgram(gl, 'present');
    } catch (error) {
      gl.deleteProgram(this.trace.program);
      throw error;
    }
  }

  /**
   * Links those of `names` not linked yet; a failure throws `PathTracerError` (the one of the first attempt for a
   * program that failed before) and keeps the ones linked before.
   */
  require(names: readonly QualityProgramName[]): void {
    for (const name of names) {
      if (this.quality.has(name)) continue;
      if (this.failures.has(name)) throw this.failures.get(name);
      try {
        this.quality.set(name, linkTracerProgram(this.gl, name));
      } catch (error) {
        this.failures.set(name, error);
        throw error;
      }
    }
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
