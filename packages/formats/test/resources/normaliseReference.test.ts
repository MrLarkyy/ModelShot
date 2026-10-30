import { describe, expect, it } from 'vitest';
import { isUrlReference, normaliseReference, referenceBaseName } from '../../src/index';

describe('normaliseReference', () => {
  it.each([
    ['./a.bin', 'a.bin'],
    ['././textures/a.png', 'textures/a.png'],
    ['textures\\a.png', 'textures/a.png'],
    ['.\\a.png', 'a.png'],
    ['my%20model.bin', 'my model.bin'],
    ['bad%zz.png', 'bad%zz.png'],
    ['../up/a.png', '../up/a.png'],
  ])('%s -> %s', (reference, path) => {
    expect(normaliseReference(reference)).toBe(path);
  });

  it('takes the last segment as the base name', () => {
    expect(referenceBaseName('textures/sub/a b.png')).toBe('a b.png');
    expect(referenceBaseName('a.png')).toBe('a.png');
    expect(referenceBaseName('dir/')).toBe('');
  });
});

describe('isUrlReference', () => {
  it.each([
    'http://x/a.png',
    'https://x/a.png',
    'file:///a.png',
    'data:,x',
    'javascript:x',
    '//cdn/a.png',
    '\\\\srv\\a.png',
  ])('%s is a URL', (reference) => {
    expect(isUrlReference(reference)).toBe(true);
  });

  it.each(['a.png', './a.png', 'C:\\models\\a.png', 'c:/a.png', '../a.bin', '/abs/a.png'])(
    '%s is a path',
    (reference) => {
      expect(isUrlReference(reference)).toBe(false);
    },
  );
});
