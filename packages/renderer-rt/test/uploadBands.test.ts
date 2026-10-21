import { describe, expect, it } from 'vitest';
import { UPLOAD_BAND_BYTES, UPLOAD_FRAME_BYTES, uploadBands } from '../src/uploadBands';

describe('uploadBands', () => {
  it('splits a lightmap into whole-row bands within the band and frame budgets', () => {
    // 2048 RGBA16F texels per row: 16 KiB, so 16 rows per 256 KiB band and 4 bands per 1 MiB frame.
    const rowBytes = 2048 * 8;
    expect(uploadBands(450, rowBytes, 0)).toEqual([
      [0, 16],
      [16, 16],
      [32, 16],
      [48, 16],
    ]);
    expect(uploadBands(450, rowBytes, 448)).toEqual([[448, 2]]);
    expect(uploadBands(450, rowBytes, 450)).toEqual([]);
    for (const [, count] of uploadBands(450, rowBytes, 0))
      expect(count * rowBytes).toBeLessThanOrEqual(UPLOAD_BAND_BYTES);
  });

  it('covers every row exactly once across frames', () => {
    const rowBytes = 512 * 8;
    const seen: number[] = [];
    for (let row = 0, frames = 0; row < 512; frames++) {
      const bands = uploadBands(512, rowBytes, row);
      expect(bands.reduce((sum, [, count]) => sum + count * rowBytes, 0)).toBeLessThanOrEqual(UPLOAD_FRAME_BYTES);
      for (const [start, count] of bands) for (let r = start; r < start + count; r++) seen.push(r);
      row = (bands.at(-1)?.[0] ?? 0) + (bands.at(-1)?.[1] ?? 0);
      expect(frames).toBeLessThan(10);
    }
    expect(seen).toEqual(Array.from({ length: 512 }, (_, i) => i));
  });

  it('always moves on: a row wider than a band is a band of its own', () => {
    expect(uploadBands(3, 1 << 20, 0, 1024, 1024)).toEqual([[0, 1]]);
  });
});
