import { describe, expect, it } from 'vitest';
import { expectCpuBelow } from '../../formats/test/support/expectCpuBelow';
import { resolveSidecarUrl } from '../src/frame/resolveSidecarUrl';

const MODEL = 'https://models.example/m/a.gltf';
const ORIGIN = 'https://models.example';

const resolve = (reference: string, base = MODEL, origin = ORIGIN) => resolveSidecarUrl(reference, base, origin);

describe('resolveSidecarUrl', () => {
  it.each([
    ['a.bin', 'https://models.example/m/a.bin', 'a.bin'],
    ['./bin/a.bin', 'https://models.example/m/bin/a.bin', 'a.bin'],
    ['../textures/T.PNG', 'https://models.example/textures/T.PNG', 'T.PNG'],
    ['../../../../a.bin', 'https://models.example/a.bin', 'a.bin'],
    ['/abs/a.mtl', 'https://models.example/abs/a.mtl', 'a.mtl'],
    ['%2e%2e/a.bin', 'https://models.example/a.bin', 'a.bin'],
    ['%2F%2Fevil.example/a.png', 'https://models.example/m/%2F%2Fevil.example/a.png', 'a.png'],
    ['a%20b.png', 'https://models.example/m/a%20b.png', 'a b.png'],
    ['checker tile.png', 'https://models.example/m/checker%20tile.png', 'checker tile.png'],
    ['textures\\a.png', 'https://models.example/m/textures/a.png', 'a.png'],
  ])('fetches %s as %s named %s', (reference, href, name) => {
    expect(resolve(reference)).toEqual({ kind: 'download', href, name });
  });

  it('fetches an http file of an http model', () => {
    expect(resolve('a.bin', 'http://127.0.0.1:5000/m/a.gltf', 'http://127.0.0.1:5000')).toEqual({
      kind: 'download',
      href: 'http://127.0.0.1:5000/m/a.bin',
      name: 'a.bin',
    });
  });

  it.each(['C:\\tex\\a.png', 'c:/x.png', 'D:\\a.bin'])('skips the drive path %s, never requesting it', (reference) => {
    expect(resolve(reference)).toEqual({ kind: 'skip' });
  });

  it('refuses a very long reference without scanning it by regex', () => {
    for (const filler of [' ', '\t', '\u0000']) {
      const reference = 'a' + filler.repeat(1_000_000) + 'b.png';
      expect(expectCpuBelow(100, () => resolve(reference)).kind).toBe('refuse');
    }
  });

  it('trims a padded reference in linear time and still sees the scheme', () => {
    const padded = ' '.repeat(1500) + 'javascript:alert(1)' + ' '.repeat(400);
    expect(expectCpuBelow(100, () => resolve(padded)).kind).toBe('refuse');
  });

  it.each(['a.jpg', 'a.png?v=1', 'a.png#x', 'textures/', 'a.gltf', 'a.webp'])(
    'skips %s, which the app could not take next to a model',
    (reference) => {
      expect(resolve(reference)).toEqual({ kind: 'skip' });
    },
  );

  it.each([
    ['data:', 'data:application/octet-stream;base64,AAAA'],
    ['javascript:', 'javascript:alert(1)'],
    ['leading-space JavaScript:', '  JavaScript:alert(1).png'],
    ['file:', 'file:///etc/passwd'],
    ['another origin', 'https://evil.example/a.png'],
    ['the same origin, absolute', 'https://models.example/m/a.png'],
    ['protocol-relative', '//evil.example/a.png'],
    ['two backslashes', '\\\\evil.example\\a.png'],
    ['slash backslash', '/\\evil.example/a.png'],
    ['backslash slash', '\\/evil.example/a.png'],
    ['slash tab slash', '/\t/evil.example/a.png'],
    ['newline in the scheme', 'java\nscript:alert(1)'],
    ['blob:', 'blob:https://models.example/1234'],
    ['too long', `${'a'.repeat(3000)}.png`],
  ])('refuses %s before any request', (_what, reference) => {
    const result = resolve(reference);
    expect(result.kind).toBe('refuse');
    if (result.kind !== 'refuse') return;
    expect(result.error.code).toBe('SIDECAR_REFUSED');
    expect(result.error.message).toContain(JSON.stringify(reference.slice(0, 20)).slice(0, -1));
    expect(result.error.message).toContain('relative to the model');
    expect(result.error.message.length).toBeLessThan(400);
  });

  it('resolves against the base given, an MTL for its textures', () => {
    expect(resolve('../tex/a.png', 'https://models.example/m/mtl/scene.mtl')).toEqual({
      kind: 'download',
      href: 'https://models.example/m/tex/a.png',
      name: 'a.png',
    });
  });
});
