import { describe, expect, it } from 'vitest';
import { readJpegSize } from '../../src/jpeg/readJpegSize';
import { expectCpuBelow } from '../support/expectCpuBelow';
import { seededBytes } from '../support/seededRandom';
import { JPEG_HEADER_CASES, SOI, jpegFrame, jpegSegment, jpegWith } from './jpegHeaderCases';

describe('readJpegSize', () => {
  it.each(JPEG_HEADER_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = readJpegSize(c.bytes);
    if ('width' in c) expect(result).toMatchObject({ ok: true, width: c.width, height: c.height });
    else if (c.coding !== undefined) expect(result).toEqual({ ok: false, reason: c.reason, coding: c.coding });
    else expect(result).toEqual({ ok: false, reason: c.reason });
  });

  it('tells progressive from sequential and counts the components', () => {
    expect(readJpegSize(jpegWith(jpegFrame(0xc2, 4, 4)))).toEqual({
      ok: true,
      width: 4,
      height: 4,
      components: 3,
      progressive: true,
    });
    expect(readJpegSize(jpegWith(jpegFrame(0xc0, 4, 4, 1)))).toMatchObject({ components: 1, progressive: false });
  });

  it('works on a view into a larger buffer', () => {
    const bytes = jpegWith(jpegFrame(0xc0, 5, 6));
    const outer = new Uint8Array(bytes.length + 20).fill(0xff);
    outer.set(bytes, 10);
    expect(readJpegSize(outer.subarray(10, 10 + bytes.length))).toMatchObject({ ok: true, width: 5, height: 6 });
  });

  it('walks 1 MiB of short segments before the frame within a bounded CPU time', () => {
    const app = jpegSegment(0xe1);
    const count = (1024 * 1024) / app.length;
    const bytes = new Uint8Array(2 + count * app.length + 32);
    bytes.set(SOI);
    for (let i = 0; i < count; i++) bytes.set(app, 2 + i * app.length);
    bytes.set(jpegFrame(0xc0, 33, 44), 2 + count * app.length);
    // The CPU clock ticks in about 15.6 ms steps on Windows, so the bound sits well above the expected 10 ms.
    const result = expectCpuBelow(100, () => readJpegSize(bytes));
    expect(result).toMatchObject({ ok: true, width: 33, height: 44 });
  });

  it('never throws on random bytes after SOI', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const bytes = seededBytes(seed, 1 + (seed % 97));
      bytes.set(SOI.slice(0, Math.min(2, bytes.length)));
      const result = readJpegSize(bytes);
      if (result.ok) expect(result.width * result.height).toBeGreaterThan(0);
    }
  });
});
