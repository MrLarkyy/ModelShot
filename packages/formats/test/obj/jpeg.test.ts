import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadObj } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { jpegFrame, jpegWith } from '../jpeg/jpegHeaderCases';
import { expectObjError, lines, QUAD } from './fixtures';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/jpeg/${name}`, import.meta.url)));
const encode = (text: string) => new TextEncoder().encode(text);
const OBJ = lines('mtllib m.mtl', ...QUAD, 'usemtl m', 'f 1 2 3');

function withMap(name: string, bytes: Uint8Array) {
  return new Map([
    ['m.mtl', encode(lines('newmtl m', `map_Kd ${name}`))],
    [name, bytes],
  ]);
}

describe('OBJ JPEG textures', () => {
  it('loads crate.obj with crate.mtl and crate.jpg', () => {
    const files = new Map([
      ['crate.mtl', fixture('crate.mtl')],
      ['crate.jpg', fixture('crate.jpg')],
    ]);
    const { scene, warnings } = loadObj(fixture('crate.obj'), { fileName: 'crate.obj', files });
    expect(warnings).toEqual([]);
    expect(scene.textures).toHaveLength(1);
    expect(scene.textures[0]).toMatchObject({
      name: 'crate.jpg',
      mimeType: 'image/jpeg',
      width: 32,
      height: 32,
      missing: false,
    });
  });

  it('fails TEXTURE_TOO_LARGE from the JPEG header', () => {
    const error = expectObjError(OBJ, 'TEXTURE_TOO_LARGE', 'm.mtl:1', {
      files: withMap('big.jpg', fixture('big-sof.jpg')),
    });
    expect(error.message).toContain('4097×16');
    expectObjError(OBJ, 'TEXTURE_TOO_LARGE', 'm.mtl:1', {
      files: withMap('tall.jpeg', jpegWith(jpegFrame(0xc0, 2048, 2049))),
      limits: { maxTexturePixels: 2048 * 2048 },
    });
  });

  it.each([
    [
      'WebP bytes named .jpg',
      'a.jpg',
      encode('RIFF\x10\0\0\0WEBPVP8 '),
      'not a PNG or JPEG image (WebP is not supported)',
    ],
    [
      'a lossless JPEG',
      'l.jpg',
      jpegWith(jpegFrame(0xc3, 8, 8)),
      'a JPEG that is lossless (only 8-bit Huffman JPEG is drawn)',
    ],
  ])('draws %s missing with UNSUPPORTED_IMAGE naming why', (_name, file, bytes, reason) => {
    const { scene, warnings } = loadObj(OBJ, { files: withMap(file, bytes) });
    expect(scene.textures[0]!.missing).toBe(true);
    expect(warnings.map((w) => w.code)).toEqual(['UNSUPPORTED_IMAGE']);
    expect(warnings[0]!.message).toContain(
      `map_Kd "${file}" is ${reason}; only PNG and JPEG images are drawn, this one is drawn missing`,
    );
  });

  it('counts a JPEG map_Kd toward maxTextures as a PNG', () => {
    const mtl = lines('newmtl a', 'map_Kd a.jpg', 'newmtl b', 'map_Kd b.png');
    const obj = lines('mtllib m.mtl', ...QUAD, 'usemtl a', 'f 1 2 3', 'usemtl b', 'f 1 2 3');
    const files = new Map([
      ['m.mtl', encode(mtl)],
      ['a.jpg', fixture('crate.jpg')],
      ['b.png', encodeSolidPng([0, 0, 0, 255])],
    ]);
    expect(loadObj(obj, { files, limits: { maxTextures: 2 } }).scene.textures.map((t) => t.mimeType)).toEqual([
      'image/jpeg',
      'image/png',
    ]);
    expectObjError(obj, 'TOO_MANY_TEXTURES', 'm.mtl:3', { files, limits: { maxTextures: 1 } });
  });
});
