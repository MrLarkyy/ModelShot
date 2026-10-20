import { describe, expect, it } from 'vitest';
import { readPngSize } from '../../src/png/readPngSize';
import { pngHeader, referencedPng } from '../bbmodel/fixtures';

describe('readPngSize', () => {
  it('reads width and height from IHDR', () => {
    expect(readPngSize(referencedPng())).toEqual({ ok: true, width: 16, height: 16 });
    expect(readPngSize(pngHeader(300, 70000))).toEqual({ ok: true, width: 300, height: 70000 });
  });

  it('reads sizes beyond 2^31 as unsigned', () => {
    expect(readPngSize(pngHeader(0xffffffff, 1))).toEqual({ ok: true, width: 0xffffffff, height: 1 });
  });

  it('works on a view into a larger buffer', () => {
    const outer = new Uint8Array(100);
    outer.set(pngHeader(5, 6), 10);
    expect(readPngSize(outer.subarray(10, 43))).toEqual({ ok: true, width: 5, height: 6 });
  });

  it.each([
    ['empty', new Uint8Array(0), 'TRUNCATED'],
    ['truncated after the signature', pngHeader(1, 1).slice(0, 20), 'TRUNCATED'],
    ['wrong signature', new TextEncoder().encode('GIF89a and then quite a lot more bytes'), 'NOT_PNG'],
    ['zero width', pngHeader(0, 1), 'ZERO_SIZE'],
    ['zero height', pngHeader(1, 0), 'ZERO_SIZE'],
  ])('rejects %s', (_name, bytes, reason) => {
    expect(readPngSize(bytes)).toEqual({ ok: false, reason });
  });

  it('rejects a file whose first chunk is not IHDR', () => {
    const bytes = pngHeader(1, 1);
    bytes.set([0x74, 0x45, 0x58, 0x74], 12); // tEXt
    expect(readPngSize(bytes)).toEqual({ ok: false, reason: 'NO_IHDR' });
  });
});
