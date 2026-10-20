import { describe, expect, it } from 'vitest';
import { ResourceFiles } from '../../src/resources/ResourceFiles';

const A = new Uint8Array([1]);
const B = new Uint8Array([2]);
const C = new Uint8Array([3]);

describe('ResourceFiles', () => {
  const files = new ResourceFiles(
    new Map([
      ['textures/wood.png', A],
      ['Wood.png', B],
      ['My Model.bin', C],
    ]),
  );

  it('prefers the exact relative path, then the case-insensitive base name', () => {
    expect(files.resolve('textures/wood.png')).toEqual({ ok: true, fileName: 'textures/wood.png', bytes: A });
    expect(files.resolve('./textures/wood.png')).toMatchObject({ ok: true, bytes: A });
    expect(files.resolve('textures\\wood.png')).toMatchObject({ ok: true, bytes: A });
    expect(files.resolve('Wood.png')).toMatchObject({ ok: true, bytes: B });
    expect(files.resolve('other/WOOD.PNG')).toMatchObject({ ok: true, fileName: 'textures/wood.png' });
  });

  it('percent-decodes, and keeps a malformed escape as it is', () => {
    expect(files.resolve('My%20Model.bin')).toMatchObject({ ok: true, bytes: C });
    expect(files.resolve('My%2Model.bin')).toEqual({ ok: false, reason: 'NOT_PICKED', wanted: 'My%2Model.bin' });
  });

  it('never resolves a URL, but treats a drive path as a path', () => {
    const urls = [
      'https://example.com/wood.png',
      'http://x/wood.png',
      'file:///c/wood.png',
      '//cdn/wood.png',
      'blob:wood.png',
      '\\\\server\\wood.png',
    ];
    for (const url of urls) expect(files.resolve(url), url).toEqual({ ok: false, reason: 'NOT_FETCHED', wanted: '' });
    expect(files.resolve('C:\\models\\wood.png')).toMatchObject({ ok: true, fileName: 'textures/wood.png' });
  });

  it('names the file to pick when it is missing', () => {
    expect(files.resolve('maps/stone.png')).toEqual({ ok: false, reason: 'NOT_PICKED', wanted: 'stone.png' });
    expect(new ResourceFiles(undefined).resolve('a.bin')).toEqual({ ok: false, reason: 'NOT_PICKED', wanted: 'a.bin' });
  });
});
