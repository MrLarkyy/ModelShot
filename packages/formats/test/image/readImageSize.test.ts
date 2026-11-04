import { describe, expect, it } from 'vitest';
import { readImageSize } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { pngHeader } from '../bbmodel/fixtures';
import { JPEG_HEADER_CASES, jpegFrame, jpegWith } from '../jpeg/jpegHeaderCases';

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const jpegCase = (name: string): Uint8Array => {
  const found = JPEG_HEADER_CASES.find((c) => c.name === name);
  if (!found) throw new Error(`no JPEG case ${name}`);
  return found.bytes;
};

describe('readImageSize', () => {
  it('reads a PNG and a JPEG by their bytes', () => {
    expect(readImageSize(encodeSolidPng([1, 2, 3, 4]))).toEqual({
      ok: true,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
    expect(readImageSize(jpegWith(jpegFrame(0xc2, 300, 20)))).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
      width: 300,
      height: 20,
    });
  });

  it.each([
    ['empty', new Uint8Array(0), 'empty'],
    ['a broken PNG', pngHeader(0, 4), 'a PNG with a width or height of 0'],
    ['a truncated JPEG', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), 'a JPEG whose header is cut short'],
    [
      'an arithmetic JPEG',
      jpegWith(jpegFrame(0xc9, 8, 8)),
      'a JPEG that is arithmetic (only 8-bit Huffman JPEG is drawn)',
    ],
    [
      'WebP',
      Uint8Array.from([...ascii('RIFF'), 40, 0, 0, 0, ...ascii('WEBPVP8 ')]),
      'not a PNG or JPEG image (WebP is not supported)',
    ],
    [
      'KTX2',
      Uint8Array.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]),
      'not a PNG or JPEG image (KTX2 is not supported)',
    ],
    ['GIF', Uint8Array.from(ascii('GIF89a......')), 'not a PNG or JPEG image'],
    ['a PNG with a wrong signature', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]), 'not a PNG image'],
    ['a cut PNG', pngHeader(16, 16).subarray(0, 20), 'a PNG whose header is cut short'],
    [
      'a PNG without IHDR',
      pngHeader(16, 16).map((v, i) => (i === 12 ? 0 : v)),
      'a PNG that does not start with its IHDR header',
    ],
    ['a JPEG with no frame', jpegCase('SOS before any frame'), 'a JPEG with no frame header before its image data'],
    ['a JPEG with a second SOI', jpegCase('a second SOI'), 'a JPEG with a second start marker in its header'],
    ['a JPEG of width 0', jpegCase('width 0'), 'a JPEG with a width or height of 0'],
    ['a 12-bit JPEG', jpegCase('12-bit samples'), 'a JPEG that is 12-bit (only 8-bit Huffman JPEG is drawn)'],
    ['a two-component JPEG', jpegCase('two components'), 'a JPEG with 2 components (1, 3 or 4 are drawn)'],
  ])('refuses %s, naming why', (_name, bytes, reason) => {
    expect(readImageSize(bytes)).toEqual({ ok: false, reason });
  });
});
