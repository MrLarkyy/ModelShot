import { describe, expect, it } from 'vitest';
import { DEFAULT_BBMODEL_LIMITS, listBbmodelReferences, readBbmodelJson } from '../../src/index';
import { expectCpuBelow } from '../support/expectCpuBelow';
import { fixture, model, pngDataUri } from './fixtures';

const MAX = { maxReferences: 31 };
const encode = (value: unknown): string => JSON.stringify(value);
const withTextures = (textures: unknown): string => encode(model({ textures }));
const atVersion = (version: unknown, textures: unknown): string =>
  encode(model({ meta: { format_version: version, model_format: 'free', box_uv: false }, textures }));

describe('listBbmodelReferences', () => {
  it('lists the relative_path of referenced-texture (4.5: one leading .. dropped) and the name of a source-URL texture', () => {
    expect(listBbmodelReferences(fixture('referenced-texture'), MAX)).toEqual([
      'textures/referenced.png',
      'remote.png',
    ]);
  });

  it('drops the first leading .. of a relative_path before format 4.10, which Blockbench wrote against the file', () => {
    const textures = [
      { relative_path: '..\\tex\\a.png' },
      { relative_path: '../../b.png' },
      { relative_path: 'tex/c.png' },
    ];
    for (const version of ['4.9', '3.6', 4.9]) {
      expect(listBbmodelReferences(atVersion(version, textures), MAX), String(version)).toEqual([
        'tex\\a.png',
        '../b.png',
        'tex/c.png',
      ]);
    }
  });

  it('lists a relative_path as written from format 4.10 on, and for a missing or malformed version', () => {
    const textures = [{ relative_path: '../tex/a.png' }, { relative_path: '..\\b.png' }];
    for (const version of ['4.10', '4.10.1', '5.0', undefined, 'x', '4.9-beta', '9'.repeat(40)]) {
      expect(listBbmodelReferences(atVersion(version, textures), MAX), String(version)).toEqual([
        '../tex/a.png',
        '..\\b.png',
      ]);
    }
  });

  it('never drops a .. from a name', () => {
    expect(listBbmodelReferences(atVersion('4.9', [{ name: '../a.png' }]), MAX)).toEqual(['../a.png']);
  });

  it('reads bytes as well as text', () => {
    const bytes = new TextEncoder().encode(fixture('referenced-texture'));
    expect(listBbmodelReferences(bytes, MAX)).toEqual(listBbmodelReferences(fixture('referenced-texture'), MAX));
  });

  it('lists the name when relative_path is absent or empty', () => {
    const textures = [{ name: 'a.png' }, { name: 'b.png', relative_path: '' }];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual(['a.png', 'b.png']);
  });

  it('never lists path or source', () => {
    const textures = [
      { path: 'C:\\Users\\author\\a.png' },
      { source: 'https://example.invalid/b.png' },
      { path: '/home/author/c.png', source: 'c.png' },
    ];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual([]);
  });

  it('lists one reference for a Blockbench-shaped texture whose path and relative_path share a base name', () => {
    const textures = [
      {
        path: 'C:\\Users\\author\\models\\textures\\tile.png',
        relative_path: '..\\textures\\tile.png',
        name: 'tile.png',
      },
    ];
    expect(listBbmodelReferences(atVersion('5.0', textures), MAX)).toEqual(['..\\textures\\tile.png']);
  });

  it('leaves an embedded data: texture out', () => {
    const textures = [
      { name: 'embedded.png', relative_path: 'embedded.png', source: pngDataUri(1, 1) },
      { name: 'upper.png', source: 'DATA:image/png;base64,AAAA' },
    ];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual([]);
    expect(listBbmodelReferences(fixture('single-cube'), MAX)).toEqual([]);
  });

  it('keeps the order and lists each spelling once', () => {
    const textures = [{ name: 'b.png' }, { name: 'a.png' }, { relative_path: 'b.png' }, { relative_path: './b.png' }];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual(['b.png', 'a.png', './b.png']);
  });

  it('lists URLs for the caller to refuse', () => {
    const textures = [{ relative_path: 'https://evil.example/a.png' }, { name: 'javascript:alert(1)' }];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual([
      'https://evil.example/a.png',
      'javascript:alert(1)',
    ]);
  });

  it('stops after one more than the maximum', () => {
    const textures = Array.from({ length: 64 }, (_, i) => ({ name: `t${i}.png` }));
    const listed = listBbmodelReferences(withTextures(textures), MAX);
    expect(listed).toHaveLength(32);
    expect(listed.at(-1)).toBe('t31.png');
  });

  it('ignores entries that are not objects and fields that are not strings', () => {
    const textures = [null, 3, 'a.png', ['b.png'], { relative_path: 5, name: 'c.png' }, { name: { x: 1 } }];
    expect(listBbmodelReferences(withTextures(textures), MAX)).toEqual(['c.png']);
  });

  it('lists nothing for a texture whose reference is over the loader string limit, in linear time', () => {
    const long = `${'a/'.repeat(500_000)}x.png`;
    const textures = [{ relative_path: long, name: 'fallback.png' }, { name: 'ok.png' }];
    const container = readBbmodelJson(withTextures(textures), DEFAULT_BBMODEL_LIMITS.maxFileBytes);
    expect(expectCpuBelow(50, () => listBbmodelReferences(container, MAX))).toEqual(['ok.png']);
    const atLimit = 'b'.repeat(DEFAULT_BBMODEL_LIMITS.maxStringChars - 4) + '.png';
    expect(listBbmodelReferences(withTextures([{ name: atLimit }]), MAX)).toEqual([atLimit]);
  });

  it('lists nothing for a file the loader refuses', () => {
    expect(listBbmodelReferences('{"meta":', MAX)).toEqual([]);
    expect(listBbmodelReferences(new Uint8Array([0xff, 0xfe, 0x00]), MAX)).toEqual([]);
    expect(listBbmodelReferences('[]', MAX)).toEqual([]);
    expect(listBbmodelReferences(encode({ textures: [{ name: 'a.png' }] }), MAX)).toEqual([]);
    expect(listBbmodelReferences(encode({ meta: 1, textures: [{ name: 'a.png' }] }), MAX)).toEqual([]);
    expect(listBbmodelReferences(withTextures({ name: 'a.png' }), MAX)).toEqual([]);
    const tooMany = Array.from({ length: DEFAULT_BBMODEL_LIMITS.maxTextures + 1 }, (_, i) => ({ name: `t${i}.png` }));
    expect(listBbmodelReferences(withTextures(tooMany), MAX)).toEqual([]);
  });

  it('lists from a container what its bytes list', () => {
    const bytes = new TextEncoder().encode(fixture('referenced-texture'));
    const container = readBbmodelJson(bytes, DEFAULT_BBMODEL_LIMITS.maxFileBytes);
    expect(listBbmodelReferences(container, MAX)).toEqual(listBbmodelReferences(bytes, MAX));
  });
});
