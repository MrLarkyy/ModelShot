import { describe, expect, it } from 'vitest';
import { PathTracerError } from '../src/PathTracerError';
import { TracerPrograms } from '../src/tracerPrograms';
import { stubGl } from './stubGl';

// Only the guide's fragment shader declares u_partialGuideRays: it alone fails to compile.
const guideFails = (source: string) => !source.includes('uniform uint u_partialGuideRays;');

const compiles = (calls: ReturnType<typeof stubGl>['calls']) => calls.filter((c) => c.name === 'compileShader').length;

describe('TracerPrograms', () => {
  it('links only trace and present with the context, a quality program when required, each once', () => {
    const { gl, calls } = stubGl();
    const programs = new TracerPrograms(gl);
    expect(calls.filter((c) => c.name === 'createProgram')).toHaveLength(2);
    programs.require(['noise']);
    programs.require(['noise', 'resolve']);
    expect(calls.filter((c) => c.name === 'createProgram')).toHaveLength(4);
    expect(programs.get('noise').program).toBeDefined();
    expect(() => programs.get('guide')).toThrow(/guide program is not linked/);
    programs.dispose();
    expect(calls.filter((c) => c.name === 'deleteProgram')).toHaveLength(4);
  });

  it('remembers a failed program: a second require throws the same error without compiling again', () => {
    const { gl, calls } = stubGl({ compiles: guideFails });
    const programs = new TracerPrograms(gl);
    const before = compiles(calls);
    let first: unknown;
    try {
      programs.require(['guide']);
    } catch (error) {
      first = error;
    }
    expect(first).toBeInstanceOf(PathTracerError);
    expect((first as PathTracerError).code).toBe('SHADER_COMPILE');
    // Its vertex and fragment shader, once.
    const attempt = compiles(calls) - before;
    expect(attempt).toBe(2);
    let second: unknown;
    try {
      programs.require(['guide']);
    } catch (error) {
      second = error;
    }
    expect(second).toBe(first);
    expect(compiles(calls) - before).toBe(attempt);
    // Other programs still link.
    programs.require(['noise']);
    expect(programs.get('noise').program).toBeDefined();
  });

  it('starts over in a rebuilt context', () => {
    const { gl } = stubGl({ compiles: guideFails });
    expect(() => new TracerPrograms(gl).require(['guide'])).toThrow(PathTracerError);
    const restored = stubGl();
    const programs = new TracerPrograms(restored.gl);
    programs.require(['guide']);
    expect(programs.get('guide').program).toBeDefined();
  });
});
