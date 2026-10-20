import { describe, expect, it } from 'vitest';
import { linkShader } from '../src/linkShader';
import { lookShaderChunks } from '../src/lookShaderChunks';

describe('linkShader', () => {
  it('resolves nested includes depth first and keeps #version first', () => {
    const chunks = { a: 'float a() { return 1.0; }\n#include "b"', b: 'float b() { return 2.0; }' };
    const out = linkShader('#version 300 es\nprecision highp float;\n#include "a"\nvoid main() {}', chunks);
    expect(out.split('\n')).toEqual([
      '#version 300 es',
      'precision highp float;',
      'float a() { return 1.0; }',
      'float b() { return 2.0; }',
      'void main() {}',
    ]);
  });

  it('emits a chunk included twice only once', () => {
    const chunks = {
      common: 'const float K = 1.0;',
      a: '#include "common"\nfloat a;',
      b: '#include "common"\nfloat b;',
    };
    const out = linkShader('#version 300 es\n#include "a"\n#include "b"\n#include "common"', chunks);
    expect(out.match(/const float K/g)).toHaveLength(1);
    expect(out).toBe('#version 300 es\nconst float K = 1.0;\nfloat a;\nfloat b;');
  });

  it('rejects an unknown include and names the including chunk', () => {
    expect(() => linkShader('#include "nope"', {})).toThrow('unknown shader include "nope"');
    expect(() => linkShader('#include "a"', { a: '#include "missing"' })).toThrow(
      'unknown shader include "missing" in chunk "a"',
    );
  });

  it('does not resolve names from the prototype', () => {
    expect(() => linkShader('#include "toString"', {})).toThrow('unknown shader include "toString"');
  });

  it('rejects a cycle with its path', () => {
    const chunks = { a: '#include "b"', b: '#include "c"', c: '#include "a"' };
    expect(() => linkShader('#include "a"', chunks)).toThrow('shader include cycle: a -> b -> c -> a');
    expect(() => linkShader('#include "self"', { self: '#include "self"' })).toThrow('cycle: self -> self');
  });

  it('rejects malformed includes and misplaced #version', () => {
    expect(() => linkShader('#include <a>', { a: '' })).toThrow('malformed shader include');
    expect(() => linkShader('#include "a" // x', { a: '' })).toThrow('malformed shader include');
    expect(() => linkShader('precision highp float;\n#version 300 es', {})).toThrow('first line');
    expect(() => linkShader('#version 300 es\n#include "a"', { a: '#version 300 es' })).toThrow(
      'must not contain #version',
    );
  });

  it('links the shared look chunks', () => {
    const out = linkShader('#version 300 es\n#include "agx"\n#include "texelAlpha"', lookShaderChunks);
    expect(out).toContain('vec3 agxToneMap(vec3 linearColor)');
    expect(out).toContain('bool texelIsPartial(float alpha)');
    expect(out.indexOf('#version')).toBe(0);
  });
});
