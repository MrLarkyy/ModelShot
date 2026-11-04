import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripGlslComments } from '../src/stripGlslComments';

describe('stripGlslComments', () => {
  it('removes a line comment and trailing whitespace', () => {
    expect(stripGlslComments('float a; // why\nfloat b;')).toBe('float a;\nfloat b;');
  });

  it('turns a block comment inside a line into one space', () => {
    expect(stripGlslComments('a/*x*/b')).toBe('a b');
  });

  it('keeps the line count of a multi-line block comment', () => {
    const out = stripGlslComments('a /* one\ntwo\nthree */ b\nc');
    expect(out).toBe('a\n\nb\nc');
  });

  it('ignores // inside a block comment and /* inside a line comment', () => {
    expect(stripGlslComments('a /* // */ b\nc // /* \nd')).toBe('a b\nc\nd');
  });

  it('continues a line comment over a backslash and keeps the line count', () => {
    expect(stripGlslComments('a // x \\\nstill comment\nb')).toBe('a\n\nb');
  });

  it('reads CRLF and writes LF', () => {
    expect(stripGlslComments('a // x\r\nb\r\n')).toBe('a\nb\n');
  });

  it('keeps #version on line 1 and an include line unchanged', () => {
    const out = stripGlslComments('#version 300 es\n  #include "x"  \nvoid main() {}');
    expect(out).toBe('#version 300 es\n#include "x"\nvoid main() {}');
  });

  it('keeps the space that separates a macro name from its body', () => {
    expect(stripGlslComments('#define F (x)\n#define   G    1')).toBe('#define F (x)\n#define G 1');
  });

  it('throws on an unterminated block comment, naming its line', () => {
    expect(() => stripGlslComments('a\nb /* open\nc')).toThrow(/line 2/);
  });
});

describe('stripGlslComments over the repository shaders', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = globSync('*/src/**/*.glsl', { cwd: root });

  it('finds the shaders', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s keeps its line count and loses its comments', (file) => {
    const source = readFileSync(root + file, 'utf8');
    const out = stripGlslComments(source);
    const before = source.replace(/\r\n?/g, '\n').split('\n');
    const after = out.split('\n');
    expect(after.length).toBe(before.length);
    expect(out).not.toMatch(/\/\/|\/\*|\*\//);
    const versionAt = before.findIndex((line) => /^\s*#\s*version\b/.test(line));
    if (versionAt >= 0) expect(after[versionAt]).toMatch(/^#version 300 es$/);
    before.forEach((line, n) => {
      if (/\/\/|\/\*|\*\/|\\$/.test(line)) return;
      expect(after[n]).toBe(line.trim().replace(/\s+/g, ' '));
    });
  });
});
