import { describe, expect, it } from 'vitest';
import { groupFiles } from '../src/intake/groupFiles';
import type { IntakeError } from '../src/intake/IntakeError';

const file = (name: string): File => new File(['x'], name);

function codeOf(names: string[]): string {
  try {
    groupFiles(names.map(file));
  } catch (error) {
    return (error as IntakeError).code;
  }
  return 'none';
}

describe('groupFiles', () => {
  it('takes the one model with every other file as its resources', () => {
    const [model, bin, png] = [file('a.gltf'), file('a.bin'), file('a.png')];
    expect(groupFiles([bin, model, png])).toEqual({ kind: 'model', model, resources: [bin, png] });
  });

  it.each(['a.bbmodel', 'a.glb', 'a.obj', 'A.GLTF'])('recognises %s as a model', (name) => {
    expect(groupFiles([file(name)]).kind).toBe('model');
  });

  it('opens a lone PNG as a skin', () => {
    const skin = file('steve.png');
    expect(groupFiles([skin])).toEqual({ kind: 'skin', skin });
  });

  it('refuses several models', () => {
    expect(codeOf(['a.bbmodel', 'b.obj'])).toBe('MULTIPLE_MODELS');
  });

  it.each([[['a.png', 'b.png']], [['a.bin']], [['a.mtl', 'a.png']]])('finds no model in %j', (names) => {
    expect(codeOf(names)).toBe('NO_MODEL');
  });
});
